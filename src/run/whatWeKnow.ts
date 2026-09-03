/**
 * What this run knows about the repository it is about to judge — and its
 * refusal to proceed when it does not know enough.
 *
 * A run judges through five commands: how the repository installs, builds
 * for a check, runs one check, builds its product, runs its whole suite.
 * Every consumer downstream used to treat a missing one as a harmless
 * case: the product-build veto quietly did not apply, checks fell back to
 * a command from another language, and an absent suite reached a shell as
 * the empty string at the last step of a seventy-minute run.
 *
 * So the decision is made once, here, before any worker starts: the door
 * runs each candidate on the untouched tree, and what did not answer is
 * absent rather than empty. A fact a judgement rests on and cannot get
 * stops the run in its first minute, naming the fact, what it was for, and
 * where the run looks for it.
 */
import { openTheDoor, type TreeSetup } from "./setup";
import { factsOf, rememberWhatHeld, type RepositoryFacts } from "./facts";
import { missing, provisional, type Proved } from "./proved";
import { downstreamOf, partsOf } from "./survey";
import { partsDeclared, thinkubeDeclaration } from "../core/thinkubeYaml";

/**
 * Each declared part's own single-test command, as `thinkube.yaml` says it:
 * `test.one` with `<file>` relative to the part's root. Declared beats
 * guessed, so a part that says how one test runs is never inferred.
 */
export function declaredPartCommands(repoRoot: string): Record<string, { runOne: string }> {
  const d = thinkubeDeclaration(repoRoot);
  if (!d || !("declared" in d)) return {};
  const out: Record<string, { runOne: string }> = {};
  for (const p of partsDeclared(d.declared)) if (p.root !== "." && p.test?.one) out[p.root] = { runOne: p.test.one };
  return out;
}
import type { DispatchDeps } from "./deps";
import type { Cut, Space } from "../core/schema";
import { groundThatMoved, regroundingNeeded } from "./groundStillThere";

export type Known =
  | {
      ok: true;
      ready: TreeSetup;
      deps: DispatchDeps;
      /** Carried out separately so no caller re-establishes they are there.
       *  `suite` may be absent: a repository with no whole-suite command
       *  has no standing-suite veto, and the door has said so. */
      runOne: Proved;
      suite?: Proved;
    }
  | { ok: false; refusal: string };

/**
 * No repository-wide command, on purpose: every check runs with the command
 * of the part it lives in. The wide command is the fallback for a check
 * outside every part; empty, it reaches the gate, which reads it as "no
 * command runs this check" rather than running nothing and calling it green.
 */
function partsRunOne(_ready: TreeSetup): Proved {
  return provisional("", "every check runs with the command of the part it lives in");
}

/**
 * Whether this run can run one check and read its verdict: a repository-wide
 * command proved or told, or — a repository that is several parts — every
 * check's part with a proved command of its own.
 */
export function canJudgeOne(
  ready: { runOne?: string; parts?: Record<string, { runOne?: string }> },
  told: { runOne?: string } | undefined,
): boolean {
  if (ready.runOne || told?.runOne) return true;
  return Object.values(ready.parts ?? {}).some((p) => !!p.runOne);
}

