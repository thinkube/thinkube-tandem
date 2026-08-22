/**
 * Per-slice verify-oracle assembly for the run: detached snapshot helpers,
 * the oracle factory over the engine's createVerifyOracle, and the run
 * supervisor — the disclosure authority that sees BOTH sides of the
 * blinding wall (the coder's brief and the failing probes' source) and
 * answers one question: does the worker possess the information its task
 * requires? A DISCLOSE is by definition a contract gap and is ledgered.
 */
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  AcVerification,
} from "../engine/core/closingGate";
import {
  createVerifyOracle,
  VerifyOracle,
} from "../engine/verifyOracle";
import { resolveWorkerModel, WorkerModelConfig } from "../engine/workerModel";
import { runReadRound } from "../derive/round";
import { runAuthoringRound } from "./author";
import { runScopedSuite, withSuite } from "./suite";
import { linkProvisioned } from "./setup";
import { evidenceKey } from "./owner";
import { clearanceNote } from "./clearance";
import type { ClearanceRuling } from "./clearance";

/** Probe runs and oracle rounds must not inherit the host test-runner's
 *  context: a child `node --test` that detects a parent runner SKIPS itself
 *  and exits 0 — a false green. */
export function scrubbedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env))
    if (/^NODE_TEST|^TEST_|^NODE_OPTIONS$/.test(k)) delete env[k];
  return env;
}

export type Exec = (
  cmd: string,
  args: string[],
  cwd: string,
) => Promise<{ code: number; out: string }>;

/** Every command the run executes is BOUNDED and NAMED: a command that
 *  hangs becomes "timed out" with its own name in the output — a run is
 *  never allowed to go silent inside an exec. */
function makeExec(timeoutMs: number): Exec {
  return (cmd, args, cwd) =>
    new Promise((resolve) => {
      execFile(
        cmd,
        args,
        { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, killSignal: "SIGKILL" },
        (err, stdout, stderr) => {
          const killed = !!err && (err as { killed?: boolean }).killed === true;
          resolve({
            code: killed
              ? 124
              : err && typeof (err as { code?: unknown }).code === "number"
                ? ((err as { code?: number }).code as number)
                : err
                  ? 1
                  : 0,
            out: killed
              ? `[timed out after ${Math.round(timeoutMs / 1000)}s: ${cmd} ${args.slice(0, 5).join(" ")}]\n${stdout}\n${stderr}`
              : `${stdout}\n${stderr}`,
          });
        },
      );
    });
}

export const defaultExec: Exec = makeExec(5 * 60 * 1000);
/**
 * Create or re-point a detached snapshot worktree at `ref`'s current commit.
 * Reuse = re-snapshot: hard reset + `clean -fd` (no -x — provisioning like
 * node_modules survives), so every use grades a fresh base.
 */
async function ensureSnapshot(
  repoRoot: string,
  ref: string,
  dir: string,
  exec: Exec,
): Promise<boolean> {
  const sha = (await exec("git", ["-C", repoRoot, "rev-parse", ref], repoRoot)).out.trim();
  const reg = await exec("git", ["-C", repoRoot, "worktree", "list", "--porcelain"], repoRoot);
  if (reg.out.includes(`worktree ${dir}`)) {
    await exec("git", ["-C", dir, "reset", "--hard", sha], dir);
    await exec("git", ["-C", dir, "clean", "-fd"], dir);
    return true;
  }
  await fs.mkdir(path.dirname(dir), { recursive: true });
  const add = await exec(
    "git",
    ["-C", repoRoot, "worktree", "add", "--detach", dir, sha],
    repoRoot,
  );
  return add.code === 0;
}

/** Fresh code worktree on the run branch + detached tester snapshot.
 *  Returns the refusal when either cannot be provisioned. */
async function copyRel(fromRoot: string, toRoot: string, rel: string): Promise<void> {
  const dst = path.join(toRoot, rel);
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(path.join(fromRoot, rel), dst);
}

