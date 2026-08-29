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
import { missing, type Proved } from "./proved";
import type { DispatchDeps } from "./deps";

export type Known =
  | {
      ok: true;
      ready: TreeSetup;
      deps: DispatchDeps;
      /** The two a judgement rests on, carried out separately so no caller
       *  has to re-establish that they are there. */
      runOne: Proved;
      suite: Proved;
    }
  | { ok: false; refusal: string };

export async function whatWeKnow(a: {
  deps: DispatchDeps;
  worktree: string;
  tep: string;
  resumed: boolean;
  halted: () => boolean;
  exec: Parameters<typeof openTheDoor>[0]["exec"];
  boundedExec: Parameters<typeof openTheDoor>[0]["boundedExec"];
  log: (line: string) => void;
  defect: Parameters<typeof openTheDoor>[0]["defect"];
}): Promise<Known> {
  const { deps } = a;
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
  // The two the judgements rest on. Everything else may legitimately be
  // absent — a repository that needs no install, or ships nothing built —
  // and the door says so out loud rather than leaving it to silence.
  if (!ready.suite) return { ok: false, refusal: missing("suite") };
  if (!ready.runOne) return { ok: false, refusal: missing("runOne") };
  rememberWhatHeld(deps.repoRoot, known, ready, deps.told ?? {}, new Date().toISOString());
  return {
    ok: true,
    ready,
    runOne: ready.runOne,
    suite: ready.suite,
    deps: {
      ...deps,
      suite: ready.suite,
      runOne: ready.runOne,
      ...(ready.provision ? { provision: ready.provision } : {}),
      ...(ready.prepare ? { prepare: ready.prepare } : {}),
      ...(ready.build ? { build: ready.build } : {}),
    },
  };
}
