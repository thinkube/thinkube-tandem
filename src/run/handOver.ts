/**
 * Handing the work over.
 *
 * Everything before this decided whether the work may be delivered. This
 * is the delivery itself: the checks stay in the tree, the branch is
 * committed and pushed, the forge is asked to open it, and the record is
 * assembled — the thing the person reads and signs.
 *
 * It lives apart from the gate because it is a different job. The gate
 * judges; this hands over. Mixing them made one function that both decided
 * and acted, and every reading of it had to hold both at once.
 */
import type { Cut, Delivery, Proof } from "../core/schema";
import type { DispatchDeps } from "./deps";
import type { DispatchOutcome } from "./dispatch";

export async function handOver(a: {
  tep: string;
  branch: string;
  worktree: string;
  cut: Cut;
  deps: DispatchDeps;
  runId: string;
  producedAt: string;
  proofs: Proof[];
  observations: string[];
  undelivered: string[];
  findings: string[];
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
  log(`${tep}: committing and opening the delivery`);
  await exec("git", ["add", "-A", "."], worktree);
  await exec("git", ["commit", "-m", `tandem: deliver ${tep}`], worktree);
  const deliveredHead = (await exec("git", ["-C", worktree, "rev-parse", "HEAD"], worktree)).out.trim();
  // A criterion's proof lives on the delivery record, not in a test file.
  const proofAnchors: NonNullable<DispatchOutcome["proofAnchors"]> = recordPath
    ? kept.map((c) => ({
        criterionId: c.criterionId,
        path: recordPath,
        stamp: [{ root: deps.repoRoot, head: deliveredHead, dirty: "" }],
      }))
    : [];
  const pushed = await exec("git", ["push", "-u", "origin", branch, "--force"], worktree);
  let url: string | undefined;
  if (pushed.code === 0 && deps.forge) {
    try {
      url = await deps.forge.openDelivery({
        branch,
        title: `Tandem delivery: ${tep}`,
        body:
          `Delivered by run ${runId} for ${tep}, produced at ${producedAt}.\n\n` +
          (observations.length
            ? `FOR YOU TO CERTIFY — the machine cannot observe the running product:\n${observations.map((o) => `- ${o}`).join("\n")}\n\n`
            : "") +
          (undelivered.length ? `UNDELIVERED:\n${undelivered.map((u) => `- ${u}`).join("\n")}\n\n` : "") +
          `Proofs:\n${proofs.map((p) => `- ${p.label}: ${p.verdict}${p.settledBy ? ` (settled by ${p.settledBy})` : ""}`).join("\n")}`,
      });
    } catch (err) {
      log(`forge refused the delivery: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (pushed.code !== 0) {
    proofs.push({ kind: "ci", label: "push", verdict: "red" });
  }
  const delivery: Delivery = {
    id: `delivery-${tep}`,
    ...(findings.length ? { findings } : {}),
    cutId: cut.id,
    branch,
    runId,
    producedAt,
    proofs,
    ...(observations.length ? { observations } : {}),
    ...(url ? { url } : {}),
    ...(undelivered.length ? { undelivered } : {}),
    ...(a.rulings?.length ? { rulings: a.rulings } : {}),
    ...(a.decisions?.length ? { decisions: a.decisions } : {}),
  };
  return {
    refusals: [],
    undelivered,
    url,
    ...(proofAnchors.length ? { proofAnchors } : {}),
    delivery,
  };
  return {
    refusals: [],
    undelivered,
    url,
    ...(proofAnchors.length ? { proofAnchors } : {}),
    delivery,
  };
}
