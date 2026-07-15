/**
 * The black-box verify oracle (tests-first repair window, 2026-07-08).
 *
 * Under tests-first orchestration the held-out probes are authored BEFORE the coder
 * dispatches, and the coder's only feedback channel is this oracle: an
 * orchestrator-mediated "verify my work" that compiles the coder's current worktree
 * state together with the tester-owned probe sources in an ISOLATED runner directory
 * and returns structured results — compile errors OR per-AC pass/fail + the failing
 * assertion. **Probe source never reaches the coder; results do** (what a human TDD
 * developer sees). This replaces the coder's improvised feedback (own tests, whole-suite
 * self-verify, `npm install`) which caused the footprint-breach class of failures.
 *
 * Shape: a PURE core (porcelain parsing, prepare-failure classification, reply
 * formatting) + a thin shell (`createVerifyOracle`) whose git/copy/exec effects are all
 * injectable, so the module is unit-testable with fakes and the closing gate's runner
 * semantics are reused, not re-derived.
 *
 * Failure attribution (the blind-test-author hardening): the test author writes probes
 * against code that does not exist yet, so a probe that itself fails to COMPILE is a
 * TEST-side fault — the oracle detects that (every compile error located in a probe
 * file) and reports it as `testFault`, so the caller routes it to the fault judge
 * instead of charging it against the coder's iteration budget.
 */
import * as path from "path";

import type { AcVerification } from "./orchestratorCore";

/** One changed path in a worktree, from `git status --porcelain` text. */
export interface OverlayEntry {
  /** Repo-relative path (the porcelain path, rename-target for renames). */
  path: string;
  /** True when the change is a deletion (the runner must remove the file). */
  deleted: boolean;
}

/**
 * Parse `git status --porcelain --untracked-files=all` text into the overlay plan: which
 * files to copy into the runner and which to delete there. Pure. Renames (`R  old -> new`)
 * contribute BOTH a deletion of the old path and a copy of the new one.
 */
export function parsePorcelain(text: string): OverlayEntry[] {
  const out: OverlayEntry[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    const xy = raw.slice(0, 2);
    let rest = raw.slice(3).trim();
    // Porcelain may quote paths with special characters; strip one layer of quotes.
    const unquote = (p: string) =>
      p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p;
    if (xy.includes("R") || xy.includes("C")) {
      const arrow = rest.indexOf(" -> ");
      if (arrow !== -1) {
        const from = unquote(rest.slice(0, arrow));
        const to = unquote(rest.slice(arrow + 4));
        if (xy.includes("R")) out.push({ path: from, deleted: true });
        out.push({ path: to, deleted: false });
        continue;
      }
    }
    rest = unquote(rest);
    if (!rest) continue;
    out.push({ path: rest, deleted: xy.includes("D") });
  }
  // Dedup, deletions losing to a later add of the same path (checkout-then-recreate).
  const byPath = new Map<string, OverlayEntry>();
  for (const e of out) {
    const prev = byPath.get(e.path);
    if (!prev || (prev.deleted && !e.deleted)) byPath.set(e.path, e);
  }
  return [...byPath.values()];
}

/** Classification of a failed prepare (build/typecheck) run. */
export interface PrepareFailure {
  /** True when EVERY located error path is a probe file — a test-side fault the caller
   *  routes to the fault judge, never charged against the coder. */
  testFault: boolean;
  /** Repo-relative files named in the compiler output (deduped, in first-seen order). */
  errorFiles: string[];
}

/**
 * Classify a failed prepare by the file paths its output names (tsc's
 * `path(line,col): error TS…` shape and plain `path:line` shapes). Pure. Errors located
 * exclusively in probe files ⇒ `testFault` (the probe itself does not compile). No
 * locatable path at all ⇒ not a test fault (fail toward charging the build, not the
 * tester, so a toolchain error is never mis-routed to the judge).
 */