export interface OracleFactoryArgs {
  repoRoot: string;
  branch: string;
  wtRoot: string;
  tep: string;
  worktree: string;
  testerWt: string;
  sliceProbes: Map<string, string[]>;
  sliceVerifs: Map<string, AcVerification[]>;
  briefBySlice: Map<string, string>;
  model: string;
  workerModel?: WorkerModelConfig;
  supervisorRound?: typeof runReadRound;
  exec: Exec;
  boundedExec: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
  /** Build/typecheck command the runner needs before probes can run. */
  prepare?: string;
  /** What provisioning the worktree produced — linked into every runner
   *  so one install serves the run. */
  provisioned?: readonly string[];
  /** Where the build step emits compiled output — what a probe imports. */
  built?: readonly string[];
  /** The slice's own footprint: the runner overlays THIS slice's uncommitted
   *  files on the committed base — never another slice's half-written work
   *  from the shared tree. */
  footprintOf?: (slice: string) => readonly string[] | undefined;
  /** Test homes a later maintain slice will bring under: removed from THIS
   *  slice's runner before it builds, so a test pinning retired behavior
   *  does not fail a coder whose promises retire it. */
  pruneIn?: (slice: string) => readonly string[] | undefined;
  /** Lines carry the unit the oracle is acting for, when it is acting for one. */
  log: (line: string, step?: string) => void;
  /** Whom the oracle acts for right now — its lines carry that unit. */
  acting?: (slice: string) => { unit: string } | undefined;
  defect: (entry: {
    slice?: string;
    unit?: string;
    activity: string;
    trigger: string;
    type?: string;
    /** Which stage a repair implicates (docs/TARGET.md §4). */
    stage?: "author" | "brief" | "check" | "clearance" | "altitude";
    impact: string;
    detail: string;
  }) => void;
  /** The check behind an ordinal, from the space — never from the probe. */
  criterionOf?: (slice: string, ac: number) => { id: string; text: string } | undefined;
  /** Every ruling lands here, granted or not — the delivery carries them. */
  onRuling?: (r: {
    slice: string;
    criterionId: string;
    granted: boolean;
    reason: string;
  }) => void;
  /** A granted ruling's rewritten probe must outlive the tester snapshot. */
  persistProbe?: (rel: string) => Promise<void>;
  /** Injectable for tests: the probe re-author. */
  author?: typeof runAuthoringRound;
  /** The repository reading — the re-author and the finisher start from it. */
  digest?: string;
  /** A closing answer that names another role's work — flows as that role's contract. */
  onDecision?: (unit: string, text: string) => void;
  /** Widen a unit's footprint at the supervisor's ruling — validated and
   *  APPLIED by the run (the fence, the runner overlay and the porcelain
   *  filter all read the same footprint), and put on the record. */
  /** The door (src/run/clearance.ts): rules on a change the plan did not
   *  clear, waits if that file is being changed at this moment, and grants. */
  clearance?: (slice: string, unit: string, paths: string[]) => Promise<ClearanceRuling>;
  /** The repository's own standing tests, run in the slice's runner once its
   *  checks are green — scoped to the tests that import the slice's files. */
  suite?: {
    /** Runs one test file (`<file>` = its source path); "" runs nothing here. */
    runOne: string;
    exec: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
    /** The graph's importers of a path. */
    importersOf: (path: string) => Promise<readonly string[]>;
    /** Test files red at an earlier gate — run early. */
    reds: readonly string[];
    /** Every test home a maintain unit brings under — red there is theirs. */
    maintainHomes: () => readonly string[];
    /** Files other units will still create — red naming them is the tree's. */
    pendingPlanned: () => readonly string[];
  };
}

/** The paths in a supervisor's CLEAR line — repo-relative, before any dash. */
export function clearedPaths(reply: string): string[] {
  const line = reply.trimStart().split("\n")[0].replace(/^(CLEAR|WIDEN):\s*/i, "").split(/\s+[—-]{1,2}\s+/)[0];
  return [...new Set(line.split(/[,\s]+/).map((t) => t.trim().replace(/^`|`$/g, "")).filter((t) => t.includes("/") && !t.startsWith("/") && !t.includes("..")))];
}

/** Apply a CLEAR ruling: rule, wait at the door if the file is being changed
 *  right now, grant, and put it on the record. The note the worker reads. */
async function applyClearance(a: OracleFactoryArgs, slice: string, unit: string, reply: string): Promise<string | undefined> {
  const paths = clearedPaths(reply);
  if (!paths.length || !a.clearance) return undefined;
  return clearanceNote(await a.clearance(slice, unit, paths));
}

