/**
 * The repair the platform's own words ask for.
 *
 * The work is already in the project, so this is not a delivery being
 * judged — it is a product that does not build, with a log that names the
 * files. The closer answers it, seeing only that: what the platform said,
 * and the files it named. It may edit those and nothing else, and it is
 * measured by the repository's own build, here, in the tree the run
 * committed from.
 *
 * A repair that reaches wider than the log would be the same defect the
 * gate's closer was bounded for: work nobody asked for, arriving in a
 * project that is already live.
 */
import { close } from "./closer";
import { RunState } from "./state";

export async function repairAfterTheMerge(a: {
  tep: string;
  attempt: number;
  worktree: string;
  evidence: string;
  files: string[];
  deps: {
    repoRoot: string;
    model: string;
    build?: string;
    prepare?: string;
    digest?: string;
    workerModel?: Parameters<typeof close>[0]["workerModel"];
    worker?: Parameters<typeof close>[0]["worker"];
  };
  st: RunState;
  exec: (cmd: string, args: string[], cwd: string) => Promise<{ code: number; out: string }>;
  boundedExec: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
  log: (line: string) => void;
}): Promise<{ green: boolean; report: string }> {
  const step = `live#repair-${a.attempt}`;
  const measure = async (): Promise<{ green: boolean; score: number; evidence: string; alsoOwn: string[] }> => {
    if (!a.deps.build) return { green: true, score: 0, evidence: "this repository declares no build", alsoOwn: [] };
    const b = await a.boundedExec(a.deps.build, a.worktree);
    return {
      green: b.code === 0,
      score: b.code === 0 ? 0 : 1,
      evidence:
        b.code === 0
          ? "the build passes here"
          : `THE PRODUCT BUILD FAILS HERE (${a.deps.build}):\n${b.output.slice(-6000)}`,
      alsoOwn: [],
    };
  };
  const closed = await close({
    subject: `${a.tep} (what the platform refused)`,
    worktree: a.worktree,
    // Only what the platform's log named. Nothing else is failing.
    footprint: a.files,
    probeSources: [],
    history: [`the platform refused the merged work:\n${a.evidence.slice(0, 6000)}`],
    criteria: [
      {
        id: "live-1",
        text: "the platform builds and deploys this repository from what is now in the project",
      },
    ],
    ...(a.deps.digest ? { digest: a.deps.digest } : {}),
    ...(a.deps.prepare ? { prepare: a.deps.prepare } : {}),
    model: a.deps.model,
    ...(a.deps.workerModel ? { workerModel: a.deps.workerModel } : {}),
    measure,
    exec: a.exec,
    boundedExec: a.boundedExec,
    halted: () => a.st.halted,
    abortable: (ab) => a.st.aborts.set(step, ab),
    log: a.log,
    say: (t) => a.st.doing(step, t),
    onRuling: () => {},
    defect: () => {},
    ...(a.deps.worker ? { worker: a.deps.worker } : {}),
  });
  if (closed.green) {
    await a.exec("git", ["-C", a.worktree, "add", "-A", "."], a.worktree);
    await a.exec(
      "git",
      ["-C", a.worktree, "commit", "-m", `tandem: ${a.tep} — what the platform refused (attempt ${a.attempt})`],
      a.worktree,
    );
  }
  return { green: closed.green, report: closed.report };
}
