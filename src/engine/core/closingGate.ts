import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { clip } from "./guidance";
// ── Closing AI-verification gate ──────────────────
//
// At Spec quiescence the orchestrator runs the Spec's DECLARED per-AC verifications as a
// complete plan against the worktree (the live cluster for infra) and gates Done/commit on
// all-green. No skip: a Spec whose declared checks can't all run is requires-attention, never
// silently Done (this reverses today's `defaultVerify` skip-pass). The declaration lives in the
// Spec frontmatter as `ac_verifications` (AC ordinal → { run, env }); the result maps each
// pass/fail back to the AC(s) it proves and feeds the auditable per-AC report.

/** One AC's declared verification — how AC #`ac` is proven (the closing gate's input). */
export interface AcVerification {
  /** 1-based AC ordinal this check proves. */
  ac: number;
  /** The shell/playbook command run in the worktree (exit 0 = the AC passed). Empty for an
   *  `assessment` AC (SP-6/7 AC3) — that AC is graded by an independent assessor, not a command. */
  run: string;
  /** Where it runs — informational for `cluster`/`local` (the live cluster run is the shell's job).
   *  `assessment` (SP-6/7 AC3) is the model-graded branch: the closing gate dispatches a fresh
   *  independent assessor session (never the implementing worker) instead of spawning `run`. */
  env?: "cluster" | "local" | "assessment";
}

/** The outcome of running one AC's verification — pass/fail with its evidence (log excerpt). */
export interface AcResult {
  /** 1-based AC ordinal this result proves. */
  ac: number;
  pass: boolean;
  /** The command + exit code + a tail of its output (or the un-runnable reason). Auditable. */
  evidence: string;
  /**
   * The probe itself could not execute (shell exit 126/127 — command not
   * found / not executable — or a spawn error). This is a GATE defect, not a
   * code failure: the shell routes it to auditor re-authoring instead of
   * blaming a slice or burning a rework attempt (2026-07-11: a signed bare
   * `tsc` probe exited 127 in every fresh worktree and burned 3 attempts).
   */
  unrunnable?: boolean;
}

/**
 * Exit codes that mean the check did not run, so its red says nothing
 * about the code.
 *
 * 126 — found but not executable. 127 — command not found. 124 — the
 * command was cut short: a timeout, or the person pressing stop. That last
 * one wrote one "this criterion failed" row per check still in flight when
 * a run was halted, and the ledger then read as the work being broken
 * dozens of times over. Stopping a run is not evidence about anything.
 */
export const PROBE_UNRUNNABLE_CODES: ReadonlySet<number> = new Set([124, 126, 127]);

/**
 * A check that failed without ever reporting a test result did not judge
 * the code: the runner could not start it — a missing setting, a module
 * that would not import, a collection error. Twenty-four backend checks
 * once turned red on one missing database variable, and the report read
 * as twenty-four failures of the work. What a runner prints when a test
 * really ran, pass or fail, is the marker read here.
 */
