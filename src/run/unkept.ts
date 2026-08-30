/**
 * The ladder for an unkept promise, rung by rung, before the gate withholds.
 *
 * A red criterion at the gate goes back to the author that wrote its code
 * — as the next message in that author's own session, with the drive's
 * evidence and what changed since it stopped. Then the checks and the red
 * reviews are judged again. What is still unkept goes to the closer, with
 * the whole tree and full sight, scored by re-running exactly those checks.
 * What the closer cannot keep either is withheld — by name, on the
 * delivery's face — which is the honest end.
 *
 * A resumed run has no authors to resume: their sessions belonged to an
 * earlier process. Until the closer rung existed here, such a run fell
 * straight from red to withheld with nobody left to try.
 */
import type { Cut, Proof, Ruling, Space } from "../core/schema";
import { unkeptProof } from "../core/schema";
import type { SliceForDag } from "../engine/core/dag";
import { runAcVerifications } from "../engine/core/closingGate";
import type { AcVerification } from "../engine/core/closingGate";
import { gradeAssessments } from "./assess";
import { close } from "./closer";
import { repairByAuthors } from "./authorRepair";
import type { RedCriterion } from "./authorRepair";
import { prepareAtGate } from "./setup";
import type { BoundedExec } from "./setup";
import { provedByExecution } from "./wiring";
import type { DispatchDeps } from "./dispatch";
import type { Exec } from "./oracle";
import type { RunWorkerDeps, WorkerOutcome } from "./worker";