export function classifyPrepareFailure(
  output: string,
  probeFiles: string[],
): PrepareFailure {
  const probes = new Set(probeFiles.map((p) => p.replace(/^\.\//, "")));
  const errorFiles: string[] = [];
  const re = /(^|\s)([\w@./-]+\.[cm]?[jt]sx?)[(:]\d+/gm;
  for (const m of output.matchAll(re)) {
    const f = m[2].replace(/^\.\//, "");
    if (!errorFiles.includes(f)) errorFiles.push(f);
  }
  const testFault =
    errorFiles.length > 0 && errorFiles.every((f) => probes.has(f));
  return { testFault, errorFiles };
}

/** One per-AC probe outcome the oracle returns to the coder. */
export interface OracleAcResult {
  ac: number;
  pass: boolean;
  /** Bounded evidence: the command's exit + the first failing assertion block. */
  evidence: string;
}

/** The oracle's structured verdict for one `verify()` invocation. */
export type VerifyResult =
  | {
      kind: "build-failed";
      /** Compile errors located exclusively in probe files — test-side fault. */
      testFault: boolean;
      errorFiles: string[];
      /** Bounded raw compiler output. */
      output: string;
    }
  | { kind: "results"; results: OracleAcResult[]; rootCause?: string }
  /** Stall breaker (2026-07-14): N consecutive rounds returned an identical
   *  outcome — further iteration is information-free; the worker must stop. */
  | { kind: "stalled"; rounds: number }
  | { kind: "exhausted"; invocations: number };

const clip = (s: string, n: number): string =>
  s.length > n ? s.slice(0, n - 1) + "…" : s;

/**
 * Bounded evidence for one probe run. On failure it carries EVERYTHING safe to
 * disclose (2026-07-14 — behavior vs mechanism, not results vs nothing):
 * every failing TEST NAME (node:test titles are behavioral sentences — the
 * densest safe hint the runner produces), every failing assertion block (not
 * only the first), and for non-TAP output (an extension-host probe) the
 * assertion/error blocks themselves. Withholding any of this never protected
 * the probe's mechanism — it only bought blind rounds.
 */
export function probeEvidence(
  run: string,
  code: number | null,
  output: string,
): string {
  const lines = output.split("\n").map((l) => l.replace(/\s+$/, ""));
  const head = `$ ${run} → exit ${code ?? "null"}`;
  if (code === 0) return head;
  const failIdx = lines
    .map((l, i) => (/^\s*not ok /.test(l) ? i : -1))
    .filter((i) => i !== -1);
  const parts: string[] = [];
  if (failIdx.length > 0) {
    // TAP (node:test): name every failing test, then each failing block.
    parts.push(
      "failing tests:",
      ...failIdx.map((i) => `  - ${lines[i].replace(/^\s*not ok \d+ -? ?/, "")}`),
    );
    for (const i of failIdx.slice(0, 6))
      parts.push(lines.slice(i, i + 14).join("\n").trim());
  } else {
    // Non-TAP (extension-host probe): surface assertion/error blocks verbatim.
    const errIdx = lines
      .map((l, i) => (/(AssertionError|^\s*Error:|ERR_ASSERTION)/.test(l) ? i : -1))
      .filter((i) => i !== -1)
      .slice(0, 4);
    if (errIdx.length > 0)
      for (const i of errIdx)
        parts.push(lines.slice(Math.max(0, i - 1), i + 8).join("\n").trim());
    else parts.push(lines.slice(-14).join("\n").trim());
  }
  const detail = parts.filter(Boolean).join("\n");
  return detail ? `${head}\n${clip(detail, 2600)}` : head;
}

/**
 * When several probes fail with an IDENTICAL signature, that is one boundary
 * failure wearing n masks (seen live: every host probe dying at the same
 * singleton-lock error read as "everything is wrong" instead of "one wall").
 * The signature is the evidence minus its per-AC `$ run…` head. Deterministic.
 */
export function sharedFailureSignature(
  results: OracleAcResult[],
): string | undefined {
  const failing = results.filter((r) => !r.pass);
  if (failing.length < 2) return undefined;
  const sig = (e: string) => e.split("\n").slice(1).join("\n").trim();
  const first = sig(failing[0].evidence);
  if (!first) return undefined;
  return failing.every((f) => sig(f.evidence) === first) ? first : undefined;
}

/**
 * Identifier-level diagnostics safe to hand a coder for TEST-side compile errors
 * (2026-07-15). A bare "boundary broke in AC-10" sent workers guessing — and a
 * guessing worker drifts (one invented a parallel DryRunResult rather than fix an
 * export). Whitelisted TS codes name only identifiers/modules the shared contract
 * already makes public (missing export / name / member and their did-you-mean
 * variants); every other diagnostic is reduced to its code alone, so no probe
 * expression or literal text ever crosses the blinding boundary. Deterministic.
 */
export function redactTestSideDiagnostics(
  output: string,
  testFiles: string[],
): string {
  const SAFE = new Set([
    "TS2305", // module has no exported member 'x'
    "TS2304", // cannot find name 'x'
    "TS2339", // property 'x' does not exist on type 'Y'
    "TS2551", // property 'x' does not exist — did you mean 'y'?
    "TS2724", // module has no exported member — did you mean 'y'?
    "TS2694", // namespace has no exported member 'x'
    "TS2307", // cannot find module 'x'
  ]);
  const out: string[] = [];
  for (const raw of output.split("\n")) {
    const m = /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/.exec(raw.trim());
    if (!m) continue;
    const [, file, line, code, msg] = m;
    if (!testFiles.some((t) => file.endsWith(t) || t.endsWith(file))) continue;
    out.push(
      SAFE.has(code)
        ? `${file}(${line}): error ${code}: ${msg}`
        : `${file}(${line}): error ${code} (details withheld)`,
    );
    if (out.length >= 30) {
      out.push("… (more diagnostics truncated)");
      break;
    }
  }
  return out.join("\n");
}

/**
 * Render a {@link VerifyResult} as the tool reply the coder reads. Pure. Never leaks
 * probe SOURCE — only locations, pass/fail and assertion output. A test-side build
 * fault tells the coder to keep working from the contract (the orchestrator routes the
 * broken probe to the judge; it is not the coder's to fix).
 */
export function formatVerifyReply(r: VerifyResult): string {
  if (r.kind === "exhausted") {
    return `VERIFY LIMIT REACHED (${r.invocations} invocations). Stop iterating; summarize where you are and what remains — the run will park for review.`;
  }
  if (r.kind === "stalled") {
    return [
      `STALLED: ${r.rounds} consecutive verify rounds returned an IDENTICAL outcome — your edits are not changing the result, so further rounds carry no information.`,
      "Stop iterating NOW. State plainly in your final summary: what you implemented, and what you believe blocks the remaining criteria. The run will route this for review.",
    ].join("\n");
  }
  if (r.kind === "build-failed") {
    if (r.testFault) {
      // Location is NOT fault: an error inside a check file occurs both when the check is
      // wrong AND when the implementation drifted from the SPEC CONTRACT the check was
      // written to (a dropped field, a renamed export). Never assert whose fault it is.
      const idDiags = redactTestSideDiagnostics(r.output, r.errorFiles);
      return [
        `BUILD FAILED at the boundary between your implementation and this slice's checks (in: ${r.errorFiles.join(", ")}).`,
        ...(idDiags
          ? [
              "Identifier-level diagnostics (check source withheld — these name what the checks expected of YOUR exports):",
              idDiags,
            ]
          : []),
        "The checks are written to the SPEC CONTRACT. Compare your exports against the contract SIGNATURE BY SIGNATURE — every field, every optional marker, every name — the most common cause is an implementation that drifted from the contract. Fix any drift and verify again.",
        "If your implementation already matches the contract exactly, say so explicitly in your final summary and stop — the mismatch will be reviewed on the other side.",
      ].join("\n");
    }
    return ["BUILD FAILED — compile errors:", clip(r.output, 4000)].join("\n");
  }
  const pass = r.results.filter((x) => x.pass).length;
  const head = `PROBES: ${pass}/${r.results.length} pass`;
  // One boundary failure wearing n masks reads as "everything is wrong" —
  // name it once, first, so the worker fixes the wall instead of guessing.
  const rootCause = r.rootCause
    ? `\n\nALL ${r.results.filter((x) => !x.pass).length} FAILING PROBES FAIL IDENTICALLY — one boundary failure, not ${r.results.filter((x) => !x.pass).length} independent bugs. Fix this first:\n${clip(r.rootCause, 1200)}`
    : "";
  const body = r.results
    .map((x) => `AC-${x.ac}: ${x.pass ? "PASS" : "FAIL"}\n${x.evidence}`)
    .join("\n\n");
  return `${head}${rootCause}\n\n${body}`;
}

/** Injectable effects for {@link createVerifyOracle} — all defaulted to real I/O by the caller. */
export interface VerifyOracleDeps {
  /** The coder's (shared) code worktree — the state under verification. */
  codeWorktree: string;
  /** The tester snapshot holding the probe sources. */
  testerWorktree: string;
  /** The isolated runner directory (a detached worktree the caller prepared). */
  runnerDir: string;
  /** Repo-relative probe source paths (the slice's role:test footprints). */
  probeFiles: string[];
  /** The recipe's build/typecheck command (run in the runner before the probes). */
  prepare?: string;
  /** The slice's runnable per-AC verifications (assessment entries are skipped). */
  verifications: AcVerification[];
  /** Run a shell command; the closing gate's bounded exec is the production value. */
  exec: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
  /** `git status --porcelain --untracked-files=all` of the code worktree. */
  porcelain: (cwd: string) => Promise<string>;
  /** Reset the runner to the code worktree's current base commit (hard reset + clean). */
  resetRunner: () => Promise<void>;
  /** Copy one repo-relative file src-tree → runner (creating parent dirs). */
  copyIn: (fromRoot: string, rel: string) => Promise<void>;
  /** Delete one repo-relative file in the runner (missing file is fine). */
  removeIn: (rel: string) => Promise<void>;
  /** Invocation budget before the oracle reports `exhausted` (default 20). */
  maxInvocations?: number;
  /** Read one repo-relative file's content (for the green record's state hash). When
   *  omitted, rounds still run but no green record is kept (confirmGreen always re-runs). */
  readFile?: (root: string, rel: string) => Promise<string | Buffer>;
  log?: (line: string) => void;
}

export interface VerifyOracle {
  /** Run one verification round; serialized (concurrent calls queue). */
  verify(): Promise<VerifyResult>;
  /** Invocations consumed so far. */
  invocations(): number;
  /** MANDATORY-GREEN enforcement (2026-07-08): true only when the checks are green for the
   *  CURRENT state. If the last round was green and the verified content (coder delta +
   *  probes) hashes identically, the green record is confirmed WITHOUT re-running; any
   *  drift — or no green record — runs a fresh round and returns its verdict. The worker's
   *  self-reported success counts for nothing; this is the unit's completion condition,
   *  and the closing gate accepts the same record instead of re-running the per-AC checks. */
  confirmGreen(): Promise<{ green: boolean; result: VerifyResult }>;
  /** The last round's green record (result + state hash), if any. */
  last(): { green: boolean; stateHash?: string; result: VerifyResult } | undefined;
}

/**
 * The oracle shell: overlay the coder's current delta + the probe sources into the
 * isolated runner, run `prepare`, then the per-AC probe commands. Calls are serialized
 * through an internal queue (one runner per slice) and capped by `maxInvocations`.
 */
export function createVerifyOracle(deps: VerifyOracleDeps): VerifyOracle {
  const max = deps.maxInvocations ?? 20;
  const log = deps.log ?? (() => {});
  let used = 0;
  let queue: Promise<unknown> = Promise.resolve();
  let lastRecord:
    | { green: boolean; stateHash?: string; result: VerifyResult }
    | undefined;

  // Content hash of exactly what a round verifies: the coder's overlay delta (from the code
  // worktree) + the probe sources (from the tester worktree), path-sorted. Deterministic and
  // cheap; undefined when no readFile was injected (then green records never confirm-skip).
  const stateHash = async (
    entries: OverlayEntry[],
  ): Promise<string | undefined> => {
    if (!deps.readFile) return undefined;
    const { createHash } = await import("crypto");
    const h = createHash("sha256");
    const items = [
      ...entries
        .filter((e) => !e.deleted)
        .map((e) => ({ root: deps.codeWorktree, rel: e.path })),
      ...entries.filter((e) => e.deleted).map((e) => ({ root: "", rel: `DEL:${e.path}` })),
      ...deps.probeFiles.map((rel) => ({ root: deps.testerWorktree, rel })),
    ].sort((a, b) => a.rel.localeCompare(b.rel));
    for (const it of items) {
      h.update(it.rel);
      h.update("\0");
      if (it.root) {
        try {
          h.update(await deps.readFile(it.root, it.rel));
        } catch {
          h.update("<unreadable>");
        }
      }
      h.update("\0");
    }
    return h.digest("hex");
  };

  // Stall breaker (2026-07-14): consecutive rounds with an identical outcome
  // are information-free — a worker whose edits don't move the result must be
  // stopped, not left to grind the whole invocation budget (seen live: 0/6,
  // round after round, until the worker started probing the fences instead).
  let stallSig: string | undefined;
  let stallCount = 0;
  const STALL_AFTER = 3;

  const round = async (): Promise<VerifyResult> => {
    if (stallCount >= STALL_AFTER) return { kind: "stalled", rounds: stallCount };
    if (used >= max) return { kind: "exhausted", invocations: used };
    used++;
    // 1. Fresh runner at the coder's base commit, then overlay the coder's dirty delta.
    await deps.resetRunner();
    const entries = parsePorcelain(await deps.porcelain(deps.codeWorktree));
    const hash = await stateHash(entries);
    for (const e of entries) {
      if (e.deleted) await deps.removeIn(e.path);
      else await deps.copyIn(deps.codeWorktree, e.path);
    }
    // 2. Overlay the tester-owned probe sources (never visible in the coder's tree).
    for (const rel of deps.probeFiles)
      await deps.copyIn(deps.testerWorktree, rel);
    // 3. Build. A failure located ONLY in probe files is a test-side fault.
    if (deps.prepare) {
      const b = await deps.exec(deps.prepare, deps.runnerDir);
      if (b.code !== 0) {
        const cls = classifyPrepareFailure(b.output, deps.probeFiles);
        log(
          `  [oracle] build failed (${cls.testFault ? "test-side" : "code-side"}): ${cls.errorFiles.join(", ") || "no file located"}`,
        );
        const failed: VerifyResult = {
          kind: "build-failed",
          testFault: cls.testFault,
          errorFiles: cls.errorFiles,
          output: clip(b.output, 6000),
        };
        lastRecord = { green: false, stateHash: hash, result: failed };
        return failed;
      }
    }
    // 4. Run the slice's runnable probes.
    const results: OracleAcResult[] = [];
    for (const v of deps.verifications) {
      if (v.env === "assessment" || !v.run) continue;
      const r = await deps.exec(v.run, deps.runnerDir);
      results.push({
        ac: v.ac,
        pass: r.code === 0,
        evidence: probeEvidence(v.run, r.code, r.output),
      });
    }
    log(
      `  [oracle] round ${used}/${max}: ${results.filter((r) => r.pass).length}/${results.length} pass`,
    );
    const out: VerifyResult = { kind: "results", results };
    const rootCause = sharedFailureSignature(results);
    if (rootCause) out.rootCause = rootCause;
    // Stall accounting: an outcome identical to the previous round's (same
    // per-AC pass/fail and same failure signatures) increments the counter;
    // any change resets it. Green never stalls.
    const green = results.length > 0 && results.every((r) => r.pass);
    const sig = JSON.stringify(
      results.map((r) => [r.ac, r.pass, r.evidence.split("\n").slice(1).join("\n")]),
    );
    if (!green && sig === stallSig) {
      stallCount++;
      if (stallCount >= STALL_AFTER)
        log(
          `  [oracle] STALL: ${stallCount} identical rounds — further verify calls return 'stalled'.`,
        );
    } else {
      stallSig = sig;
      stallCount = green ? 0 : 1;
    }
    lastRecord = {
      green,
      stateHash: hash,
      result: out,
    };
    return out;
  };

  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  };

  return {
    verify: () => enqueue(round),
    invocations: () => used,
    confirmGreen: () =>
      enqueue(async () => {
        // Confirm-skip: last round green AND the verified content is byte-identical.
        if (lastRecord?.green && lastRecord.stateHash) {
          const entries = parsePorcelain(await deps.porcelain(deps.codeWorktree));
          const now = await stateHash(entries);
          if (now && now === lastRecord.stateHash) {
            log("  [oracle] green confirmed (state unchanged) — no re-run.");
            return { green: true, result: lastRecord.result };
          }
          log("  [oracle] state drifted since last green — re-running.");
        }
        const result = await round();
        // An exhausted budget can never confirm green (the stale record does not speak
        // for the current state).
        if (result.kind === "exhausted") return { green: false, result };
        return { green: lastRecord?.green === true, result };
      }),
    last: () => lastRecord,
  };
}

/** Repo-relative → absolute path join, exported for the wiring layer's copy/remove helpers. */
export function runnerPath(root: string, rel: string): string {
  return path.join(root, rel.replace(/^\.\//, ""));
}
