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
