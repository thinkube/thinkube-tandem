/**
 * Everything the slice oracle and its arbiters read, assembled once: the
 * trees, the checks, the plan's ownership, and the powers a ruling may
 * exercise. It lives apart from the pump so the run's own loop stays
 * readable.
 */
import type { AcVerification } from "../engine/core/closingGate";
import type { SliceForDag, SchedUnit } from "../engine/core/dag";
import { persistProbes } from "../engine/oracleStore";
import { maintainedElsewhere } from "./plan";
import { makeWiden } from "./owner";
import { sliceSuiteArgs } from "./suite";
import type { OracleFactoryArgs, Exec } from "./oracle";
import type { DispatchDeps } from "./dispatch";

export function buildOracleArgs(a: {
  deps: DispatchDeps;
  branch: string;
  wtRoot: string;
  tep: string;
  worktree: string;
  testerWt: string;
  cutId: string;
  storeDir: string;
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
  emitMap?: string[];
  dag: SchedUnit[];
  slices: SliceForDag[];
  criterionOf: (slice: string, ac: number) => { id: string; text: string } | undefined;
  rulings: { criterionId: string; unit: string; granted: boolean; reason: string }[];
  decisions: { unit: string; text: string }[];
  runOneTest: string;
  pending: (unitId: string) => boolean;
  plannedPending: () => string[];
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
    ...(deps.prepare ? { prepare: deps.prepare } : {}),
    provisioned: a.provisioned,
    built: a.built,
    ...(a.emitMap?.length ? { emitMap: a.emitMap } : {}),
    footprintOf: (slice: string) =>
      dag.filter((u) => u.slice === slice && (u.role ?? "code") === "code").flatMap((u) => u.footprint),
    pruneIn: (slice: string) => maintainedElsewhere(slices, slice),
    criterionOf: a.criterionOf,
    onRuling: (r) => rulings.push({ criterionId: r.criterionId, unit: r.slice, granted: r.granted, reason: r.reason }),
    persistProbe: (rel: string) => persistProbes(a.storeDir, a.testerWt, [rel], a.cutId),
    ...(deps.author ? { author: deps.author } : {}),
    ...(deps.digest ? { digest: deps.digest } : {}),
    widen: makeWiden({ units: dag, pending: a.pending, log: a.log, onRuling: (r) => rulings.push(r) }),
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