export function checkNeverStarted(code: number | null, output: string): boolean {
  if (code === 0) return false;
  // A test that reported a result ran, whatever else it printed.
  if (/^(not )?ok \d+|\b\d+ (passed|failed|errors?)\b|^(--- )?(PASS|FAIL)\b|\bTests?:\s+\d+|\bAssertionError\b/m.test(output)) return false;
  // The runner's own setup failed, before any test: pytest's usage,
  // interruption, internal-error and nothing-collected exits, a conftest
  // that would not import, a settings object missing its values, a runner
  // that is not installed. A product module the check cannot import is
  // none of these: that is the code not being there, which is the verdict.
  if (code !== null && [2, 3, 4, 5].includes(code)) return true;
  return /ImportError while loading conftest|INTERNALERROR|Field required|ValidationError|No module named ['"]?(pytest|vitest|jest|mocha)|usage: (pytest|vitest)|command not found/.test(output);
}

/**
 * A red that says "the check was not there to run" is the gate's own
 * failure, never a verdict on the code — but a missing CHECK exits with the
 * runner's ordinary failure code, so the exit code alone cannot tell. One
 * night, eight runs flooded the ledger with 460 "code" rows whose single
 * cause was the machine judging a tree its checks were not in, and the
 * attention counter — which watches the gate-infra class — saw none of it.
 *
 * The file the command runs is looked for in the output's own words. Only
 * the CHECK file counts: an import the check cannot resolve stays a code
 * red, because a module the coder never wrote fails exactly that way and
 * that red is the honest verdict.
 */
function checkItselfMissing(run: string, output: string): boolean {
  const file = run
    .split(/\s+/)
    .filter((t) => t.includes("/") && !t.startsWith("-"))
    .pop()
    ?.replace(/^['"]|['"]$/g, "");
  if (!file) return false;
  const base = file.split("/").pop() ?? file;
  if (!output.includes(base)) return false;
  return /could not find|no such file|ENOENT|does not exist/i.test(output);
}

/** Run one declared command in `cwd`, resolving its exit code + combined output. Injectable so
 *  the runner is unit-testable; the default spawns a shell (the real cluster/local run). */
export type AcExec = (
  run: string,
  cwd: string,
) => Promise<{ code: number | null; output: string }>;

/** The independent-assessor verdict for an `env: "assessment"` AC (SP-6/7 AC3): pass/fail plus the
 *  assessor's **rationale** (why), so the verdict is recordable in the verification trace. */
interface AcAssessment {
  pass: boolean;
  rationale: string;
}

/**
 * Grade one `assessment` AC (SP-6/7 AC3) by dispatching a **fresh independent assessor** (never the
 * implementing worker): judge the delivered `artifact` against the AC + its `intent` and return
 * pass/fail **with a rationale** — no runnable command required. Injectable so the closing gate is
 * unit-testable with no live model; the real SDK-session dispatch lives in `OrchestratorService`.
 */
type AssessAc = (
  ac: AcVerification,
  intent: string,
  artifact: string,
) => Promise<AcAssessment>;

/** What {@link runAcVerifications} needs to grade an `assessment` AC (SP-6/7 AC3): the injectable
 *  assessor plus the per-AC intent (the criterion text / Spec intent) and a description of the
 *  delivered artifact the assessor judges. */
export interface AssessContext {
  assessAc: AssessAc;
  /** The intent handed to the assessor for AC #`ac` — its criterion text + surrounding Spec intent. */
  intentFor?: (ac: number) => string;
  /** A description of the delivered artifact (changed files / diff summary) the assessor judges. */
  artifact?: string;
}

/** Knobs for {@link runBounded}: the time bound + a fixed base env (no ambient PATH leaks in). */
export interface BoundedOptions {
  /** Hard wall-clock bound (ms). On expiry the child's whole process group is killed. */
  timeoutMs: number;
  /**
   * The FIXED base environment handed to the child — runBounded never folds in `process.env`
   * wholesale. `env.PATH` is the scrubbed base PATH onto which `${cwd}/node_modules/.bin` is
   * prepended; everything else (other than the always-injected `GIT_TERMINAL_PROMPT`) passes
   * through verbatim. Pass `process.env` explicitly if you want the ambient env.
   */
  env: NodeJS.ProcessEnv;
  /** Grace between SIGTERM and the SIGKILL backstop (ms). Default 250. */
  killGraceMs?: number;
  /**
   * The run was stopped. A bound is not a stop: a twenty-minute suite went
   * on running for twenty minutes after the person pressed the button,
   * because refusing to START a command is all a flag can do. When this
   * fires the child's whole process group is killed, exactly as the bound
   * kills it, and the call answers at once.
   */
  stop?: AbortSignal;
}

/** Exit code we resolve with when a bounded run is killed for exceeding its `timeoutMs`. */
const TIMED_OUT_CODE = 124;
/** Marker appended to a timed-out run's output (and matched by the closing-gate report). */
const TIMED_OUT_MARKER = "[timed out]";
/** Default bound for an unparameterized AC verification: generous (~10 minutes), per-AC overridable. */
export const DEFAULT_AC_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Linux process-group membership via `/proc`: the pids whose process-group id (field 5 of
 * `/proc/<pid>/stat`) equals `leaderPid`, EXCLUDING the leader itself. The shell spawned with
 * `detached:true` is its own group leader (pgid == pid), so its whole descendant tree shares that
 * pgid — these are the grandchildren we must reap. Returns `[]` where `/proc` is unavailable
 * (non-Linux); callers then fall back to the group `kill(-pid, …)` path. Never throws.
 */
function groupDescendants(leaderPid: number): number[] {
  const out: number[] = [];
  let names: string[];
  try {
    names = fs.readdirSync("/proc");
  } catch {
    return out; // no /proc (non-Linux) — caller falls back to group kill.
  }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    if (pid === leaderPid) continue;
    let stat: string;
    try {
      stat = fs.readFileSync(`/proc/${name}/stat`, "utf8");
    } catch {
      continue; // process vanished mid-scan — fine.
    }
    // `pid (comm) state ppid pgrp …` — comm can contain spaces/parens, so split AFTER the last ')'.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (Number(fields[2]) === leaderPid) out.push(pid); // fields[2] == pgrp
  }
  return out;
}

/**
 * Run `run` in `cwd` as a bounded, non-interactive shell child (finding #12/#13/#7):
 *
 *  - **detached** → the child leads its own process group, so a timeout kill reaches the WHOLE tree:
 *    a backgrounded grandchild (`sh -c 'sleep & wait'`) can't orphan.
 *  - **stdin = /dev/null** (`stdio: ['ignore', …]`) → any read sees immediate EOF; nothing can wedge
 *    waiting for interactive input.
 *  - **env** = the fixed base `opts.env` + `GIT_TERMINAL_PROMPT=0` (git never prompts) + a PATH with
 *    `${cwd}/node_modules/.bin` prepended onto `opts.env.PATH` (repo-local toolchain wins; no ambient
 *    PATH is folded in — only what the caller put in the base env).
 *  - **on timeout** → signal the grandchildren (`groupDescendants`) FIRST so the shell leader's
 *    `wait` reaps them and then exits (node reaps the leader) — this frees their pids even on hosts
 *    whose PID 1 doesn't reap orphans. A `kill(-pid, 'SIGKILL')` group backstop after `killGraceMs`
 *    catches a leader/straggler that ignores SIGTERM. Resolves `{ code: 124, output: … + '[timed
 *    out]' }`. No wall-clock is reported — only the verdict.
 *
 * Resolves with the child's exit `code` + combined stdout/stderr; rejects only if the shell itself
 * can't be spawned (a not-found *command* surfaces as a non-zero shell exit, not a reject).
 */
export function runBounded(
  run: string,
  cwd: string,
  opts: BoundedOptions,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const base = opts.env ?? {};
    const localBin = path.join(cwd, "node_modules", ".bin");
    const childPath = base.PATH
      ? `${localBin}${path.delimiter}${base.PATH}`
      : localBin;
    const env: NodeJS.ProcessEnv = {
      ...base,
      GIT_TERMINAL_PROMPT: "0",
      PATH: childPath,
    };

    const proc = spawn(run, {
      cwd,
      shell: true,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });

    let output = "";
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const signal = (pid: number, sig: NodeJS.Signals): void => {
      try {
        process.kill(pid, sig);
      } catch {
        // already gone — nothing to do.
      }
    };

    const settle = (result: { code: number | null; output: string }): void => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      resolve(result);
    };

    proc.stdout?.on("data", (d: Buffer) => (output += d.toString()));
    proc.stderr?.on("data", (d: Buffer) => (output += d.toString()));
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      reject(err);
    });
    proc.on("close", (code) => settle({ code, output }));

    const killGroup = (): void => {
      const pid = proc.pid;
      if (typeof pid !== "number") return;
      for (const child of groupDescendants(pid)) signal(child, "SIGTERM");
      setTimeout(() => {
        for (const child of groupDescendants(pid)) signal(child, "SIGKILL");
        signal(-pid, "SIGKILL");
      }, opts.killGraceMs ?? 250).unref?.();
    };
    if (opts.stop) {
      const onStop = (): void => {
        if (settled) return;
        killGroup();
        settle({ code: TIMED_OUT_CODE, output: `${output}\n[stopped — the run was halted]` });
      };
      if (opts.stop.aborted) onStop();
      else opts.stop.addEventListener("abort", onStop, { once: true });
    }
    killTimer = setTimeout(() => {
      const pid = proc.pid;
      if (typeof pid === "number") {
        // Reap grandchildren via the shell leader: SIGTERM the descendants so the leader's `wait`
        // returns and reaps them, then the leader exits on its own and node reaps it. This frees
        // the pids even where PID 1 doesn't reap orphans (so the group is *truly* gone, not zombied).
        for (const child of groupDescendants(pid)) signal(child, "SIGTERM");
        // Backstop: SIGKILL the whole group (covers a no-descendant leader and any SIGTERM-ignorer).
        // unref'd so the timer can't keep the event loop alive after we've resolved.
        setTimeout(() => {
          for (const child of groupDescendants(pid)) signal(child, "SIGKILL");
          signal(-pid, "SIGKILL"); // negative pid → the whole process group
        }, opts.killGraceMs ?? 250).unref?.();
      }
      settle({
        code: TIMED_OUT_CODE,
        output: output + (output.endsWith("\n") ? "" : "\n") + TIMED_OUT_MARKER,
      });
    }, opts.timeoutMs);
  });
}

