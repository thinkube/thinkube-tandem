/**
 * The run between the gates, driven by the imported engine.
 *
 * Testers author probes and bring test homes under in a DETACHED SNAPSHOT
 * of the branch's committed HEAD (blinding is structural); their work
 * persists in the oracle store, keyed by the base commit. Each slice's
 * coder is graded by a black-box VERIFY ORACLE over the committed base plus
 * its own files and the slice's test homes; the oracle's green — never the
 * worker's claim — completes a unit (MANDATORY-GREEN). Every failure has
 * an owner and the owner gets the repair loop; a stopped run stops every
 * limb; ready units run concurrently on the engine's frontier; a finished
 * slice is committed on the branch. Every failure lands as an artifact —
 * UNDELIVERED, containment, red proofs — never as silence.
 */
import * as path from "node:path";
import { Cut, Delivery, ProofAnchor, Ruling, Space } from "../core/schema";
import type { SliceForDag } from "../engine/core/dag";
import { buildUnitDag } from "../engine/core/dag";
import { frontier } from "./frontier";
import { haltableExecs } from "./execs";
import { validateDag } from "../engine/methodology/parallelSlices";
import { ownership } from "./fence";
import { persistProbes, restoreProbes } from "../engine/oracleStore";
import { appendDefect } from "../engine/defectLog";
import { WorkerModelConfig } from "../engine/workerModel";
import { defaultExec, ensureSnapshot, makeChallenge, makeReauthor, makeRepair, OracleFactoryArgs, scrubbedEnv, sliceOracleFactory } from "./oracle";
import { refreshRunTrees, repairStandingTree } from "./refresh";
import { makeCommitBook } from "./commits";
import { makeEndAnswerer, makeParkAnswerer } from "./answers";
import { setupRunTree } from "./setup";
import { claimRunLock, coderTestPaths, plannedByPending, seedUnitViews } from "./plan";
import { probeSourceReader, settleTransfers } from "./owner";
import { makeDiagnoser } from "./diagnose";
import { unitCloser } from "./closeUnit";
import { buildOracleArgs } from "./oracleArgs";
import { runWaits } from "./waits";
import { runLogSink } from "./runLog";
import { watchForStall } from "./watchdog";
import { bindTestHomeConsumes } from "../dispatch/needs";
import { makeUnitRunner, renderTepBody, TesterInflight } from "./briefs";
import { Forge } from "../dispatch/forge";
import { RunState } from "./state";
import { sliceBookkeeping } from "./plan";
import { runUnitWorker, WorkerOutcome } from "./worker";
import { criterionLookup, rehomeProbes } from "./rehome";
import { closeGate } from "./gate";
import { overlapWaits } from "./frontier";
import { runReadRound } from "../derive/round";

export interface DispatchDeps {
  repoRoot: string;
  model: string;
  /** Per-role model resolution (judgment raised above the base). */
  workerModel?: WorkerModelConfig;
  suiteCommand: string[];
  forge?: Forge;
  state: RunState;
  spaceName: string;
  /** Project identity — qualifies branch and worktree names so two
   *  projects' runs in the same monorepo never collide (§7quater). */
  projectId?: string;
  /** The store dir for find-time defect rows (fail-soft; absent = no ledger). */
  storeDir?: string;
  /** The repository reading (conventions and the why) — every worker gets it in its brief:
   *  workers are the only actors that MAKE changes, so they must see what a change must respect. */
  digest?: string;
  /** How this repository's probes are written and run — a fact about the target repository;
   *  the default fits the node harness the oracle ships with. */
  testConvention?: string;
  /** What a fresh checkout needs installed — run once; its produce is linked into every runner. */
  provision?: string;
  /** How ONE of the repository's own tests runs (`<file>` = its path) — proved at setup. */
  runOne?: string;
  /** Test files red at an earlier gate — run early at every slice; told what stayed red at this one. */
  suiteReds?: readonly string[];
  rememberSuiteReds?: (files: readonly string[]) => void;
  /** Re-read the setup facts from a failure's evidence (the door tries the correction once). */
  resetup?: (evidence: string) => Promise<{ provision: string; prepare: string; runOne?: string }>;
  /** The door proved this setup on the untouched tree — remember it as the answer. */
  proveSetup?: (s: { provision: string; prepare: string; runOne: string }) => void;
  /** The code graph's importer listing for a path — orders each slice's
   *  test-home work after the production code those tests import. */
  affected?: (path: string) => Promise<string>;
  /** Build/typecheck command run in the verify runner and the gate
   *  worktree before checks — the engine's own prepare seam. */
  prepare?: string;
  /** Concurrent workers on the ready frontier (default 4, the v1 default). */
  concurrency?: number;
  /** Injectable for tests: how a unit sleeps waiting for another unit's
   *  commit — a wait nothing can fast-forward is a wait no test can reach. */
  waitSleep?: (ms: number, wake: (fn: () => void) => void) => Promise<void>;
  /** Injectable for tests: replaces the SDK worker. */
  worker?: (
    deps: Parameters<typeof runUnitWorker>[0],
    brief: string,
  ) => Promise<WorkerOutcome>;
  /** Injectable for tests: replaces the supervisor's SDK round. */
  supervisorRound?: typeof runReadRound;
  /** Injectable for tests: replaces the re-homing authoring round. */
  rehome?: typeof rehomeProbes;
  /** Injectable for tests: replaces the check re-author (challenge and repair). */
  author?: OracleFactoryArgs["author"];
  exec?: (cmd: string, args: string[], cwd: string) => Promise<{ code: number; out: string }>;
}

