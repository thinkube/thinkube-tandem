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
import { linkProvisioned } from "./setup";
import { evidenceKey } from "./owner";

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

export const defaultExec: Exec = (cmd, args, cwd) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) =>
        resolve({
          code:
            err && typeof (err as { code?: unknown }).code === "number"
              ? ((err as { code?: number }).code as number)
              : err
                ? 1
                : 0,
          out: `${stdout}\n${stderr}`,
        }),
    );
  });

/**
 * Create or re-point a detached snapshot worktree at `ref`'s current commit.
 * Reuse = re-snapshot: hard reset + `clean -fd` (no -x — provisioning like
 * node_modules survives), so every use grades a fresh base.
 */
export async function ensureSnapshot(
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
export async function provisionRunTrees(
  repoRoot: string,
  branch: string,
  worktree: string,
  testerWt: string,
  exec: Exec,
): Promise<{ trigger: string; refusal: string } | undefined> {
  for (const stale of [worktree, testerWt])
    await exec("git", ["-C", repoRoot, "worktree", "remove", "--force", stale], repoRoot);
  await exec("git", ["-C", repoRoot, "worktree", "prune"], repoRoot);
  await exec("git", ["-C", repoRoot, "branch", "-D", branch], repoRoot);
  const wt = await exec("git", ["-C", repoRoot, "worktree", "add", "-b", branch, worktree], repoRoot);
  if (wt.code !== 0)
    return { trigger: "worktree", refusal: `worktree failed: ${wt.out.trim().slice(0, 300)}` };
  if (!(await ensureSnapshot(repoRoot, branch, testerWt, exec)))
    return { trigger: "tester-snapshot", refusal: `tester snapshot failed at ${testerWt}` };
  return undefined;
}

export async function copyRel(fromRoot: string, toRoot: string, rel: string): Promise<void> {
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
  /** The slice's existing test homes as the tester left them — built in the
   *  runner with the coder's work, so an expectation the tester wrote is met
   *  by the coder or disclosed, never landed on the base unbuilt. */
  sliceTestHomes?: Map<string, string[]>;
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
  /** The acting unit's own footprint: the runner overlays THIS unit's
   *  uncommitted files on the committed base — never another coder's
   *  half-written work from the shared tree. */
  footprintOf?: (slice: string) => readonly string[] | undefined;
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
}

/** Challenges a slice may spend — a valve, never a grinding strategy. */
const CHALLENGE_BUDGET = 2;

/**
 * The coder's challenge, adjudicated. The coder never sees the probe; the
 * judge sees everything and answers one narrow question: does the probe
 * faithfully render the criterion the human signed? Granted → a fresh
 * authoring round rewrites the probe FROM THE CRITERION (the coder's
 * argument is not the spec), the ruling rides the delivery's face, and
 * the coder is told to verify again. Denied → the check stands, with the
 * reason. The criterion itself is never touched by this channel — a
 * coder disputing the criterion is disputing the human, and that parks.
 */
export function makeChallenge(
  a: OracleFactoryArgs,
): (slice: string) => (ac: number, argument: string) => Promise<string> {
  const spent = new Map<string, number>();
  return (slice: string) =>
    async (ac: number, argument: string): Promise<string> => {
      const used = spent.get(slice) ?? 0;
      if (used >= CHALLENGE_BUDGET)
        return `challenge budget spent (${CHALLENGE_BUDGET} per slice) — meet the checks as they stand, or report UNDELIVERED with your evidence.`;
      const criterion = a.criterionOf?.(slice, ac);
      const rel = (a.sliceProbes.get(slice) ?? []).find((p) => p.includes(`_AC-${ac}.`));
      if (!criterion || !rel) return `no check ${ac} exists on this slice.`;
      spent.set(slice, used + 1);
      let probeSrc = "";
      try {
        probeSrc = (await fs.readFile(path.join(a.testerWt, rel), "utf8")).slice(0, 12000);
      } catch {
        return `check ${ac} has no probe yet — nothing to challenge; run verify first.`;
      }
      const judge = resolveWorkerModel(a.workerModel ?? { workerModel: a.model }, "judge");
      const reply = await (a.supervisorRound ?? runReadRound)(
        { model: judge, repoRoot: a.testerWt, log: a.log },
        [
          "You are the ORACLE ruling on a coder's CHALLENGE to one check. You see",
          "everything; the coder saw only its own failures. Judge ONE question:",
          "does the probe faithfully render the criterion? A probe that asserts",
          "implementation details the criterion never demands, contradicts a",
          "stated rule of the run, or cannot be satisfied by ANY correct",
          "implementation is DEFECTIVE. A probe the coder merely finds hard is",
          "FAITHFUL. The criterion itself is not on trial.",
          "Your FIRST line must be exactly DEFECTIVE or FAITHFUL, then one plain",
          "sentence of reason.",
          "",
          `THE CRITERION (signed by the human): ${criterion.text}`,
          "",
          "──── THE PROBE'S SOURCE ────",
          probeSrc,
          "",
          "──── THE CODER'S ARGUMENT ────",
          argument.slice(0, 4000),
        ].join("\n"),
      );
      const granted = !!reply?.trimStart().toUpperCase().startsWith("DEFECTIVE");
      const reason = (reply ?? "the judge was unreachable — the check stands")
        .split("\n")
        .slice(0, 2)
        .join(" ")
        .slice(0, 300);
      a.onRuling?.({ slice, criterionId: criterion.id, granted, reason });
      a.defect({
        slice,
        activity: "challenge",
        trigger: "oracle-ruling",
        type: granted ? "test" : "code",
        impact: granted ? "check re-authored" : "challenge denied",
        detail: reason,
      });
      if (!granted) return `DENIED — ${reason}\nMeet the check as it stands.`;
      const rewritten = await reauthorCheck(a, { rel, criterion: criterion.text, because: `an earlier rendering was ruled defective: ${reason}` });
      if (!rewritten)
        return `GRANTED — ${reason}\nBut the re-author failed; the old check stands for now. Run verify.`;
      a.log(`⚖ ${slice}: check ${ac} re-authored at the oracle's ruling — ${reason}`);
      return `GRANTED — ${reason}\nThe check was re-authored from its criterion. Run verify.`;
    };
}

/** Rewrite one probe from its criterion, in the tester's tree, and keep it
 *  past the next snapshot. Used by a granted challenge and by the repair
 *  loop alike: the criterion is the spec, the reason is context. */
async function reauthorCheck(
  a: OracleFactoryArgs,
  args: { rel: string; criterion: string; because: string; error?: string },
): Promise<boolean> {
  const judge = resolveWorkerModel(a.workerModel ?? { workerModel: a.model }, "judge");
  const before = await fs.readFile(path.join(a.testerWt, args.rel), "utf8").catch(() => "");
  const rewritten = await (a.author ?? runAuthoringRound)(
    { cwd: a.testerWt, model: judge, allowWrite: [args.rel], log: a.log, maxTurns: 30 },
    [
      `Rewrite the probe at ${args.rel} FROM ITS CRITERION alone. ${args.because}`,
      "",
      `THE CRITERION it must prove, exactly: ${args.criterion}`,
      ...(args.error
        ? ["", "WHAT THE RUNNER SAID when the old probe ran (fix the cause; the criterion stays):", args.error.slice(0, 2500)]
        : []),
      ...(a.built?.length
        ? ["", `WHERE THE BUILD EMITS compiled output in this repository: ${a.built.join(", ")} — import compiled modules from there, never from a folder that is not built.`]
        : []),
      "",
      "Write a complete, runnable probe file proving only that criterion,",
      "against the repository as this tree shows it. Do not weaken the",
      "criterion and do not test implementation details it never names.",
      "The probe must exit on its own: stop anything it starts.",
      "Overwrite the file in place.",
    ].join("\n"),
  );
  if (rewritten === null) return false;
  // A re-author that left the file as it was did nothing, whatever it said.
  const after = await fs.readFile(path.join(a.testerWt, args.rel), "utf8").catch(() => "");
  if (after === before) return false;
  await a.persistProbe?.(args.rel).catch(() => {});
  return true;
}

const REPAIR_BUDGET = 2;

/**
 * The repair loop for check-owned failures: a check that could not run —
 * its import did not resolve, it threw before any test, it never exited —
 * is re-authored from its criterion with the runner's words in hand. No
 * challenge is spent; the coder is told what was repaired. Each check is
 * repaired at most twice per slice.
 */
export function makeRepair(
  a: OracleFactoryArgs,
): (slice: string, failures: { ac: number; evidence: string }[]) => Promise<string[]> {
  const spent = new Map<string, number>();
  return async (slice, failures) => {
    const repaired: string[] = [];
    for (const f of failures) {
      const key = `${slice}#${f.ac}`;
      const used = spent.get(key) ?? 0;
      if (used >= REPAIR_BUDGET) continue;
      const criterion = a.criterionOf?.(slice, f.ac);
      const rel = (a.sliceProbes.get(slice) ?? []).find((p) => p.includes(`_AC-${f.ac}.`));
      if (!criterion || !rel) continue;
      spent.set(key, used + 1);
      const head = f.evidence.split("\n").find((l) => /Error|Cannot|timed out|did not exit/i.test(l))?.trim().slice(0, 200) ?? "the check could not run";
      const ok = await reauthorCheck(a, {
        rel,
        criterion: criterion.text,
        because: `The old probe could not run — that is the check's fault, not the code's.`,
        error: f.evidence,
      });
      a.onRuling?.({ slice, criterionId: criterion.id, granted: ok, reason: `the check could not run: ${head}` });
      a.defect({
        slice,
        activity: "check repair",
        trigger: "check-owner",
        type: "test",
        impact: ok ? "check re-authored from its criterion" : "re-author failed — the check stands",
        detail: head,
      });
      a.log(ok ? `🔧 ${slice}: check ${f.ac} could not run (${head}) — re-authored from its criterion` : `⚠ ${slice}: check ${f.ac} could not run and the re-author failed`, a.acting?.(slice)?.unit);
      if (ok) repaired.push(`check ${f.ac}: ${head}`);
    }
    return repaired;
  };
}

/** One oracle per slice, memoized; undefined when the slice has no probes. */
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
          impact: "round lost",
          detail: reply.slice(0, 1000),
        });
      if (reply.trimStart().startsWith("TEST-FAULT"))
        a.defect({
          slice,
          activity: "verify-oracle supervision",
          trigger: "supervisor",
          type: "test",
          impact: "a check contradicts the intent",
          detail: reply.slice(0, 1000),
        });
      if (reply.trimStart().startsWith("ESCALATE")) {
        a.defect({
          slice,
          activity: "verify-oracle supervision",
          trigger: "supervisor",
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
    const oracle = createVerifyOracle({
      codeWorktree: a.worktree,
      testerWorktree: a.testerWt,
      runnerDir,
      probeFiles: [...probes, ...(a.sliceTestHomes?.get(slice) ?? [])],
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
      },
      copyIn: (fromRoot, rel) => copyRel(fromRoot, runnerDir, rel),
      removeIn: async (rel) => {
        await fs.rm(path.join(runnerDir, rel), { force: true });
      },
      readFile: (root, rel) => fs.readFile(path.join(root, rel)),
      log: logFor(slice),
    });
    oracles.set(slice, oracle);
    return oracle;
  };
}