/**
 * Default `AcExec`: a {@link runBounded} call with the generous default bound and the ambient
 * environment as its base (the real cluster/local run needs a working PATH). The bound, the
 * non-interactive stdin, `GIT_TERMINAL_PROMPT=0`, and the repo-local `node_modules/.bin` prefix
 * all come from `runBounded` — this wrapper just supplies the policy defaults.
 */
const defaultAcExec: AcExec = (run, cwd) =>
  runBounded(run, cwd, {
    timeoutMs: DEFAULT_AC_TIMEOUT_MS,
    env: process.env,
  });

/** Format one verification's evidence: the command, its exit code, and a clipped output tail. */
function acEvidence(run: string, code: number | null, output: string): string {
  const lines = output.split("\n").map((l) => l.replace(/\s+$/, ""));
  const tail = lines
    .filter((l, i, a) => l.length > 0 || i < a.length - 1)
    .slice(-8)
    .join("\n")
    .trim();
  const head = `$ ${run} → exit ${code ?? "null"}`;
  // On a FAILURE, the summary counts alone are useless for the rework round (the
  // "# fail 1" tail says nothing about WHAT failed) — so carry the first failing
  // assertion block too: from the first `not ok` line through its YAML diagnostic
  // (name, error, failureType), capped. This is what the re-authoring worker and
  // the human read; without it every red is "see the logs" archaeology.
  // pytest says it with `E` margin lines and a FAILED/ERROR summary; a
  // collection error has no assertion at all, only those.
  let failDetail = "";
  if (code !== 0) {
    const at = lines.findIndex((l) => /^\s*not ok /.test(l));
    if (at !== -1)
      failDetail = lines
        .slice(at, at + 14)
        .join("\n")
        .trim();
    else {
      const pytest = lines.filter((l) => /^E\s+\S/.test(l) || /^(FAILED|ERROR)\s/.test(l)).slice(0, 12);
      if (pytest.length) failDetail = pytest.join("\n").trim();
    }
  }
  const body = [
    failDetail ? clip(failDetail, 900) : "",
    tail ? clip(tail, 600) : "",
  ]
    .filter(Boolean)
    .join("\n");
  return body ? `${head}\n${body}` : head;
}