/** Challenges ONE CHECK may take — the judge runs the probe, so a plea is
 *  grounded in what it printed, never in argument alone. Counted per check
 *  (not per slice): a coder that questioned two other checks must still be
 *  able to question the one that is actually wrong. */
export function sliceOracleFactory(
  a: OracleFactoryArgs,
): (slice: string) => VerifyOracle | undefined {
  const oracles = new Map<string, VerifyOracle>();
  const logFor = (slice: string) => (line: string) => a.log(line, a.acting?.(slice)?.unit);

  // The engine offers every red round for review. A failure is reviewed the
  // FIRST time it appears — help arrives at once — and not again while it
  // stays the same failure; a new failure is reviewed anew. The pre-flight
  // audit (its evidence begins with PRE-FLIGHT) is always answered.
  const seenFailures = new Map<string, Set<string>>();
  const supervise =
    (slice: string) =>
    async (evidence: string, failingAcs: number[]): Promise<string | undefined> => {
      if (!/^PRE-FLIGHT/.test(evidence)) {
        const key = `${failingAcs.join(",")}:${evidenceKey(evidence)}`;
        const seen = seenFailures.get(slice) ?? new Set<string>();
        if (seen.has(key)) return undefined;
        seen.add(key);
        seenFailures.set(slice, seen);
      }
      const probes = a.sliceProbes.get(slice) ?? [];
      let probeSrc = "";
      for (const rel of probes) {
        if (!failingAcs.some((ac) => rel.includes(`_AC-${ac}.`))) continue;
        try {
          probeSrc += `\n── ${rel} ──\n` + (await fs.readFile(path.join(a.testerWt, rel), "utf8")).slice(0, 8000);
        } catch {
          /* absent probe — skip */
        }
      }
      const prompt = [
        "You are the RUN SUPERVISOR — the disclosure authority of an autonomous delivery.",
        "You see BOTH sides of the blinding wall: the coder's exact brief, and the failing",
        "checks' SOURCE. Your mandate: END THE GUESSING GAME — the coder must never have to",
        "infer by trial what a check expects — WHILE PRESERVING THE INTENT AS NORTH STAR.",
        "Your FIRST line must be EXACTLY one verdict word with content after it:",
        '- "DISCLOSE: <every fact the failing checks require that the brief does not state,',
        "   complete and concrete; verbatim check source never crosses, everything it MEANS does>",
        '- "TEST-FAULT: <a check contradicts the intent — name both; the coder must NOT conform>',
        '- "CAPABILITY: <the brief already states every required fact — cite exactly where>',
        '- "CLEAR: <repo-relative PRODUCTION file paths, space-separated> — <why the checks cannot pass without changing them>"',
        "   ONLY when a check requires changing a production file this unit is not cleared for. The run clears it",
        "   and the unit makes the change in this same session. A file another unit is changing AT THIS MOMENT is",
        "   waited for, never refused; only a test-shaped path is refused, because the checks are the test author's.",
        '- "ESCALATE" (intent-level ambiguity; a human must decide)',
        "",
        "──── THE CODER'S BRIEF ────",
        (a.briefBySlice.get(slice) ?? "(brief unavailable)").slice(0, 60000),
        "",
        "──── FAILING CHECK SOURCE (never quote it) ────",
        probeSrc.slice(0, 16000),
        "",
        "──── THE REPEATED FAILURE EVIDENCE ────",
        evidence.slice(0, 4000),
      ].join("\n");
      const reply = await (a.supervisorRound ?? runReadRound)(
        {
          model: resolveWorkerModel(a.workerModel ?? { workerModel: a.model }, "judge"),
          repoRoot: a.worktree,
          log: logFor(slice),
        },
        prompt,
      );
      if (!reply) return undefined;
      // The judge's routed fault attribution — each verdict class is a
      // distinct defect type in the journal.
      if (reply.trimStart().startsWith("DISCLOSE"))
        a.defect({
          slice,
          activity: "verify-oracle supervision",
          trigger: "supervisor",
          type: "contract",
          stage: "brief",
          impact: "round lost",
          detail: reply.slice(0, 1000),
        });
      if (reply.trimStart().startsWith("TEST-FAULT"))
        a.defect({
          slice,
          activity: "verify-oracle supervision",
          trigger: "supervisor",
          type: "test",
          stage: "check",
          impact: "a check contradicts the intent",
          detail: reply.slice(0, 1000),
        });
      if (/^(CLEAR|WIDEN)/.test(reply.trimStart())) {
        const unit = a.acting?.(slice)?.unit ?? slice;
        const note = await applyClearance(a, slice, unit, reply);
        if (note) {
          a.defect({
            slice,
            unit,
            activity: "verify-oracle supervision",
            trigger: "supervisor",
            type: "gate",
            stage: "clearance",
            impact: "a clearance could not reach the promise's site",
            detail: note.slice(0, 400),
          });
          return note;
        }
      }
      if (reply.trimStart().startsWith("ESCALATE")) {
        a.defect({
          slice,
          activity: "verify-oracle supervision",
          trigger: "supervisor",
          stage: "altitude",
          impact: "a person must decide",
          detail: reply.slice(0, 500),
        });
        return undefined;
      }
      return reply.slice(0, 4000);
    };

  return (slice: string): VerifyOracle | undefined => {
    const probes = a.sliceProbes.get(slice) ?? [];
    const verifs = a.sliceVerifs.get(slice) ?? [];
    if (!probes.length || !verifs.length) return undefined;
    const existing = oracles.get(slice);
    if (existing) return existing;
    const runnerDir = path.join(a.wtRoot, "oracle-runners", `${a.tep}-${slice}`);
    const bare = createVerifyOracle({
      codeWorktree: a.worktree,
      testerWorktree: a.testerWt,
      runnerDir,
      probeFiles: probes,
      verifications: verifs,
      ...(a.prepare ? { prepare: a.prepare } : {}),
      supervise: supervise(slice),
      exec: a.boundedExec,
      porcelain: async (cwd) => {
        const out = (await a.exec("git", ["-C", cwd, "status", "--porcelain", "--untracked-files=all"], cwd)).out;
        const mine = a.footprintOf?.(slice);
        if (!mine) return out;
        const owns = (p: string) => mine.some((f) => p === f || p.startsWith(f.replace(/\/$/, "") + "/"));
        return out
          .split("\n")
          .filter((l) => l.length > 3 && owns(l.slice(3).trim().split(" -> ").pop() ?? ""))
          .join("\n");
      },
      resetRunner: async () => {
        await ensureSnapshot(a.repoRoot, a.branch, runnerDir, a.exec);
        if (a.provisioned?.length) await linkProvisioned(runnerDir, a.worktree, a.provisioned);
        for (const rel of a.pruneIn?.(slice) ?? []) await fs.rm(path.join(runnerDir, rel), { force: true }).catch(() => {});
      },
      // A file missing at its source (a probe an earlier run lost) is the
      // check's red when it runs, never a crash of the whole unit.
      copyIn: (fromRoot, rel) => copyRel(fromRoot, runnerDir, rel).catch(() => {}),
      removeIn: async (rel) => {
        await fs.rm(path.join(runnerDir, rel), { force: true });
      },
      readFile: (root, rel) => fs.readFile(path.join(root, rel)),
      log: logFor(slice),
    });
    const suite = a.suite;
    const oracle = suite?.runOne
      ? withSuite(bare, {
          run: () =>
            runScopedSuite({
              runOne: suite.runOne,
              root: runnerDir,
              exec: (cmd) => suite.exec(cmd, runnerDir),
              footprint: a.footprintOf?.(slice) ?? [],
              importersOf: suite.importersOf,
              always: suite.reds,
              log: logFor(slice),
            }),
          maintainHomes: suite.maintainHomes,
          // The slice's own files are its own to create — never "the tree".
          pendingPlanned: () => {
            const mine = a.footprintOf?.(slice) ?? [];
            return suite.pendingPlanned().filter((p) => !mine.includes(p));
          },
          footprint: () => a.footprintOf?.(slice) ?? [],
          onEnvironment: (detail) =>
            a.defect({
              slice,
              activity: "verify",
              trigger: "suite",
              type: "environment",
              impact: "the suite could not run in the runner — not counted against the coder; the gate runs it",
              detail: detail.slice(0, 1200),
            }),
          log: logFor(slice),
        })
      : bare;
    oracles.set(slice, oracle);
    return oracle;
  };
}
