/**
 * Everything the slice oracle and its arbiters read, assembled once: the
 * trees, the checks, the plan's ownership, and the powers a ruling may
 * exercise. It lives apart from the pump so the run's own loop stays
 * readable.
 */
import { waitOrStop } from "./waiting";
import type { AcVerification } from "../engine/core/closingGate";
import type { SliceForDag, SchedUnit } from "../engine/core/dag";
import { maintainedElsewhere } from "./plan";
import { makeClearance } from "./clearance";
import { sliceSuiteArgs } from "./suite";
import type { OracleFactoryArgs, Exec } from "./oracle";
import type { DispatchDeps } from "./dispatch";
import type { OracleAcResult } from "../engine/verifyOracle";

export function buildOracleArgs(a: {
  deps: DispatchDeps;
  branch: string;
  wtRoot: string;
  tep: string;
  worktree: string;
  testerWt: string;
  cutId: string;
  sliceProbes: Map<string, string[]>;
  sliceVerifs: Map<string, AcVerification[]>;
  briefBySlice: Map<string, string>;
  acting: Map<string, { unit: string }>;
  exec: Exec;
  boundedExec: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
  suiteExec: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
  log: (line: string, step?: string) => void;
  defect: OracleFactoryArgs["defect"];
  provisioned: string[];
  built: string[];
  dag: SchedUnit[];
  slices: SliceForDag[];
  criterionOf: (slice: string, ac: number) => { id: string; text: string } | undefined;
  rulings: { criterionId: string; unit: string; granted: boolean; reason: string }[];
  decisions: { unit: string; text: string }[];
  runOneTest: string | ((file: string) => string);
  pending: (unitId: string) => boolean;
  plannedPending: () => string[];
  /** Who is changing which files at this moment — the door reads it. */
  changingNow: () => ReadonlyMap<string, readonly string[]>;
  /** Commit a waiting unit's work, so it holds nothing while it waits. */
  commitBeforeWaiting: (unitId: string, why: string) => Promise<void>;
  halted: () => boolean;
  /** The run's stop signal, so every wait under the oracle hears Stop at
   *  once instead of finishing its sleep first. */
  stop?: AbortSignal;
  /** Every per-AC results verdict a slice's oracle produces — the run's
   *  own account of which criteria passed. */
  onGrade?: (slice: string, results: readonly OracleAcResult[]) => void;
}): OracleFactoryArgs {
  const { deps, dag, slices, rulings } = a;
  return {
    repoRoot: deps.repoRoot,
    branch: a.branch,
    wtRoot: a.wtRoot,
    tep: a.tep,
    worktree: a.worktree,
    testerWt: a.testerWt,
    sliceProbes: a.sliceProbes,
    sliceVerifs: a.sliceVerifs,
    briefBySlice: a.briefBySlice,
    acting: (slice: string) => a.acting.get(slice),
    model: deps.model,
    workerModel: deps.workerModel,
    supervisorRound: deps.supervisorRound,
    exec: a.exec,
    boundedExec: a.boundedExec,
    log: a.log,
    defect: a.defect,
    ...(a.onGrade ? { onGrade: a.onGrade } : {}),
    ...(deps.prepare ? { prepare: deps.prepare } : {}),
    provisioned: a.provisioned,
    built: a.built,
    footprintOf: (slice: string) =>
      dag.filter((u) => u.slice === slice && (u.role ?? "code") === "code").flatMap((u) => u.footprint),
    pruneIn: (slice: string) => maintainedElsewhere(slices, slice),
    criterionOf: a.criterionOf,
    onRuling: (r) => rulings.push({ criterionId: r.criterionId, unit: r.slice, granted: r.granted, reason: r.reason }),
    ...(deps.author ? { author: deps.author } : {}),
    ...(deps.digest ? { digest: deps.digest } : {}),
    clearance: makeClearance({
      units: dag,
      changingNow: a.changingNow,
      commitBeforeWaiting: a.commitBeforeWaiting,
      halted: a.halted,
      sleep: async (ms) => void (await waitOrStop(ms, a.stop)),
      log: a.log,
      onRuling: (r) => rulings.push(r),
      defect: a.defect,
    }),
    onDecision: (unit: string, text: string) => a.decisions.push({ unit, text }),
    // The repository's standing tests are every slice's check, scoped to what imports its files.
    suite: sliceSuiteArgs({
      runOne: a.runOneTest,
      exec: a.suiteExec,
      affected: deps.affected,
      reds: deps.suiteReds,
      slices,
      pendingPlanned: a.plannedPending,
    }),
  };
}