/**
 * Run the Spec's declared per-AC verifications as a complete plan: each check runs
 * in `cwd` (the worktree / live cluster), in declared order, and its pass/fail is attributed
 * back to the AC it proves. A command that exits 0 → pass; non-zero → fail; one that can't run
 * at all (spawn error) → fail with an "could not run" evidence (the no-skip: un-runnable ⇒ red,
 * never silently green). Returns one `AcResult` per declared verification.
 */
export async function runAcVerifications(
  verifs: AcVerification[],
  cwd: string,
  exec: AcExec = defaultAcExec,
  assess?: AssessContext,
): Promise<AcResult[]> {
  const out: AcResult[] = [];
  // AC7 (SP-6/7): run each DISTINCT runnable command at most once; a later AC declaring the same
  // command reuses the cached exit/output (or the cached spawn error) rather than re-running it.
  // Assessment ACs are never cached — each is graded against its own AC intent by the assessor.
  const runCache = new Map<
    string,
    { code: number | null; output: string } | { error: string }
  >();
  for (const v of verifs) {
    // `env: "assessment"` (SP-6/7 AC3): grade by dispatching a fresh independent assessor — never a
    // runnable command. No assessor injected ⇒ un-runnable ⇒ red (the no-skip rule: never silently green).
    if (v.env === "assessment") {
      if (!assess?.assessAc) {
        // No assessor could be dispatched. That is this machine failing to
        // judge, not the work failing — recorded as unrunnable so nothing
        // downstream reads it as a promise the code did not keep.
        out.push({
          ac: v.ac,
          pass: false,
          unrunnable: true,
          evidence: `assessment AC #${v.ac} → could not run: no independent assessor available`,
        });
        continue;
      }
      try {
        const intent = assess.intentFor?.(v.ac) ?? "";
        const { pass, rationale } = await assess.assessAc(
          v,
          intent,
          assess.artifact ?? "",
        );
        out.push({
          ac: v.ac,
          pass,
          evidence: `assessment (independent) → ${pass ? "pass" : "fail"}: ${clip(
            (rationale ?? "").trim() || "(no rationale)",
            600,
          )}`,
        });
      } catch (err) {
        // The assessor threw. A model or transport failure is not a verdict
        // about the code, and grading it as one sends repair actors to fix
        // work that was never judged.
        out.push({
          ac: v.ac,
          pass: false,
          unrunnable: true,
          evidence: `assessment AC #${v.ac} → could not run: ${(err as Error).message}`,
        });
      }
      continue;
    }
    // A check with no command to run it — its file belongs to no declared
    // part and no repository-wide command was proved — is not run at all,
    // and never counted green for having run nothing.
    if (!v.run.trim()) {
      out.push({
        ac: v.ac,
        pass: false,
        unrunnable: true,
        evidence: `no command runs check #${v.ac}: its file belongs to no declared part, and no repository-wide single-test command was proved`,
      });
      continue;
    }
    // AC7 de-dup: exec a given command once, then map its result to every AC that declared it.
    let cached = runCache.get(v.run);
    if (!cached) {
      try {
        cached = await exec(v.run, cwd);
      } catch (err) {
        cached = { error: (err as Error).message };
      }
      runCache.set(v.run, cached);
    }
    if ("error" in cached) {
      out.push({
        ac: v.ac,
        pass: false,
        evidence: `$ ${v.run} → could not run: ${cached.error}`,
        unrunnable: true,
      });
    } else {
      const neverStarted = cached.code !== 0 && checkNeverStarted(cached.code, cached.output);
      const unrunnable =
        (cached.code !== null && PROBE_UNRUNNABLE_CODES.has(cached.code)) ||
        (cached.code !== 0 && checkItselfMissing(v.run, cached.output)) ||
        neverStarted;
      out.push({
        ac: v.ac,
        pass: cached.code === 0,
        evidence:
          acEvidence(v.run, cached.code, cached.output) +
          (unrunnable
            ? neverStarted
              ? "\n(the check could not start — the runner's environment, not the code: nothing was judged)"
              : "\n(probe unrunnable — the runner or the check itself was not there: a GATE defect, not a code failure)"
            : ""),
        ...(unrunnable ? { unrunnable: true } : {}),
      });
    }
  }
  return out;
}
