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
  sliceVerifs: Map<string, AcVerification[]>;
  briefBySlice: Map<string, string>;
  model: string;
  workerModel?: WorkerModelConfig;
  supervisorRound?: typeof runReadRound;
  exec: Exec;
  boundedExec: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
  log: (line: string) => void;
  defect: (entry: {
    slice?: string;
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
      const rewritten = await (a.author ?? runAuthoringRound)(
        {
          cwd: a.testerWt,
          model: judge,
          allowWrite: [rel],
          log: a.log,
          maxTurns: 30,
        },
        [
          `Rewrite the probe at ${rel} FROM ITS CRITERION alone. An earlier`,
          `rendering was ruled defective: ${reason}`,
          "",
          `THE CRITERION it must prove, exactly: ${criterion.text}`,
          "",
          "Write a complete, runnable probe file proving only that criterion,",
          "against the repository as this tree shows it. Do not weaken the",
          "criterion and do not test implementation details it never names.",
          "Overwrite the file in place.",
        ].join("\n"),
      );
      if (rewritten === null)
        return `GRANTED — ${reason}\nBut the re-author failed; the old check stands for now. Run verify.`;
      await a.persistProbe?.(rel).catch(() => {});
      a.log(`⚖ ${slice}: check ${ac} re-authored at the oracle's ruling — ${reason}`);
      return `GRANTED — ${reason}\nThe check was re-authored from its criterion. Run verify.`;
    };
}

/** One oracle per slice, memoized; undefined when the slice has no probes. */
export function sliceOracleFactory(
  a: OracleFactoryArgs,
): (slice: string) => VerifyOracle | undefined {
  const oracles = new Map<string, VerifyOracle>();

  const supervise =
    (slice: string) =>
    async (evidence: string, failingAcs: number[]): Promise<string | undefined> => {
      // The supervisor is consulted exactly when rounds stall — that trip is
      // itself a find-time defect observation.
      a.defect({
        slice,
        activity: "verify rounds",
        trigger: "stall-breaker",
        impact: "supervisor consulted",
        detail: `check(s) ${failingAcs.join(", ") || "?"} repeating an identical failure`,
      });
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
          log: a.log,
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
      probeFiles: probes,
      verifications: verifs,
      supervise: supervise(slice),
      exec: a.boundedExec,
      porcelain: async (cwd) =>
        (await a.exec("git", ["-C", cwd, "status", "--porcelain", "--untracked-files=all"], cwd)).out,
      resetRunner: async () => {
        await ensureSnapshot(a.repoRoot, a.branch, runnerDir, a.exec);
      },
      copyIn: (fromRoot, rel) => copyRel(fromRoot, runnerDir, rel),
      removeIn: async (rel) => {
        await fs.rm(path.join(runnerDir, rel), { force: true });
      },
      readFile: (root, rel) => fs.readFile(path.join(root, rel)),
      log: a.log,
    });
    oracles.set(slice, oracle);
    return oracle;
  };
}
