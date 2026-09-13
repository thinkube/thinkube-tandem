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
 * The bound matters here more than at the gate: whatever this writes
 * arrives in a project that is already live.
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
  /** The repair is of what the reviewers found on the running product,
   *  not of a build the platform refused: their lines are the criteria,
   *  and an unchanged tree is not a repair, whatever the build says. */
  onTheProduct?: { criteria: string[] };
}): Promise<{ green: boolean; report: string }> {
  const step = `live#repair-${a.attempt}`;
  const build = async (): Promise<{ ok: boolean; output: string }> => {
    if (!a.deps.build) return { ok: true, output: "this repository declares no build" };
    const b = await a.boundedExec(a.deps.build, a.worktree);
    return { ok: b.code === 0, output: b.output };
  };
  // Changed since the repair began: in the working tree, or committed —
  // a worker that commits its own change has still changed the tree.
  const startHead = (await a.exec("git", ["-C", a.worktree, "rev-parse", "HEAD"], a.worktree)).out.trim();
  const changed = async (): Promise<boolean> => {
    const s = await a.exec("git", ["-C", a.worktree, "status", "--porcelain"], a.worktree);
    if (s.out.trim().length > 0) return true;
    const head = (await a.exec("git", ["-C", a.worktree, "rev-parse", "HEAD"], a.worktree)).out.trim();
    return !!startHead && !!head && head !== startHead;
  };
  const measure = async (): Promise<{ green: boolean; score: number; evidence: string; alsoOwn: string[] }> =>
    a.onTheProduct
      ? measureOnTheProduct({ build: await build(), buildCommand: a.deps.build, changed: await changed(), evidence: a.evidence })
      : measureTheBuild({ build: await build(), buildCommand: a.deps.build });
  const closed = await close({
    subject: a.onTheProduct ? `${a.tep} (what does not hold on the running product)` : `${a.tep} (what the platform refused)`,
    worktree: a.worktree,
    // Only what the platform's log named, or the files the promises land in. Nothing else is failing.
    footprint: a.files,
    probeSources: [],
    history: [
      a.onTheProduct
        ? `the reviewers opened the running product and found these do not hold:\n${a.evidence.slice(0, 6000)}`
        : `the platform refused the merged work:\n${a.evidence.slice(0, 6000)}`,
    ],
    criteria: a.onTheProduct
      ? a.onTheProduct.criteria.map((text, i) => ({ id: `product-${i + 1}`, text }))
      : [
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

/** The build is the measure of a repair the platform's refusal asked for. */
export function measureTheBuild(a: {
  build: { ok: boolean; output: string };
  buildCommand?: string;
}): { green: boolean; score: number; evidence: string; alsoOwn: string[] } {
  return {
    green: a.build.ok,
    score: a.build.ok ? 0 : 1,
    evidence: a.build.ok
      ? "the build passes here"
      : `THE PRODUCT BUILD FAILS HERE (${a.buildCommand ?? "build"}):\n${a.build.output.slice(-6000)}`,
    alsoOwn: [],
  };
}

/**
 * The measure of a repair the reviewers asked for. The build already
 * passed when they looked, so the build alone would call an untouched
 * tree green and the closer would stop before its first round. Red until
 * the tree has changed and builds; whether the change is right is the
 * reviewers' to say, on the product, afterwards.
 */
export function measureOnTheProduct(a: {
  build: { ok: boolean; output: string };
  buildCommand?: string;
  changed: boolean;
  evidence: string;
}): { green: boolean; score: number; evidence: string; alsoOwn: string[] } {
  if (!a.changed)
    return {
      green: false,
      score: 1,
      evidence: `THE REVIEWERS FOUND THESE DO NOT HOLD ON THE RUNNING PRODUCT, and nothing in the tree has changed yet — the code must change in the files named:\n${a.evidence.slice(0, 6000)}`,
      alsoOwn: [],
    };
  if (!a.build.ok)
    return {
      green: false,
      score: 1,
      evidence: `THE PRODUCT BUILD FAILS HERE (${a.buildCommand ?? "build"}):\n${a.build.output.slice(-6000)}`,
      alsoOwn: [],
    };
  return { green: true, score: 0, evidence: "the tree changed and the build passes here — the reviewers judge the rest", alsoOwn: [] };
}
