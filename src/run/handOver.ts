/**
 * Handing the work over.
 *
 * Everything before this decided whether the work may be delivered. This
 * is the delivery itself: the checks stay in the tree, the branch is
 * committed, and the record is assembled — the thing the person reads and
 * signs. Nothing is pushed: the branch is local until Accept lands it
 * (src/run/land.ts), so nothing unaccepted can reach a pipeline.
 *
 * It lives apart from the gate because it is a different job. The gate
 * judges; this hands over. Mixing them made one function that both decided
 * and acted, and every reading of it had to hold both at once.
 */
import type { Cut, Delivery, Proof, Space } from "../core/schema";
import type { TreeShape } from "../gates/moduleSizes";
import type { DispatchDeps } from "./deps";
import type { DispatchOutcome } from "./dispatch";
import { porcelainPaths } from "./worker";

export async function handOver(a: {
  tep: string;
  branch: string;
  worktree: string;
  space: Space;
  cut: Cut;
  deps: DispatchDeps;
  runId: string;
  producedAt: string;
  proofs: Proof[];
  observations: string[];
  undelivered: string[];
  findings: string[];
  /** The shape of this tree's modules, for the report to say. */
  moduleSizes?: TreeShape;
  rulings: Delivery["rulings"];
  decisions: Delivery["decisions"];
  kept: { path: string; criterionId: string }[];
  recordPath: string | undefined;
  exec: (cmd: string, args: string[], cwd: string) => Promise<{ code: number; out: string }>;
  log: (line: string) => void;
}): Promise<DispatchOutcome> {
  const { tep, branch, worktree, cut, deps, proofs, observations, undelivered, kept, recordPath, exec, log } = a;
  const { runId, producedAt, findings } = a;
  // The checks STAY: they are the proof the person paid for, and each
  // carries the promise it proves, which is what lets a later cut retire
  // it. They were deleted because nothing could — and a check outliving
  // its promise drags the code backwards, a worker seeing it red and
  // rebuilding what was deliberately changed. A slice's tester now
  // inherits every check pinning the files it touches.
  log(`${tep}: ${kept.length} check(s) recorded on the delivery and kept in the tree`);
  log(`${tep}: committing the delivery`);
  await exec("git", ["add", "-A", "."], worktree);
  // A cut whose proofs left nothing new in the tree (every criterion
  // already settled, or graded but never written to disk) has no changes
  // to commit — running `git commit` anyway fails where the shell answers
  // non-zero as a thrown error rather than a code, so the dirty tree is
  // checked first and the commit is skipped when there is nothing to record.
  if ((await porcelainPaths(worktree)).length) {
    await exec("git", ["commit", "-m", `tandem: deliver ${tep}`], worktree);
  } else {
    log(`${tep}: nothing new to commit for the delivery`);
  }
  const deliveredHead = (await exec("git", ["-C", worktree, "rev-parse", "HEAD"], worktree)).out.trim();
  // A criterion's proof lives on the delivery record, not in a test file.
  const proofAnchors: NonNullable<DispatchOutcome["proofAnchors"]> = recordPath
    ? kept.map((c) => ({
        criterionId: c.criterionId,
        path: recordPath,
        stamp: [{ root: deps.repoRoot, head: deliveredHead, dirty: "" }],
      }))
    : [];
  const delivery: Delivery = {
    id: `delivery-${tep}`,
    ...(findings.length ? { findings } : {}),
    ...(a.moduleSizes ? { moduleSizes: a.moduleSizes } : {}),
    cutId: cut.id,
    branch,
    runId,
    producedAt,
    proofs,
    ...(observations.length ? { observations } : {}),
    ...(undelivered.length ? { undelivered } : {}),
    ...(a.rulings?.length ? { rulings: a.rulings } : {}),
    ...(a.decisions?.length ? { decisions: a.decisions } : {}),
  };
  log(`${tep}: the branch ${branch} holds the delivery — Accept merges and pushes it`);
  return {
    refusals: [],
    undelivered,
    ...(proofAnchors.length ? { proofAnchors } : {}),
    delivery,
  };
}
