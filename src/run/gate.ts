/**
 * The closing gate: everything after the last unit — probes ride the
 * branch, the delivered tree is built, every check runs, assessments are
 * graded by a fresh reviewer, the honesty scan reads the diff, the
 * repository's own suite decides, standing checks re-home, and the
 * delivery is recorded and opened.
 *
 * A red suite is not delivered. The work may satisfy its own checks and
 * still leave the repository's standing checks red; that delivery is
 * withheld — recorded, with the reason in intent terms — never handed over
 * red for the human to finish.
 */
import { Cut, Delivery, Proof, Ruling, Space } from "../core/schema";
import type { SliceForDag } from "../engine/core/dag";
import { runAcVerifications } from "../engine/core/closingGate";
import { resolveWorkerModel } from "../engine/workerModel";
import { gradeAssessments, logRedChecks } from "./assess";
import { copyRel } from "./oracle";
import type { Exec } from "./oracle";
import { prepareAtGate } from "./setup";
import type { BoundedExec } from "./setup";
import {
  closingVerifications,
  confessedDeferrals,
  docsObligations,
  writeDeliveryRecord,
} from "./plan";
import { porcelainPaths } from "./worker";
import { criterionMapOf, rehomeAtGate, rehomeProbes } from "./rehome";
import type { DispatchDeps, DispatchOutcome } from "./dispatch";

export interface GateContext {
  tep: string;
  branch: string;
  baseSha: string;
  worktree: string;
  testerWt: string;
  slices: SliceForDag[];
  space: Space;
  cut: Cut;
  deps: DispatchDeps;
  sliceProbes: Map<string, string[]>;
  sliceTestHomes: Map<string, string[]>;
  sliceCommitted: Set<string>;
  checkOf: Map<string, string>;
  undelivered: string[];
  rulings: Ruling[];
  decisions: { unit: string; text: string }[];
  exec: Exec;
  boundedExec: BoundedExec;
  log: (line: string, step?: string) => void;
  defect: (entry: {
    slice?: string;
    unit?: string;
    activity: string;
    trigger: string;
    type?: string;
    qualifier?: string;
    impact: string;
    detail: string;
  }) => void;
}

/** The reason a red suite withholds the delivery — intent-level, no internals. */
export const RED_SUITE_REFUSAL =
  "the repository's standing checks are red after the work — the delivery is withheld " +
  "rather than handed over red; the branch keeps the work and the run record keeps the " +
  "suite's verdict (if the repository was already red before, it must be green first)";