export async function whatWeKnow(a: {
  deps: DispatchDeps;
  worktree: string;
  tep: string;
  /** The cut being run, to check its ground is still under it. */
  space: Space;
  cut: Cut;
  resumed: boolean;
  halted: () => boolean;
  exec: Parameters<typeof openTheDoor>[0]["exec"];
  boundedExec: Parameters<typeof openTheDoor>[0]["boundedExec"];
  log: (line: string) => void;
  defect: Parameters<typeof openTheDoor>[0]["defect"];
}): Promise<Known> {
  const { deps } = a;
  // The base may have moved under this cut since it was written — an
  // urgent fix with no ask behind it, merged in just above. A promise
  // grounded on code that is gone cannot be built as written, and no
  // worker can discover that: it fails every check for a reason none of
  // them can act on.
  const moved = await groundThatMoved({ worktree: a.worktree, space: a.space, cut: a.cut });
  if (moved.length) return { ok: false, refusal: regroundingNeeded(moved) };
  // What this repository already proved about itself, in an earlier run.
  // Candidates, not facts: the door runs each one again here, so a file
  // somebody edited by hand fails now rather than at a judgement.
  const known: RepositoryFacts | undefined = factsOf(deps.repoRoot);
  const ready = await openTheDoor({
    worktree: a.worktree,
    repoRoot: deps.repoRoot,
    tep: a.tep,
    ...(known ? { known } : {}),
    told: {
      ...deps.told,
      ...((): { parts?: Record<string, { runOne: string }>; runOne?: string } => {
        const parts = declaredPartCommands(deps.repoRoot);
        if (!Object.keys(parts).length) return {};
        // Each part says how one of its tests runs, so nothing repository-
        // wide is wanted: a guessed wide command that no test outside a
        // part can prove was carried anyway, and every check that fell to
        // it ran with the wrong part's runner.
        return { parts, runOne: "" };
      })(),
      ...(deps.resetup ? { resetup: deps.resetup } : {}),
      ...(deps.proveSetup ? { proveSetup: deps.proveSetup } : {}),
    },
    exec: a.exec,
    boundedExec: a.boundedExec,
    log: a.log,
    defect: a.defect,
    resumed: a.resumed,
    halted: a.halted,
  });
  if (ready.refusal) return { ok: false, refusal: ready.refusal };
  // ABSENT IS A FACT, NOT A REFUSAL. Most of this platform's components
  // have no tests yet, and Tandem's job on them is to create the first
  // check — a door that refuses to start without a provable suite locks
  // out the normal case, not an edge case. What absence removes is said
  // out loud: no whole-suite command means the standing-suite veto does
  // not apply to this repository, the same way no product build removes
  // that veto. A `runOne` with no test to prove it on is carried as told,
  // and proves itself in use the moment the tester's first check runs —
  // a candidate that cannot run yields "could not be judged", never a
  // verdict against the work.
  const downstream = downstreamOf(deps.repoRoot);
  // The parts a project is made of — each with its own toolchain. Said now
  // so the person sees what the survey found; criteria bind to them next.
  const parts = partsOf(deps.repoRoot);
  if (parts.length > 1)
    a.log(`this project has ${parts.length} parts: ${parts.map((p) => p.root).join(", ")} (${downstream})`);
  if (!ready.suite)
    a.log(
      `this repository has no whole-suite command that runs here — the standing-suite veto does not apply` +
        (downstream === "gitops-app" || downstream === "template"
          ? "; its declared tests run in the platform pipeline, after the merge"
          : ""),
    );
  if (!canJudgeOne(ready, deps.told)) return { ok: false, refusal: missing("runOne") };
  rememberWhatHeld(deps.repoRoot, known, { ...ready, downstream }, deps.told ?? {}, new Date().toISOString());
  const runOne =
    ready.runOne ??
    (deps.told?.runOne
      ? provisional(
          deps.told.runOne,
          "no test exists yet to prove it on — the first check the tester writes proves it in use",
          a.log,
        )
      : partsRunOne(ready));
  if (!ready.runOne && !deps.told?.runOne)
    a.log("no repository-wide single-test command: every check runs with the command of the part it lives in");
  return {
    ok: true,
    ready,
    runOne,
    ...(ready.suite ? { suite: ready.suite } : {}),
    deps: {
      ...deps,
      ...(ready.suite ? { suite: ready.suite } : {}),
      runOne,
      ...(ready.provision ? { provision: ready.provision } : {}),
      ...(ready.prepare ? { prepare: ready.prepare } : {}),
      ...(ready.build ? { build: ready.build } : {}),
    },
  };
}