export interface DispatchOutcome {
  delivery?: Delivery;
  refusals: string[];
  undelivered: string[];
  url?: string;
  /** Where each criterion's standing check went on living — bound onto the acceptance criteria. */
  proofAnchors?: (ProofAnchor & { criterionId: string })[];
}
export async function dispatchTep(
  deps: DispatchDeps,
  space: Space,
  cut: Cut,
  slices: SliceForDag[],
): Promise<DispatchOutcome> {
  const exec = deps.exec ?? defaultExec;
  const st = deps.state;
  const tep = cut.tepId ?? cut.id;
  const runId = `${tep}@${Date.now().toString(36)}`; // one run's rows, apart from the next run of this cut
  const runName = deps.projectId ? `${deps.projectId}/${tep}` : tep;
  const branch = `tandem/${runName}`;
  const wtRoot = path.join(path.dirname(deps.repoRoot), `${path.basename(deps.repoRoot)}-worktrees`);
  const wtName = runName.replace(/\//g, "__");
  const worktree = path.join(wtRoot, wtName);
  const testerWt = path.join(wtRoot, `${wtName}-tester`);
  const storeDir = path.join(wtRoot, "oracle-store", wtName);
  if (deps.storeDir) st.sink = runLogSink(deps.storeDir, tep, runId);
  const log = (l: string, step?: string) => st.log(l, step);
  const env = scrubbedEnv();
  const { boundedExec, suiteExec } = haltableExecs(() => st.halted, env);

  const defect = (entry: {
    slice?: string;
    unit?: string;
    activity: string;
    trigger: string;
    type?: string;
    qualifier?: string;
    impact: string;
    detail: string;
  }): void => {
    if (deps.storeDir) appendDefect(deps.storeDir, { spec: tep, run: runId, ...entry });
  };

  const refuse = (trigger: string, refusal: string, type?: string): DispatchOutcome => {
    defect({ activity: "preflight", trigger, ...(type ? { type } : {}), impact: "run refused", detail: refusal.slice(0, 500) });
    return { refusals: [refusal], undelivered: [] };
  };

  const lock = await claimRunLock(wtRoot, wtName, runName, slices, { log });
  if (lock.refusal) return refuse("run-lock", lock.refusal);
  const unlock = lock.unlock;

  const watch = watchForStall({ st, units: () => [...st.units.values()], log: (l) => st.log(l), defect }); // a silent run says so and stops
  try {
  if (deps.affected) await bindTestHomeConsumes(slices, deps.affected, (l) => log(l));
  const dag = buildUnitDag(slices);
  const verdict = validateDag(dag) as { ok: boolean; error?: string };
  if (!verdict.ok)
    return refuse("plan-validation", `the engine refused the plan: ${JSON.stringify(verdict)}`);
  const misowned = coderTestPaths(slices);
  if (misowned.length)
    return refuse("plan-roles", `the plan hands a coder test-shaped paths — refused before dispatch: ${misowned.join(", ")}`);
  seedUnitViews(st, dag, slices); // the surface's view of every unit: role, edges, and why it waits

  const refreshed = await refreshRunTrees({ repoRoot: deps.repoRoot, branch, tep, worktree, testerWt, deps, exec, log, defect });
  if (refreshed.refusal) return refuse(refreshed.refusal.trigger, refreshed.refusal.refusal, "gate");
  log(`${tep}: worktree on ${branch}`);
  const doSetup = () =>
    setupRunTree({ worktree, exec, boundedExec, log, provision: deps.provision, prepare: deps.prepare, runOne: deps.runOne, resetup: deps.resetup, proven: deps.proveSetup });
  let ready = await doSetup();
  // A resumed branch an earlier run left half-committed is mended before the run refuses.
  if (ready.refusal && refreshed.resumed) {
    const rebuild = async () =>
      deps.prepare ? boundedExec(deps.prepare, worktree).then((r) => ({ ok: r.code === 0, words: r.output })) : { ok: true, words: "" };
    if (await repairStandingTree({ worktree, tep, refusal: ready.refusal, deps, exec, log, defect, halted: () => st.halted, rebuild })) ready = await doSetup();
  }
  if (ready.refusal) return refuse("setup", ready.refusal, "gate");
  const { provisioned, built, emitMap, runOne: runOneTest } = ready;
  if (ready.corrected) deps = { ...deps, ...ready.corrected };
  const baseSha = (await exec("git", ["-C", worktree, "rev-parse", "HEAD"], worktree)).out.trim();
  // Per-slice bookkeeping for the oracle + the slice-commit countdown.
  const { sliceProbes, sliceVerifs, sliceFiles, checkOf, rehomed } = sliceBookkeeping(slices);
  for (const h of rehomed) log(`⚖ check ${h.ac} of ${h.parent} is the maintainer's (${h.maintainer}): its words name a test home that unit brings under — graded there`);
  /** The tester's tree after a reset: probes back from the store, the test homes it edited over
   *  what the branch holds. Keyed to the CUT, so probes survive a base refresh. */
  const restoreTester = async (): Promise<void> => {
    await restoreProbes(storeDir, testerWt, cut.id);
  };
  await restoreTester();
  log(`${tep}: tester snapshot at ${path.basename(testerWt)} (structural blinding)`);

  // This run path has no separate spec artifact — the rendered TEP body is the whole intent.
  const tepBody = renderTepBody(space, cut);
  const undelivered: string[] = [];
  const done = new Set<string>();
  const failed = new Set<string>();
  const pending = new Set(dag.map((u) => u.id));

  // A slice an earlier run of this cut committed stands: done on the record, nothing re-runs; the gate re-proves it like all work.
  const standing = new Set(refreshed.committedSlices.filter((sl) => dag.some((u) => u.slice === sl)));
  for (const u of dag)
    if (standing.has(u.slice)) {
      done.add(u.id);
      pending.delete(u.id);
      st.set(u.id, "done");
    }

  const briefBySlice = new Map<string, string>();
  const acting = new Map<string, { unit: string }>();
  // The check behind an ordinal, from the space — never from the probe.
  const criterionOf = criterionLookup(slices, space);
  const rulings: Ruling[] = [];
  const decisions: { unit: string; text: string }[] = [];
  const oracleArgs = buildOracleArgs({
    deps, branch, wtRoot, tep: wtName, worktree, testerWt, cutId: cut.id, storeDir,
    sliceProbes, sliceVerifs, briefBySlice, acting, exec, boundedExec, suiteExec, log, defect,
    provisioned, built, emitMap, dag, slices, criterionOf, rulings, decisions, runOneTest,
    pending: (id: string) => !done.has(id) && !failed.has(id),
    plannedPending: () => plannedByPending(dag, done),
    changingNow: () => waits.door.changingNow(), // who is changing what right now (docs/WORDS.md)
    commitBeforeWaiting: (id, w) => waits.door.commitBeforeWaiting(id, w),
    halted: () => st.halted,
  });
  const buildOracle = sliceOracleFactory(oracleArgs);
  const challengeFor = makeChallenge(oracleArgs);
  const pendingPlanned = (): string[] => plannedByPending(dag, done), probeSourceFor = probeSourceReader(sliceProbes, testerWt);
  const parkFor = makeParkAnswerer(oracleArgs);
  const repairFor = makeRepair(oracleArgs);
  const diagnoseFor = makeDiagnoser(oracleArgs, makeReauthor(oracleArgs));
  const answerEnd = makeEndAnswerer(oracleArgs);

  const liveFootprints = new Map<string, { tree: string; paths: string[] }>();
  const waits = runWaits({ dag, done, failed, waiting: () => waiting, live: () => liveFootprints, tree: worktree, commitUnitWork: (id, w) => commitUnitWork(id, w) });
  const wakers = (sl: string, self: string) => waits.wakers(sl, self);
  const unionFor = ownership(dag, (u) => ((u.role ?? "code") === "test" ? testerWt : worktree));
  // Probes ride into the code tree at slice commit — the run's own copies, never a coder's strays.
  const testerPaths = [...new Set([...sliceProbes.values()].flat())];

  const testerState: TesterInflight = { count: 0, reset: Promise.resolve() };
  const { sliceCommitted, waiting, waitForCommit, commitUnitWork, failWith, finishUnit } = makeCommitBook({
    tep, branch, worktree, testerWt, dag, st, exec, log, undelivered, done, failed, standing, sliceProbes, sliceFiles,
    ...(deps.waitSleep ? { sleep: deps.waitSleep } : {}) });

  const closeUnit = unitCloser({
    worktree, testerWt, sliceProbes, sliceVerifs, criterionOf, st, exec, boundedExec, log, deps, rulings, undelivered, defect,
    heldElsewhere: () => [...liveFootprints.values()].filter((v) => v.tree === worktree).flatMap((v) => v.paths),
  });

  // The run of ONE unit lives in ./briefs — the pump below stays a loop.
  const runOne = makeUnitRunner({
    deps, tep, tepBody, branch, worktree, testerWt, storeDir, cutId: cut.id,
    st, log, defect, resumed: refreshed.resumed, dag, slices, built, emitMap,
    boundedExec, ensureSnapshot: ensureSnapshot as never, exec, restoreTester,
    buildOracle, acting, briefBySlice, decisions, undelivered, rulings, criterionOf,
    liveFootprints, unionFor, testerPaths, wakers, waitForCommit,
    challengeFor, parkFor, repairFor, diagnoseFor, answerEnd,
    closeUnit: closeUnit as never, probeSourceFor, settleTransfers: settleTransfers as never,
    pendingPlanned, failWith, finishUnit, persistProbes, testerState,
  });

  // The pump: launch what is ready up to the cap, wake on any completion.
  const concurrency = Math.max(1, deps.concurrency ?? 2);
  const inflight = new Map<string, Promise<void>>();
  while (!st.halted) {
    // The frontier refuses a unit whose footprint a running unit is writing — two coders in one file is a silent lost update.
    const ready = frontier(dag, {
      pending,
      done,
      failed,
      running: [...liveFootprints.values()].flatMap((v) => v.paths),
    });
    // A ready unit that is not launched says why: a slot, or a file it shares with a running unit.
    for (const [id, why] of overlapWaits(dag, pending, ready, liveFootprints, done)) st.doing(id, why);
    for (const u of ready) {
      if (inflight.size >= concurrency) {
        st.doing(u.id, `waiting for a free slot (${concurrency} running)`);
        break;
      }
      st.doing(u.id, undefined);
      pending.delete(u.id);
      // On the record synchronously with the launch — later leaves a window the next frontier cannot see.
      liveFootprints.set(u.id, {
        tree: (u.role ?? "code") === "test" ? testerWt : worktree,
        paths: u.footprint,
      });
          // A crash inside one unit is that unit's failure, on the record — never the run's end.
      const p = runOne(u)
        .catch(async (err) => {
          const why = err instanceof Error ? (err.stack ?? err.message) : String(err);
          log(`⛔ ${u.id}: crashed — ${why.split("\n")[0]}`, u.id);
          defect({ slice: u.slice, unit: u.id, activity: "unit execution", trigger: "crash", impact: "unit failed", detail: why.slice(0, 1200) });
          st.aborts.delete(u.id);
          liveFootprints.delete(u.id);
          if (u.role === "test") testerState.count = Math.max(0, testerState.count - 1);
          failWith(u.id, `crashed: ${why.split("\n")[0].slice(0, 200)}`);
          await finishUnit(u.id, u.slice, false);
        })
        .finally(() => {
          inflight.delete(u.id);
        });
      inflight.set(u.id, p);
    }
    if (inflight.size === 0) break;
    await Promise.race([...inflight.values()]);
  }
  await Promise.all([...inflight.values()]);
  // Never ran is not failed: a unit the run never reached says so, and the real failure stays findable.
  for (const id of pending)
    st.block(id, "never ran — the run stopped, or something it waits on failed");

  return await closeGate({
    tep, branch, baseSha, worktree, testerWt, slices, space, cut, deps,
    sliceProbes, sliceCommitted, checkOf, undelivered, rulings, decisions,
    exec, boundedExec, suiteExec, state: st, log, defect,
  });
  } finally {
    watch.stop();
    await unlock();
  }
}
