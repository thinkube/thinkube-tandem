/**
 * The run between the gates, driven by the imported engine.
 *
 * One tree per repository. The tester writes its checks beside the code
 * and the coder is kept off them by permission, not by absence: the guard
 * refuses a blinded author any test-shaped path. Each slice's coder is
 * graded by a black-box VERIFY ORACLE over the committed base plus its own
 * files; the oracle's green — never the worker's claim — completes a unit
 * (MANDATORY-GREEN). Every failure has
 * an owner and the owner gets the repair loop; a stopped run stops every
 * limb; ready units run concurrently on the engine's frontier; a finished
 * slice is committed on the branch. Every failure lands as an artifact —
 * UNDELIVERED, containment, red proofs — never as silence.
 */
import * as path from "node:path";
import { Cut, Delivery, ProofAnchor, Ruling, Space } from "../core/schema";
import type { SliceForDag } from "../engine/core/dag";
import { pumpUnits } from "./pump";
import { unitsAtOnce } from "./cpuAllowance";
import { buildWorkerPrompt } from "../engine/core/preflight";
import { haltableExecs } from "./execs";
import { ownership } from "./fence";
import { MAX_REWORK_ATTEMPTS } from "../engine/core/redispatch";
import { formatVerifyReply } from "../engine/verifyOracle";
import { appendDefect } from "../engine/defectLog";
import { resolveWorkerModel } from "../engine/workerModel";
import { defaultExec, scrubbedEnv, sliceOracleFactory } from "./oracle";
import { makeChallenge, makeReauthor, makeRepair } from "./challenge";
import { refreshRunTrees } from "./refresh";
import { discardRunBranch } from "./freshStart";
import { makeCommitBook } from "./commits";
import { makeEndAnswerer, makeParkAnswerer } from "./answers";
import { confirmWaitingForTree, verifyWithRepair } from "./repair";
import { whatWeKnow } from "./whatWeKnow";
import { runnerFor } from "./proved";
import { briefWithInherited, briefWithNames } from "./contractNames";
import { putBackDeliveredChecks, recordedCheckHomes, recordedCheckPaths } from "./recordedChecks";
import { planRecordOf } from "./record";
import { claimRunLock, isMaintainUnit, maintainedElsewhere, plannedByPending, seedUnitViews, standingSlices } from "./plan";
import { probeSourceReader, settleTransfers } from "./owner";
import { makeDiagnoser } from "./diagnose";
import { finishAuthoring } from "./authoring";
import { unitCloser } from "./closeUnit";
import { buildOracleArgs } from "./oracleArgs";
import { runWaits } from "./waits";
import { formatBuild } from "./execs";
import { runLogSink } from "./runLog";
import { watchForStall } from "./watchdog";
import { bindTestHomeConsumes } from "../dispatch/needs";
import { renderTepBody } from "./briefs";
import { clearanceStanza, coderStanza, testerStanza } from "./brief";
import { sliceBookkeeping } from "./plan";
import { refusedBeforeDispatch } from "./refusals";
import { runUnitWorker, porcelainPaths } from "./worker";
import type { DispatchDeps } from "./deps";
export type { DispatchDeps } from "./deps";
import { criterionLookup } from "./criteria";
import { closeGate } from "./gate";
import { decisionsStanza, extractDecisions, isProbePath, isTestPath, missingProbes, repoTestFiles, testerTurns, testHomesOf, testHomesStanza, testHomeWorkOf } from "./testHomes";

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
  const worker = deps.worker ?? runUnitWorker;
  const st = deps.state;
  const tep = cut.tepId ?? cut.id;
  // One reading of the run's clock mints both facts: the id heading this
  // run's rows in the log, and the produced-at stamp its delivery carries.
  // Two separate reads could straddle a clock tick and name two moments as
  // if they were one.
  const now = deps.now ?? Date.now;
  const producedAtMs = now();
  const producedAt = new Date(producedAtMs).toISOString();
  const runId = `${tep}@${producedAtMs.toString(36)}`; // one run's rows, apart from the next run of this cut
  st.setRunId(runId);
  const runName = deps.projectId ? `${deps.projectId}/${tep}` : tep;
  const branch = `tandem/${runName}`;
  const wtRoot = path.join(path.dirname(deps.repoRoot), `${path.basename(deps.repoRoot)}-worktrees`);
  const wtName = runName.replace(/\//g, "__");
  const worktree = path.join(wtRoot, wtName);
  // One tree per repository. The tester writes its checks beside the code,
  // and the coder is kept off them by permission — the guard refuses a
  // blinded coder any test-shaped path (src/run/worker.ts). A second tree
  // bought the same blinding structurally and charged for it in every
  // mechanism that had to reconcile the two: the probe store, the runner
  // overlay, the closer's fix written where nothing commits.
  const testerWt = worktree;
  if (deps.storeDir) st.sink = runLogSink(deps.storeDir, tep, runId);
  const log = (l: string, step?: string) => st.log(l, step);
  const env = scrubbedEnv();
  const { boundedExec, suiteExec } = haltableExecs(() => st.halted, env);

  /**
   * Attention events ABOUT THE MACHINE — the number this design is judged
   * by, counted where the rows are written rather than reconstructed later.
   *
   * A question about the WORK is legitimate and designed in. A stall, a
   * crash, a run that refused itself, a unit failed for something it could
   * not reach: each is a moment a person had to interpret the machine, and
   * each is a defect of the machine.
   */
  const MACHINE_ATTENTION = new Set([
    "watchdog", "crash", "run-lock", "setup", "worktree", "refresh-conflict",
    "plan-validation", "plan-roles", "signature-drift", "gate-infra", "window-reload",
  ]);
  let machineAttention = 0;

  const defect = (entry: {
    slice?: string;
    unit?: string;
    activity: string;
    trigger: string;
    type?: string;
    qualifier?: string;
    /** Which stage a repair implicates (docs/TARGET.md §4). */
    stage?: "author" | "brief" | "check" | "clearance" | "altitude";
    impact: string;
    detail: string;
  }): void => {
    if (MACHINE_ATTENTION.has(entry.trigger)) machineAttention++;
    if (deps.storeDir) appendDefect(deps.storeDir, { spec: tep, run: runId, ...entry }, now);
  };

  const refuse = (trigger: string, refusal: string, type?: string): DispatchOutcome => {
    // Said, not only recorded. A refusal that goes to the defect ledger
    // alone leaves the run's own log ending mid-sentence, and the person
    // reading it has no idea why nothing happened.
    log(`⛔ ${tep}: ${refusal}`);
    defect({ activity: "preflight", trigger, ...(type ? { type } : {}), impact: "run refused", detail: refusal.slice(0, 500) });
    return { refusals: [refusal], undelivered: [] };
  };

  const lock = await claimRunLock(wtRoot, wtName, runName, slices, { log });
  if (lock.refusal) return refuse("run-lock", lock.refusal);
  const unlock = lock.unlock;

  const watch = watchForStall({
    st,
    units: () => [...st.units.values()],
    log: (l) => st.log(l),
    defect,
    ...(deps.maxRunMs ? { maxMs: deps.maxRunMs } : {}),
  }); // a silent run says so and stops
  try {
  if (deps.affected) await bindTestHomeConsumes(slices, deps.affected, (l) => log(l));
  const before = await refusedBeforeDispatch({
    slices,
    space,
    cut,
    repoRoot: deps.repoRoot,
    branch,
    ...(deps.storeDir ? { recordedChecks: recordedCheckPaths(deps.storeDir, tep), recordedHomes: recordedCheckHomes(deps.storeDir, tep) } : {}),
    ...(deps.graphPath ? { graphPath: deps.graphPath } : {}),
    exec,
    log: (l) => log(`${tep}: ${l}`),
    defect,
  });
  const dag = before.dag;
  st.plan = planRecordOf(slices); // kept even when refused — that is the case a later rule must keep refusing
  if (before.refusal) return refuse(before.refusal.trigger, before.refusal.refusal, "gate");
  seedUnitViews(st, dag, slices); // the surface's view of every unit: role, edges, and why it waits

  // Asked to start from nothing: the branch that holds the earlier run's
  // committed slices goes, so the door below cuts a fresh one from the base
  // and every unit runs again. What is discarded is tagged first.
  if (deps.freshStart) {
    const fresh = await discardRunBranch({ repoRoot: deps.repoRoot, branch, worktree, exec, log: (l) => log(`${tep}: ${l}`) });
    if (fresh.discarded)
      defect({
        activity: "preflight",
        trigger: "fresh-start",
        type: "machine",
        impact: "the earlier run's branch was discarded at the person's request",
        detail: `${branch} at ${fresh.discarded.head} kept as ${fresh.discarded.tag}`,
      });
    else if (fresh.nothing) log(`${tep}: ${fresh.nothing}`);
  }
  const refreshed = await refreshRunTrees({ repoRoot: deps.repoRoot, branch, tep, worktree, deps, exec, log, defect });
  if (refreshed.refusal) return refuse(refreshed.refusal.trigger, refreshed.refusal.refusal, "gate");
  log(`${tep}: worktree on ${branch}`);
  const know = await whatWeKnow({
    deps, worktree, tep, space, cut, resumed: refreshed.resumed, halted: () => st.halted,
    exec, boundedExec, log, defect,
  });
  if (!know.ok) return refuse("setup", know.refusal, "gate");
  const ready = know.ready;
  deps = know.deps;
  const { provisioned, built } = ready;
  const runOneTest = know.runOne;
  const baseSha = (await exec("git", ["-C", worktree, "rev-parse", "HEAD"], worktree)).out.trim();
  // Per-slice bookkeeping for the oracle + the slice-commit countdown.
  const { sliceProbes, sliceVerifs, sliceFiles, checkOf, rehomed } = sliceBookkeeping(slices, runnerFor(runOneTest, ready.parts));
  if (deps.storeDir)
    await putBackDeliveredChecks(deps.storeDir, tep, worktree, [...sliceProbes.values()].flat(), log);
  for (const h of rehomed) log(`⚖ check ${h.ac} of ${h.parent} is the maintainer's (${h.maintainer}): its words name a test home that unit brings under — graded there`);
  const specBody = renderTepBody(space, cut);
  const undelivered: string[] = [];
  const done = new Set<string>();
  const failed = new Set<string>();
  const pending = new Set(dag.map((u) => u.id));

  const standing = await standingSlices(refreshed.committedSlices, dag, worktree, (l) => log(`${tep}: ${l}`), deps.finishedBefore ?? []);
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
    deps, branch, wtRoot, tep: wtName, worktree, testerWt, cutId: cut.id,
    sliceProbes, sliceVerifs, briefBySlice, acting, exec, boundedExec, suiteExec, log, defect,
    provisioned, built, dag, slices, criterionOf, rulings, decisions, runOneTest,
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

  // What the guard took back, kept for the last actor. A revert undoes the
  // change; it should not also erase what the unit worked out to make it.
  const restored: { path: string; patch: string }[] = [];
  const liveFootprints = new Map<string, { tree: string; paths: string[] }>();
  // The session each unit was worked in: a criterion red at the gate goes
  // back to the author that wrote the code, not to a stranger with a summary.
  const sessions = new Map<string, string>();
  const waits = runWaits({ dag, done, failed, waiting: () => waiting, live: () => liveFootprints, tree: worktree, commitUnitWork: (id, w) => commitUnitWork(id, w) });
  const wakers = (sl: string, self: string) => waits.wakers(sl, self);
  const unionFor = ownership(dag, (u) => ((u.role ?? "code") === "test" ? testerWt : worktree));
  // Probes ride into the code tree at slice commit — the run's own copies, never a coder's strays.
  const testerPaths = [...new Set([...sliceProbes.values()].flat())];

  let testInflight = 0;
  const { sliceCommitted, waiting, waitForCommit, commitUnitWork, failWith, finishUnit } = makeCommitBook({
    tep, branch, worktree, testerWt, dag, st, exec, log, undelivered, done, failed, standing, sliceProbes, sliceFiles,
    ...(deps.waitSleep ? { sleep: deps.waitSleep } : {}) });

  const closeUnit = unitCloser({
    worktree, testerWt, sliceProbes, sliceVerifs, criterionOf, st, exec, boundedExec, log, deps, rulings, undelivered, defect,
    heldElsewhere: () => [...liveFootprints.values()].filter((v) => v.tree === worktree).flatMap((v) => v.paths),
  });

  const runOne = async (next: (typeof dag)[number]): Promise<void> => {
    const maintain = isMaintainUnit(next); // scheduled as code, worked as a tester
    const role = (maintain ? "test" : (next.role ?? "code")) as "code" | "test";
    st.set(next.id, "running");
    // A resumed tester whose checks all stand on the branch has nothing to write.
    if (role === "test" && !maintain && refreshed.resumed && !(await missingProbes(worktree, next.footprint)).length) {
      log(`✓ ${next.id}: checks standing from the earlier run — nothing to write`, next.id);
      return finishUnit(next.id, next.slice, true);
    }
    log(`▸ ${next.id} (${role})`, next.id);
    const tree = worktree;
    if (role === "test" && !maintain) testInflight++;
    const baseline = new Set(await porcelainPaths(tree));
    const abort = new AbortController();
    st.aborts.set(next.id, abort);

    const oracle = role === "code" || maintain ? buildOracle(next.slice) : undefined;

    // The oracle speaks under the unit it acts for.
    if (oracle) acting.set(next.slice, { unit: next.id });

    const baseBrief =
      buildWorkerPrompt(next, tep, {
        tepBody: specBody,
        cwd: tree,
        // Every worker was told how NODE runs tests, in every repository.
        // A coder in a Python or Go project was instructed to write files
        // for a runner that is not there — the machine teaching its own
        // language to somebody else's codebase. What this repository does
        // is what it proved at the door, in its own words.
        testConvention:
          deps.testConvention ??
          `this repository runs one of its tests with: ${ready.runOne} ` +
            `(<file> is the test's path as the footprint states it). Write checks that ` +
            `this command runs, in the shape this repository already uses.`,
      }) +
      (deps.digest
        ? `\n\n──── THE REPOSITORY'S CONVENTIONS (an established reading — build under it instead of re-discovering it) ────\n${deps.digest}`
        : "");
    // A check fixes exact identifiers, and the code must agree on the
    // spelling to compile at all: a coder blind to the check is guessing a
    // word another actor already wrote down.
    const withNames = await briefWithNames(baseBrief, {
      role, tree, probes: sliceProbes.get(next.slice) ?? [],
      owned: next.footprint.filter((f) => !isProbePath(f)),
    });
    if (role !== "test") briefBySlice.set(next.slice, withNames);
    // Each role's brief carries what it owns, read FRESH each attempt — a contract that crossed slices mid-run reaches its owner at its next attempt.
    const oracleStanza = () =>
      role === "test"
        ? testerStanza(built) +
          (maintain ? coderStanza(!!oracle) : "") +
          testHomesStanza(testHomesOf(next.footprint), testHomeWorkOf(next))
        : clearanceStanza(next) +
          coderStanza(!!oracle) +
          decisionsStanza(decisions.filter((d) => d.unit.startsWith(`${next.slice}#`)).map((d) => d.text));
    // Dispatch-time audit: a decidable fact the brief lacks is missing at round zero.
    let disclosure = "";
    if (oracle?.preflight) {
      st.doing(next.id, "supervisor pre-flight — reading the brief against the checks");
      const pf = await oracle.preflight();
      if (pf) disclosure = `\n\n──── SUPERVISOR PRE-FLIGHT (information the checks require) ────\n${pf}`;
    }

    st.doing(next.id, "working");
    let ok = false;
    const attempts = oracle ? MAX_REWORK_ATTEMPTS : 1;
    // A tester inherits every test pinning the files it changes: it alone
    // may touch a test, and alone holds the criteria saying what the
    // behaviour becomes. What the person overruled is retired here.
    let brief = await briefWithInherited(baseBrief + oracleStanza() + disclosure, {
      role, tree, files: next.footprint.filter((f) => !isTestPath(f)),
      tests: (await repoTestFiles(tree)).filter((t: string) => !next.footprint.includes(t)),
    });
    for (let attempt = 1; attempt <= attempts && !st.halted; attempt++) {
      let outcome = await worker(
        {
          model: resolveWorkerModel(
            deps.workerModel ?? { workerModel: deps.model },
            role,
          ),
          worktree: tree,
          role,
          blind: role !== "test" && !!oracle,
          footprint: next.footprint,
          // A tester's turns scale with what it must write; a coder keeps the default.
          ...(role === "test" ? { maxTurns: testerTurns(next.footprint.length) } : {}),
          alsoAllowed: () => [...unionFor(tree, next.id)(), ...(tree === worktree ? testerPaths : [])],
          baseline,
          onRestored: (kept) => restored.push(...kept),
          // The door, on the path that needs it. Without it the guard has no
          // grant to consult: every write outside the footprint is restored
          // at once, and the second one kills the unit. It was wired only to
          // the check-authoring continuation below, so no ordinary coder or
          // tester could ever be cleared for a file nobody owns — three
          // units in one run hit the fence, none was granted anything, and
          // one died for a change it was entitled to make.
          ...(oracleArgs.clearance ? { clearFor: (p: string[]) => oracleArgs.clearance!(next.slice, next.id, p) } : {}),
          abort,
          // A worker's question goes to the machine first; the human sees
          // only an intent-level question, in the human's words.
          onPark: (q, answer) => void parkFor(next.slice, next.id)(q, answer),
          log: (line: string) => log(line, next.id),
          ...(deps.prepare && tree === worktree
            ? { buildTool: async () => formatBuild(await boundedExec(deps.prepare!, tree)) }
            : {}),
          ...(oracle
            ? {
                verifyTool: async () => {
                  st.doing(next.id, `waiting on verify — round ${oracle.invocations() + 1}`);
                  try {
                    return await verifyWithRepair({ oracle, slice: next.slice, repair: repairFor, diagnose: diagnoseFor, halted: () => st.halted, footprint: next.footprint, pendingPlanned: () => pendingPlanned().filter((p) => !next.footprint.includes(p)) });
                  } finally {
                    st.doing(next.id, "working");
                  }
                },
                challengeTool: challengeFor(next.slice),
              }
            : {}),
        },
        brief,
      );
      if (outcome.sessionId) sessions.set(next.id, outcome.sessionId);
      if (role === "test" && !outcome.containment)
        outcome = await finishAuthoring({
          outcome,
          tree,
          footprint: next.footprint,
          unit: next.id,
          maintain,
          brief,
          planned: dag.flatMap((u) => u.footprint).filter((f) => !isProbePath(f)),
          halted: () => st.halted,
          say: (text) => st.doing(next.id, text),
          log: (line) => log(line, next.id),
          defect: (detail) => defect({ slice: next.slice, unit: next.id, activity: "check authoring", trigger: "probe-audit", type: "test", impact: "refused before anyone was graded", detail }),
          runWorker: (text, turns) =>
            worker(
              {
                model: resolveWorkerModel(deps.workerModel ?? { workerModel: deps.model }, role),
                worktree: tree,
                role,
                footprint: next.footprint,
                maxTurns: turns,
                alsoAllowed: () => unionFor(tree, next.id)(),
                baseline,
                ...(oracleArgs.clearance ? { clearFor: (p: string[]) => oracleArgs.clearance!(next.slice, next.id, p) } : {}),
                abort,
                onPark: (q, answer) => void parkFor(next.slice, next.id)(q, answer),
                log: (line: string) => log(line, next.id),
              },
              text,
            ),
        });
      // A question left in UNDELIVERED is answered by the machine before it counts as a gap.
      if (outcome.undelivered?.length && !outcome.containment) {
        const kept = await answerEnd(next.slice, next.id, outcome.undelivered);
        outcome = { ...outcome, undelivered: kept, ok: kept.length === 0 };
      }
      if (outcome.containment) {
        // The stray writes are already reverted — the tree is clean; the rest of the run keeps its own fate.
        log(`⛔ ${next.id}: footprint violation — the changes were reverted; the unit failed`, next.id);
        st.fail(next.id, "wrote outside its footprint — the changes were reverted");
        defect({
          slice: next.slice,
          unit: next.id,
          activity: "unit execution",
          trigger: "containment",
          impact: "unit failed; writes reverted",
          detail: "worker wrote outside its footprint; offending paths reverted",
        });
        break;
      }
      if (!oracle) {
        ok = outcome.ok;
        // A tester whose declared probes are ALL written is complete: a kept doubt is
        // information — it rides the delivery — never the failure of a unit that produced everything it owed.
        if (!ok && role === "test" && !(await missingProbes(tree, next.footprint)).length) {
          ok = true;
          undelivered.push(...(outcome.undelivered ?? []).map((u) => `${next.id}: ${u}`));
          // A doubt the tester names is a fact the coder must read: a gap
          // in the contract is the one thing neither of them may guess at.
          for (const u of outcome.undelivered ?? []) decisions.push({ unit: next.id, text: `THE TESTER'S DOUBT — ${u}` });
          log(`✎ ${next.id}: all declared probes are written — its remaining doubt rides the delivery and the coder's brief`, next.id);
        }
        if (!ok) failWith(next.id, ...(outcome.undelivered ?? ["failed"]));
        if (ok && role === "test") decisions.push(...extractDecisions(outcome.finalText).map((text) => ({ unit: next.id, text })));
        break;
      }

      // MANDATORY-GREEN: the oracle's verdict decides, not the worker's self-report. A stopped run does not confirm.
      if (st.halted) {
        failWith(next.id, "stopped before its checks were confirmed");
        break;
      }
      st.doing(next.id, "confirming green — the oracle grades the final state");
      let confirm = await confirmWaitingForTree({
        oracle,
        slice: next.slice,
        repair: repairFor,
        halted: () => st.halted,
        footprint: next.footprint,
        pendingPlanned: () => pendingPlanned().filter((p) => !next.footprint.includes(p)),
        othersPending: () => wakers(next.slice, next.id).length > 0,
        waitForCommit: () => waitForCommit(next.id),
        say: (why) => {
          st.doing(next.id, why);
          log(`⏳ ${next.id}: ${why} — still able to land: ${wakers(next.slice, next.id).slice(0, 4).join(", ") || "nobody"}`, next.id);
        },
      });
      st.doing(next.id, undefined);
      // A red the machine calls not-yours must not fail the unit: a check reading a pruned test home is graded at the maintainer and the gate, on the record.
      const settled =
        !confirm.green && !maintain &&
        settleTransfers({ result: confirm.result, prunedHomes: maintainedElsewhere(slices, next.slice), probeSource: probeSourceFor(next.slice), slice: next.slice, unit: next.id, criterionOf, onRuling: (r) => rulings.push(r), log: (l) => log(l, next.id) });
      if (settled) confirm = { ...confirm, green: true };
      if (confirm.green) {
        ok = true;
        if (outcome.undelivered?.length)
          undelivered.push(...outcome.undelivered.map((u) => `${next.id}: ${u}`));
        break;
      }
      let r = confirm.result;
      // A stall means DIAGNOSE, not "keep trying": the judge runs each red
      // check and looks. A re-authored check earns the unit its next round.
      if (r.kind === "stalled") {
        const last = oracle.last()?.result;
        const reds = last?.kind === "results" ? last.results.filter((x) => !x.pass) : [];
        let mended = false;
        for (const f of reds) {
          const d = await diagnoseFor(next.slice, f.ac, f.evidence);
          if (d?.reauthored) mended = true;
          if (d) disclosure += `\n\n${d.note}`;
        }
        if (mended && attempt < attempts) r = (await oracle.confirmGreen()).result;
      }
      // Everything cheaper is spent: the closer takes it, with full sight
      // and full authority (THE-LADDER §4). Only if IT cannot does the unit fail.
      // A check that does not compile against the code, after the check
      // repair has had its turn, is settled by the actor that can see both
      // sides — never by a blind coder guessing at the check's shape.
      const checkBroken = r.kind === "build-failed" && r.testFault;
      if (r.kind === "stalled" || r.kind === "exhausted" || checkBroken || attempt >= attempts) {
        const closed = await closeUnit(next, oracle);
        if (closed) {
          ok = true;
          break;
        }
      }
      if (r.kind === "stalled" || r.kind === "exhausted" || checkBroken) {
        failWith(
          next.id,
          checkBroken
            ? `a check does not compile against the code, and neither the check repair nor the closer could settle it`
            : `verify oracle ${r.kind} — the checks are not green, and the closer could not finish it`,
        );
        break;
      }
      if (attempt < attempts) {
        log(`↻ ${next.id}: checks not green — rework ${attempt + 1}/${attempts}`, next.id);
        brief =
          baseBrief +
          oracleStanza() +
          disclosure +
          `\n\nREWORK ${attempt + 1}/${attempts} — a previous attempt left the checks NOT GREEN. The oracle's last verdict:\n${formatVerifyReply(r)}`;
      } else {
        failWith(
          next.id,
          `checks not green after ${attempts} attempts and the closer — ${formatVerifyReply(r).split("\n")[0]}`,
        );
        defect({
          slice: next.slice,
          unit: next.id,
          activity: "unit execution",
          trigger: "gate-verifier",
          type: "code",
          stage: "author",
          impact: "unit undelivered",
          detail: formatVerifyReply(r).slice(0, 1000),
        });
      }
    }
    st.aborts.delete(next.id);
    liveFootprints.delete(next.id);
    if (role === "test" && !maintain) testInflight--;
    // The attempt loop also ends when the run is halted — its own bound, or
    // a person stopping it — and a unit stopped mid-flight has no verdict at
    // all. Left unsaid it was written down as a bare "failed", which reads
    // as work that was judged and did not pass: a promise counted unkept
    // for a clock nobody could see, next to blocked units that at least say
    // the run stopped.
    if (!ok && st.halted && !st.units.get(next.id)?.note)
      failWith(next.id, "the run stopped before this unit finished — its work was never judged");
    await finishUnit(next.id, next.slice, ok);
  };
  await pumpUnits({
    st, dag, pending, done, failed, liveFootprints,
    // Sized to the processors this container is actually granted, not the
    // host's — oversubscribing them throttles the run and the editor alike.
    concurrency: Math.max(1, deps.concurrency ?? unitsAtOnce()),
    worktree, testerWt, runOne, finishUnit, failWith,
    onTestUnitCrash: () => { testInflight = Math.max(0, testInflight - 1); },
    log, defect,
  });


  if (machineAttention)
    log(
      `${tep}: ${machineAttention} attention event(s) about the machine in this run — the number this design is judged by, and its target is zero`,
    );
  return await closeGate({
    tep, branch, baseSha, worktree, slices, space, cut, deps,
    runOne: know.runOne, suite: know.suite,
    ...(ready.parts ? { parts: ready.parts } : {}),
    sliceProbes, sliceCommitted, checkOf, undelivered, rulings, decisions,
    exec, boundedExec, suiteExec, state: st, log, defect,
    sessionOf: (unit: string) => sessions.get(unit),
    worker,
    machineAttention: () => machineAttention,
    restored,
    ...(oracleArgs.clearance ? { clearFor: (p: string[]) => oracleArgs.clearance!("gate", "gate#repair", p) } : {}),
    runId,
    producedAt,
  });
  } finally {
    watch.stop();
    await unlock();
  }
}