export async function closeGate(g: GateContext): Promise<DispatchOutcome> {
  const { tep, branch, worktree, testerWt, slices, space, cut, deps, exec, boundedExec, log, defect } = g;
  const undelivered = g.undelivered;
  log(`${tep}: closing gate`);
  // Probes and test homes ride the branch: any not yet copied by a slice
  // commit (failed or halted slices) still land in the code worktree so the
  // gate's verdict is about the real state, not about a missing file.
  for (const [slice, probes] of g.sliceProbes)
    if (!g.sliceCommitted.has(slice))
      for (const rel of [...probes, ...(g.sliceTestHomes.get(slice) ?? [])])
        await copyRel(testerWt, worktree, rel).catch(() => {});
  const { verifs, probeOfAc } = closingVerifications(slices);
  await prepareAtGate(deps.prepare, worktree, boundedExec, log);
  const acResults = await runAcVerifications(verifs, worktree, (run, cwd) => boundedExec(run, cwd));
  // Assessments: a FRESH reviewer over the DELIVERED tree, fail-soft red.
  const assessed = await gradeAssessments({
    space,
    cut,
    testerWt: worktree,
    model: deps.workerModel?.workerModel ?? "sonnet",
    ...(deps.workerModel ? { workerModel: deps.workerModel } : {}),
    log,
    onRed: (label, ref) =>
      defect({
        activity: "closing gate",
        trigger: "assessment",
        type: "code",
        impact: "assessment check red",
        detail: `${label} — ${ref}`.slice(0, 400),
      }),
  });
  // Named by the CHECK it ran — an ordinal names nothing to a reader.
  const criterionByProbe = criterionMapOf(slices);
  const proofs: Proof[] = assessed.concat(
    acResults.map((r) => {
      const probe = probeOfAc.get(r.ac);
      const criterionId = probe ? criterionByProbe.get(probe) : undefined;
      return {
        kind: "probe" as const,
        label: (probe && g.checkOf.get(probe)) || `check ${r.ac}`,
        verdict: r.pass ? ("green" as const) : ("red" as const),
        ...(r.evidence ? { ref: r.evidence.slice(0, 200) } : {}),
        ...(criterionId ? { criterionId } : {}),
      };
    }),
  );
  logRedChecks(acResults, defect);

  undelivered.push(
    ...(await confessedDeferrals({
      worktree,
      baseSha: g.baseSha,
      exec,
      extraPaths: await porcelainPaths(worktree),
      onHit: (file, line, text) =>
        defect({
          activity: "closing gate",
          trigger: "stub-scan",
          qualifier: "missing",
          impact: "undelivered surfaced",
          detail: `${file}:${line} ${text}`,
        }),
    })),
  );
  const suite = await exec(deps.suiteCommand[0], deps.suiteCommand.slice(1), worktree);
  proofs.push({ kind: "suite", label: "repo suite", verdict: suite.code === 0 ? "green" : "red" });

  if (suite.code !== 0) {
    log(`⛔ ${tep}: the repository's suite is red after the work — the delivery is withheld`);
    defect({
      activity: "closing gate",
      trigger: "suite",
      type: "code",
      impact: "delivery withheld",
      detail: suite.out.trim().split("\n").slice(-12).join("\n").slice(0, 1000),
    });
    if (deps.storeDir)
      await writeDeliveryRecord(deps.storeDir, { tep, branch, baseSha: g.baseSha, proofs, undelivered, verifs, acResults });
    undelivered.push(...docsObligations(slices, worktree));
    await exec("git", ["add", "-A", "."], worktree);
    await exec("git", ["commit", "-m", `tandem: ${tep} (suite red — withheld)`], worktree);
    return { refusals: [RED_SUITE_REFUSAL], undelivered };
  }

  // Re-home the delivery's standing checks: probes leave their delivery
  // coordinates and join the repository's own suite at each promise's
  // module test home, the criterion recording where its proof went on living.
  const rehomedAnchors = await rehomeAtGate({
    worktree,
    space,
    criterionByProbe,
    model: resolveWorkerModel(deps.workerModel ?? { workerModel: deps.model }, "code"),
    ...(deps.digest ? { digest: deps.digest } : {}),
    ...(deps.testConvention ? { testConvention: deps.testConvention } : {}),
    suite: async () =>
      (await exec(deps.suiteCommand[0], deps.suiteCommand.slice(1), worktree)).code === 0,
    exec,
    log,
    rehome: deps.rehome ?? rehomeProbes,
  });

  if (deps.storeDir)
    await writeDeliveryRecord(deps.storeDir, { tep, branch, baseSha: g.baseSha, proofs, undelivered, verifs, acResults });
  undelivered.push(...docsObligations(slices, worktree));

  log(`${tep}: committing and opening the delivery`);
  await exec("git", ["add", "-A", "."], worktree);
  await exec("git", ["commit", "-m", `tandem: deliver ${tep}`], worktree);
  const deliveredHead = (await exec("git", ["-C", worktree, "rev-parse", "HEAD"], worktree)).out.trim();
  const proofAnchors: NonNullable<DispatchOutcome["proofAnchors"]> = rehomedAnchors.map((a) => ({
    criterionId: a.criterionId,
    path: a.path,
    ...(a.test ? { test: a.test } : {}),
    stamp: [{ root: deps.repoRoot, head: deliveredHead, dirty: "" }],
  }));
  const pushed = await exec("git", ["push", "-u", "origin", branch, "--force"], worktree);
  let url: string | undefined;
  if (pushed.code === 0 && deps.forge) {
    try {
      url = await deps.forge.openDelivery({
        branch,
        title: `Tandem delivery: ${tep}`,
        body:
          `Delivered by the tandem run for ${tep}.\n\n` +
          (undelivered.length ? `UNDELIVERED:\n${undelivered.map((u) => `- ${u}`).join("\n")}\n\n` : "") +
          `Proofs:\n${proofs.map((p) => `- ${p.label}: ${p.verdict}`).join("\n")}`,
      });
    } catch (err) {
      log(`forge refused the delivery: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (pushed.code !== 0) {
    proofs.push({ kind: "ci", label: "push", verdict: "red" });
  }
  const delivery: Delivery = {
    id: `delivery-${tep}`,
    cutId: cut.id,
    branch,
    proofs,
    ...(url ? { url } : {}),
    ...(undelivered.length ? { undelivered } : {}),
    ...(g.rulings.length ? { rulings: g.rulings } : {}),
    ...(g.decisions.length ? { decisions: g.decisions } : {}),
  };
  return {
    refusals: [],
    undelivered,
    url,
    ...(proofAnchors.length ? { proofAnchors } : {}),
    delivery,
  };
}