export async function repairUnkept(a: {
  tep: string;
  worktree: string;
  slices: SliceForDag[];
  space: Space;
  cut: Cut;
  deps: DispatchDeps;
  /** The gate's proofs; verdicts are updated in place as promises are kept. */
  proofs: Proof[];
  /** The person's list; a reviewer's OBSERVE verdict during repair joins it. */
  observations: string[];
  verifs: AcVerification[];
  probeOfAc: Map<number, string>;
  criterionByProbe: Map<string, string>;
  subjectsOf: (criterionId?: string) => string[];
  checkOf: Map<string, string>;
  sliceProbes: Map<string, string[]>;
  sessionOf: (unit: string) => string | undefined;
  /** Work a fenced unit wrote that the guard took back, with its change.
   *  The closer is fenced by nothing and reaches the same files. */
  restored?: readonly { path: string; patch: string }[];
  worker: (deps: RunWorkerDeps, brief: string) => Promise<WorkerOutcome>;
  baseSha: string;
  halted: () => boolean;
  /** Hand a closer round's abort to the run, so Stop can reach it. */
  abortable?: (abort: AbortController) => void;
  doing: (text: string | undefined) => void;
  rulings: Ruling[];
  exec: Exec;
  boundedExec: BoundedExec;
  suiteExec: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
  log: (line: string, step?: string) => void;
  defect: (entry: {
    slice?: string;
    unit?: string;
    activity: string;
    trigger: string;
    type?: string;
    qualifier?: string;
    stage?: "author" | "brief" | "check" | "clearance" | "altitude";
    impact: string;
    detail: string;
  }) => void;
}): Promise<Proof[]> {
  const { tep, worktree, slices, space, cut, deps, proofs, observations, verifs, probeOfAc, criterionByProbe, subjectsOf, exec, boundedExec, log, defect } = a;
  let unkept = proofs.filter(unkeptProof);
  // Each red criterion goes back to the unit that wrote its code, as the
  // next message in that unit's own session, with the drive's evidence and
  // what changed in the tree since it stopped. Then the checks run again.
  if (unkept.length && !a.halted()) {
    const unitOf = (criterionId?: string): string | undefined => {
      if (!criterionId) return undefined;
      for (const [slice, probes] of a.sliceProbes)
        if (probes.some((p) => criterionByProbe.get(p) === criterionId))
          return slices
            .find((s) => s.handle === slice)
            ?.workUnits.map((_, i) => `${slice}#eu-${i}`)
            .find((id) => a.sessionOf(id));
      return undefined;
    };
    const changedSince = (
      await exec("git", ["-C", worktree, "diff", "--name-only", `${a.baseSha}..HEAD`], worktree)
    ).out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const reds: RedCriterion[] = [];
    for (const p of unkept) {
      const unit = unitOf(p.criterionId);
      if (!unit) continue;
      const slice = unit.split("#")[0];
      reds.push({
        unit,
        text: p.label,
        evidence: p.ref ?? "the check did not pass",
        footprint: slices.find((s) => s.handle === slice)?.workUnits.flatMap((u) => u.footprint) ?? [],
      });
    }
    if (reds.length) {
      await repairByAuthors({
        reds,
        sessionOf: a.sessionOf,
        changedSince,
        worktree,
        model: deps.model,
        worker: a.worker,
        log: (line) => log(line),
        defect,
      });
      await prepareAtGate(deps.prepare, worktree, boundedExec, log);
      const again = await runAcVerifications(verifs, worktree, (run, cwd) => boundedExec(run, cwd));
      for (const r of again) {
        const probe = probeOfAc.get(r.ac);
        const criterionId = probe ? criterionByProbe.get(probe) : undefined;
        const label = (probe && a.checkOf.get(probe)) || `check ${r.ac}`;
        // By the criterion it proves; two checks can carry the same words.
        const proof = criterionId
          ? proofs.find((p) => p.criterionId === criterionId)
          : proofs.find((p) => p.label === label);
        if (!proof || !r.pass) continue;
        const wired = await provedByExecution({
          run: verifs.find((v) => v.ac === r.ac)?.run ?? "",
          subjects: subjectsOf(probe ? criterionByProbe.get(probe) : undefined),
          worktree,
          exec: boundedExec,
        });
        if (wired.executed === "no") continue;
        proof.verdict = "green";
        proof.ref = r.evidence?.slice(0, 300) ?? proof.ref;
      }
      unkept = proofs.filter(unkeptProof);
      log(`${tep}: after the authors' repairs, ${unkept.length} promise(s) are still unkept`);
    }
  }
  // The ladder's last rung, for criteria as it already is for the suite:
  // when the authors are spent — or, on a resumed run, were never there —
  // the closer takes the unkept promises with the whole tree and full
  // sight. Without it a resumed run fell straight from red to withheld
  // with nobody left to try, which is a ladder with its last rung missing.
  if (unkept.length && !a.halted()) {
    /**
     * Reviews that have already been asked again and did not move.
     *
     * A red assessment is re-graded because the closer's edits can change
     * the tree under it. But the closer runs several rounds, and re-grading
     * every red one in each of them asks the same reviewer the same
     * question about a tree its last answer already covered. One criterion
     * was graded five times across two runs and never once moved; the only
     * thing that bought was ten minutes a person sat watching.
     *
     * So a review is asked again ONCE per repair. If it does not move, it
     * is standing red, and the delivery says so by name.
     */
    const settled = new Set<string>();
    const rejudge = async (): Promise<Proof[]> => {
      await prepareAtGate(deps.prepare, worktree, boundedExec, log);
      // A red assessment is re-graded by a fresh reviewer over the repaired
      // tree, exactly as a check is re-run. Frozen first-pass verdicts held
      // three repaired promises red while the closer's edits could move
      // nothing but the tree.
      const redReviews = new Set(
        proofs
          .filter((p) => p.kind === "assessment" && unkeptProof(p) && !settled.has(p.label))
          .map((p) => p.label),
      );
      if (redReviews.size) {
        const regradedAll = await gradeAssessments({
          space,
          cut,
          testerWt: worktree,
          model: deps.workerModel?.workerModel ?? "sonnet",
          ...(deps.workerModel ? { workerModel: deps.workerModel } : {}),
          log,
          only: (label) => redReviews.has(label),
        });
        observations.push(...regradedAll.observations.filter((o) => !observations.includes(o)));
        // A promise the fresh reviewer now rules observable-only stops
        // being an unkept proof: it moves to the person's list by name.
        for (const o of regradedAll.observations) {
          const label = o.slice(0, 60);
          const stale = proofs.find((p) => p.kind === "assessment" && unkeptProof(p) && p.label.includes(label.slice(0, 40)));
          if (stale) stale.verdict = "green";
        }
        for (const r of regradedAll.proofs) {
          const proof = proofs.find((p) => p.label === r.label);
          if (proof) {
            // Asked again and unmoved: it is standing red, and asking a
            // third time cannot learn anything the second did not.
            if (proof.verdict === r.verdict && r.verdict !== "green") {
              settled.add(proof.label);
              log(`${tep}: "${proof.label.slice(0, 70)}" is red on a second reading — standing red, not asked again`);
            }
            proof.verdict = r.verdict;
            if (r.ref) proof.ref = r.ref;
          }
        }
      }
      const again = await runAcVerifications(verifs, worktree, (run, cwd) => boundedExec(run, cwd));
      for (const r of again) {
        const probe = probeOfAc.get(r.ac);
        const criterionId = probe ? criterionByProbe.get(probe) : undefined;
        const proof = criterionId
          ? proofs.find((p) => p.criterionId === criterionId)
          : proofs.find((p) => p.label === ((probe && a.checkOf.get(probe)) || `check ${r.ac}`));
        if (!proof) continue;
        if (!r.pass) {
          proof.verdict = "red";
          proof.ref = r.evidence?.slice(0, 300) ?? proof.ref;
          continue;
        }
        const wired = await provedByExecution({
          run: verifs.find((v) => v.ac === r.ac)?.run ?? "",
          subjects: subjectsOf(criterionId),
          worktree,
          exec: boundedExec,
        });
        proof.verdict = wired.executed === "no" ? "red" : "green";
        proof.ref = (wired.executed !== "yes" ? wired.detail : r.evidence)?.slice(0, 300) ?? proof.ref;
      }
      return proofs.filter(unkeptProof);
    };
    const closed = await close({
      subject: `${tep} (the unkept promises)`,
      worktree,
      footprint: slices.flatMap((sl) => sl.workUnits.flatMap((u) => u.footprint)),
      probeSources: [],
      history: unkept.map((p) => `${p.label}: ${(p.ref ?? "").split("\n")[0]}`).slice(0, 20),
      ...(a.restored?.length ? { restored: a.restored } : {}),
      criteria: unkept.map((p, i) => ({ id: p.criterionId ?? `unkept-${i}`, text: p.label })),
      ...(deps.digest ? { digest: deps.digest } : {}),
      ...(deps.prepare ? { prepare: deps.prepare } : {}),
      model: deps.model,
      ...(deps.workerModel ? { workerModel: deps.workerModel } : {}),
      measure: async () => {
        // The closer changed the tree, so every standing red is a
        // question about a file that has moved since it was asked. The
        // rule that stops a review being asked five times is about ONE
        // state of the tree; carried across a repair it froze a red the
        // closer had already fixed, and withheld the delivery for a
        // document that was correct on disk.
        settled.clear();
        const still = await rejudge();
        return {
          green: still.length === 0,
          score: still.length,
          evidence: still
            .map((p) => `- ${p.label}\n  ${(p.ref ?? "").split("\n").slice(0, 3).join("\n  ")}`)
            .join("\n")
            .slice(0, 8000),
        };
      },
      exec,
      boundedExec: a.suiteExec,
      halted: () => a.halted(),
      ...(a.abortable ? { abortable: a.abortable } : {}),
      log: (l) => log(l, "gate#closer"),
      say: (t) => a.doing(t),
      onRuling: (r) => a.rulings.push({ criterionId: r.criterionId, unit: r.unit, granted: r.granted, reason: r.reason }),
      defect: (e) => defect({ unit: "gate#closer", ...e }),
      ...(deps.worker ? { worker: deps.worker } : {}),
    });
    unkept = proofs.filter(unkeptProof);
    log(`${tep}: after the closer, ${unkept.length} promise(s) are ${closed.green ? "kept" : "still unkept"}`);
  }
  return proofs.filter(unkeptProof);
}
