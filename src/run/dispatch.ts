/**
 * The run between the gates, driven by the imported engine.
 *
 * Structural separation of concerns (the v1 doctrine, re-hosted):
 * - Test units author probes in a DETACHED TESTER SNAPSHOT of the branch's
 *   committed HEAD — the coder's uncommitted work is absent by construction,
 *   so blinding is structural, not a promise in a prompt.
 * - Finished probes persist in the ORACLE STORE; snapshots are disposable,
 *   the store survives them (committed-wins on restore).
 * - Each slice's coder gets a black-box VERIFY ORACLE: an isolated runner
 *   overlays the coder's delta + the tester-owned probe sources and runs the
 *   per-criterion checks. The coder can invoke it in-loop (a real tool) and
 *   its green — not the worker's claim — is the unit's completion condition
 *   (MANDATORY-GREEN). Non-green routes a bounded rework with the oracle's
 *   evidence; stalled/exhausted verdicts fail honestly.
 * - Ready units run CONCURRENTLY (the frontier pump); containment tolerates
 *   the union of live footprints in the same tree and still reverts strays.
 * - A slice whose units are all done is committed on the branch (probes
 *   copied in first), so later tester snapshots legitimately see it.
 * Every failure lands as an artifact — UNDELIVERED, containment, red
 * proofs — never as silence.
 */
import * as path from "node:path";
import { Cut, Delivery, ProofAnchor, Ruling, Space } from "../core/schema";
import type { SliceForDag } from "../engine/core/dag";
import { buildUnitDag } from "../engine/core/dag";
import { frontier } from "./frontier";
import { buildWorkerPrompt } from "../engine/core/preflight";
import { DEFAULT_AC_TIMEOUT_MS, runBounded } from "../engine/core/closingGate";
import { validateDag } from "../engine/methodology/parallelSlices";
import { ownership, waitReasons } from "./fence";
import { MAX_REWORK_ATTEMPTS } from "../engine/core/redispatch";
import { formatVerifyReply } from "../engine/verifyOracle";
import { persistProbes, restoreProbes } from "../engine/oracleStore";
import { appendDefect } from "../engine/defectLog";
import { resolveWorkerModel, WorkerModelConfig } from "../engine/workerModel";
import { copyRel, defaultExec, ensureSnapshot, makeChallenge, makeParkAnswerer, provisionRunTrees, scrubbedEnv, sliceOracleFactory } from "./oracle";
import { setupRunTree } from "./setup";
import { claimRunLock, coderTestPaths } from "./plan";
import { renderTepBody } from "./briefs";
import { runReadRound } from "../derive/round";
import { Forge } from "../dispatch/forge";
import { RunState } from "./state";
import { coderStanza, testerStanza } from "./brief";
import { sliceBookkeeping } from "./plan";
import { runUnitWorker, porcelainPaths, WorkerOutcome } from "./worker";
import { criterionLookup, rehomeProbes } from "./rehome";
import { closeGate } from "./gate";
import { decisionsStanza, extractDecisions, restoreTestHomes, testHomesOf, testHomesStanza } from "./testHomes";

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
  /** The repository reading (conventions and the why) — every worker gets
   *  it in its brief. Workers are the only actors that MAKE changes, and
   *  they were the only step that never saw what a change must respect. */
  digest?: string;
  /** How this repository's probes are written and run. A convention is a
   *  fact about the target repository, not about this extension — the
   *  default fits the node harness the oracle ships with. */
  testConvention?: string;
  /** What a fresh checkout needs installed — run once; its produce is linked into every runner. */
  provision?: string;
  /** Re-read provision/prepare from a setup failure's evidence (the door tries the correction once). */
  resetup?: (evidence: string) => Promise<{ provision: string; prepare: string }>;
  /** The door proved this setup on the untouched tree — remember it as the answer. */
  proveSetup?: (s: { provision: string; prepare: string }) => void;
  /** Build/typecheck command run in the verify runner and the gate
   *  worktree before checks — the engine's own prepare seam. */
  prepare?: string;
  /** Concurrent workers on the ready frontier (default 4, the v1 default). */
  concurrency?: number;
  /** Injectable for tests: replaces the SDK worker. */
  worker?: (
    deps: Parameters<typeof runUnitWorker>[0],
    brief: string,
  ) => Promise<WorkerOutcome>;
  /** Injectable for tests: replaces the supervisor's SDK round. */
  supervisorRound?: typeof runReadRound;
  /** Injectable for tests: replaces the re-homing authoring round. */
  rehome?: typeof rehomeProbes;
  exec?: (cmd: string, args: string[], cwd: string) => Promise<{ code: number; out: string }>;
}

export interface DispatchOutcome {
  delivery?: Delivery;
  refusals: string[];
  undelivered: string[];
  url?: string;
  /** Where each criterion's standing check went on living — the space
   *  binds these onto its acceptance criteria. */
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
  const runName = deps.projectId ? `${deps.projectId}/${tep}` : tep;
  const branch = `tandem/${runName}`;
  const wtRoot = path.join(
    path.dirname(deps.repoRoot),
    `${path.basename(deps.repoRoot)}-worktrees`,
  );
  const wtName = runName.replace(/\//g, "__");
  const worktree = path.join(wtRoot, wtName);
  const testerWt = path.join(wtRoot, `${wtName}-tester`);
  const storeDir = path.join(wtRoot, "oracle-store", wtName);
  const log = (l: string, step?: string) => st.log(l, step);
  const env = scrubbedEnv();
  const boundedExec = (cmd: string, cwd: string) =>
    runBounded(cmd, cwd, { timeoutMs: DEFAULT_AC_TIMEOUT_MS, env });

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
    if (deps.storeDir) appendDefect(deps.storeDir, { spec: tep, ...entry });
  };

  const refuse = (trigger: string, refusal: string, type?: string): DispatchOutcome => {
    defect({ activity: "preflight", trigger, ...(type ? { type } : {}), impact: "run refused", detail: refusal.slice(0, 500) });
    return { refusals: [refusal], undelivered: [] };
  };

  const lock = await claimRunLock(wtRoot, wtName, runName, slices, { log });
  if (lock.refusal) return refuse("run-lock", lock.refusal);
  const unlock = lock.unlock;

  try {
  const dag = buildUnitDag(slices);
  const verdict = validateDag(dag) as { ok: boolean; error?: string };
  if (!verdict.ok)
    return refuse("plan-validation", `the engine refused the plan: ${JSON.stringify(verdict)}`);
  // The roles' invariant, checked before any worker starts: no coder holds a test.
  const misowned = coderTestPaths(slices);
  if (misowned.length)
    return refuse("plan-roles", `the plan hands a coder test-shaped paths — refused before dispatch: ${misowned.join(", ")}`);
  const whyWait = waitReasons(dag, slices);
  for (const u of dag) {
    const requires = u.requires.filter((r) => dag.some((x) => x.id === r));
    const why = requires.map((r) => whyWait(u, r));
    st.seed(u.id, u.slice, (u.role ?? "code") as "code" | "test", requires, u.note, why);
  }

  const trees = await provisionRunTrees(deps.repoRoot, branch, worktree, testerWt, exec);
  if (trees) return refuse(trees.trigger, trees.refusal, "gate");
  log(`${tep}: worktree on ${branch}`);
  const ready = await setupRunTree({ worktree, exec, boundedExec, log, provision: deps.provision, prepare: deps.prepare, resetup: deps.resetup, proven: deps.proveSetup });
  if (ready.refusal) return refuse("setup", ready.refusal, "gate");
  const { provisioned } = ready;
  if (ready.corrected) deps = { ...deps, ...ready.corrected };
  const baseSha = (await exec("git", ["-C", worktree, "rev-parse", "HEAD"], worktree)).out.trim();
  // Per-slice bookkeeping for the oracle + the slice-commit countdown.
  const { sliceProbes, sliceTestHomes, sliceVerifs, sliceFiles, checkOf } = sliceBookkeeping(slices);
  const allTestHomes = [...new Set([...sliceTestHomes.values()].flat())];
  /** The tester's tree after a reset: probes back from the store, and the
   *  test homes it edited restored OVER what the branch holds. */
  const restoreTester = async (): Promise<void> => {
    await restoreProbes(storeDir, testerWt);
    await restoreTestHomes(storeDir, testerWt, allTestHomes);
  };
  await restoreTester();
  log(`${tep}: tester snapshot at ${path.basename(testerWt)} (structural blinding)`);

  const specBody = renderTepBody(space, cut);
  const undelivered: string[] = [];
  const done = new Set<string>();
  const failed = new Set<string>();
  const pending = new Set(dag.map((u) => u.id));

  const sliceRemaining = new Map<string, number>();
  for (const u of dag)
    sliceRemaining.set(u.slice, (sliceRemaining.get(u.slice) ?? 0) + 1);

  const briefBySlice = new Map<string, string>();
  const acting = new Map<string, { unit: string }>();
  // The check behind an ordinal, from the space — the adapter carried the
  // ids; the probe never carries delivery bookkeeping.
  const criterionOf = criterionLookup(slices, space);
  const rulings: Ruling[] = [];
  const decisions: { unit: string; text: string }[] = [];
  const oracleArgs = {
    repoRoot: deps.repoRoot,
    branch,
    wtRoot,
    tep: wtName,
    worktree,
    testerWt,
    sliceProbes,
    sliceVerifs,
    briefBySlice,
    acting: (slice: string) => acting.get(slice),
    model: deps.model,
    workerModel: deps.workerModel,
    supervisorRound: deps.supervisorRound,
    exec,
    boundedExec,
    log,
    defect,
    ...(deps.prepare ? { prepare: deps.prepare } : {}),
    provisioned,
    criterionOf,
    onRuling: (r: { slice: string; criterionId: string; granted: boolean; reason: string }) =>
      rulings.push({ criterionId: r.criterionId, unit: r.slice, granted: r.granted, reason: r.reason }),
    persistProbe: (rel: string) => persistProbes(storeDir, testerWt, [rel]),
  };
  const buildOracle = sliceOracleFactory(oracleArgs);
  const challengeFor = makeChallenge(oracleArgs);
  const parkFor = makeParkAnswerer(oracleArgs);

  const liveFootprints = new Map<string, { tree: string; paths: string[] }>();
  const unionFor = ownership(dag, (u) => ((u.role ?? "code") === "test" ? testerWt : worktree));
  // The tester's files ride into the code tree at slice commit — the run's
  // own copies, never a coder's strays; a coder cannot write them anyway.
  const testerPaths = [...new Set([...sliceProbes.values(), ...sliceTestHomes.values()].flat())];

  let testInflight = 0;
  let testerReset: Promise<void> = Promise.resolve();
  const sliceCommitted = new Set<string>();

  /** Probes in, then commit the slice's paths: later tester snapshots see
   *  committed truth. */
  const commitSlice = async (slice: string): Promise<void> => {
    if (sliceCommitted.has(slice)) return;
    sliceCommitted.add(slice);
    const probes = [...(sliceProbes.get(slice) ?? []), ...(sliceTestHomes.get(slice) ?? [])];
    for (const rel of probes)
      await copyRel(testerWt, worktree, rel).catch(() => {});
    const paths = [...new Set([...(sliceFiles.get(slice) ?? []), ...probes])];
    if (paths.length) await exec("git", ["add", "--", ...paths], worktree);
    const c = await exec("git", ["commit", "-m", `tandem: ${tep} ${slice}`], worktree);
    if (c.code === 0) log(`✓ ${slice}: committed on ${branch}`);
    else log(`⚠ ${slice}: nothing to commit — ${c.out.trim().split("\n").pop() ?? ""}`);
  };

  const failWith = (id: string, ...why: string[]): void => {
    st.fail(id, why.join("; "));
    undelivered.push(...why.map((u) => `${id}: ${u}`));
  };
  const finishUnit = async (id: string, slice: string, ok: boolean): Promise<void> => {
    if (ok) {
      done.add(id);
      st.set(id, "done");
    } else {
      failed.add(id);
      st.set(id, "failed");
    }
    const left = (sliceRemaining.get(slice) ?? 1) - 1;
    sliceRemaining.set(slice, left);
    if (left === 0 && [...dag].filter((u) => u.slice === slice).every((u) => done.has(u.id)))
      await commitSlice(slice);
  };

  const runOne = async (next: (typeof dag)[number]): Promise<void> => {
    const role = (next.role ?? "code") as "code" | "test";
    st.set(next.id, "running");
    log(`▸ ${next.id} (${role})`, next.id);
    const tree = role === "test" ? testerWt : worktree;
    if (role === "test") {
      // Re-snapshot only when no other test author is mid-flight — a reset
      // under a live author would wipe its work. The count rises BEFORE the
      // reset is awaited and the reset itself is one shared promise, so two
      // authors launched in the same tick cannot each reset under the other.
      const first = testInflight === 0;
      testInflight++;
      if (first)
        testerReset = (async () => {
          await ensureSnapshot(deps.repoRoot, branch, testerWt, exec);
          await restoreTester();
        })();
      await testerReset;
    }
    const baseline = new Set(await porcelainPaths(tree));
    const abort = new AbortController();
    st.aborts.set(next.id, abort);

    const oracle = role === "code" ? buildOracle(next.slice) : undefined;
    if (role === "code") await restoreTester();

    // The oracle speaks under the unit it acts for.
    if (oracle) acting.set(next.slice, { unit: next.id });

    const baseBrief =
      buildWorkerPrompt(next, tep, {
        specBody,
        tepBody: specBody,
        cwd: tree,
        testConvention:
          deps.testConvention ??
          "node:test ESM modules run directly with `node --test <file>` — name probe files exactly as the footprint states (.test.mjs, no build step)",
      }) +
      (deps.digest
        ? `\n\n──── THE REPOSITORY'S CONVENTIONS (an established reading — build under it instead of re-discovering it) ────\n${deps.digest}`
        : "");
    // Only a coder's brief is "the coder's brief" — a tester's must not shadow it.
    if (role !== "test") briefBySlice.set(next.slice, baseBrief);
    // The tester's existing test homes and the coder's contract from the
    // tester's decisions — each role's brief carries what it owns.
    const oracleStanza =
      role === "test"
        ? testerStanza() +
          testHomesStanza(
            testHomesOf(next.footprint),
            (next.units ?? []).flatMap(
              (u) => (u as { testHomeWork?: { path: string; sentence: string; criteria: string[] }[] }).testHomeWork ?? [],
            ),
          )
        : coderStanza(!!oracle) +
          decisionsStanza(decisions.filter((d) => d.unit.startsWith(`${next.slice}#`)).map((d) => d.text));
    // Dispatch-time information audit: the brief's completeness against the
    // checks is static — a missing decidable fact is missing at round zero.
    let disclosure = "";
    if (oracle?.preflight) {
      const pf = await oracle.preflight();
      if (pf) disclosure = `\n\n──── SUPERVISOR PRE-FLIGHT (information the checks require) ────\n${pf}`;
    }

    let ok = false;
    const attempts = oracle ? MAX_REWORK_ATTEMPTS : 1;
    let brief = baseBrief + oracleStanza + disclosure;
    for (let attempt = 1; attempt <= attempts && !st.halted; attempt++) {
      const outcome = await worker(
        {
          model: resolveWorkerModel(
            deps.workerModel ?? { workerModel: deps.model },
            role,
          ),
          worktree: tree,
          role,
          // Blind only when the oracle can answer instead.
          blind: role !== "test" && !!oracle,
          footprint: next.footprint,
          alsoAllowed: () => [...unionFor(tree, next.id)(), ...(tree === worktree ? testerPaths : [])],
          baseline,
          abort,
          // A worker's question goes to the machine first; the human sees
          // only an intent-level question, in the human's words.
          onPark: (q, answer) =>
            void parkFor(next.slice, next.id)(q, answer, (intent) => st.park(next.id, intent, answer)),
          log: (line: string) => log(line, next.id),
          ...(oracle
            ? {
                verifyTool: async () => {
                  const r = await oracle.verify();
                  return formatVerifyReply(r);
                },
                challengeTool: challengeFor(next.slice),
              }
            : {}),
        },
        brief,
      );
      if (outcome.containment) {
        log(`⛔ ${next.id}: footprint violation — run halted`, next.id);
        st.fail(next.id, "wrote outside its footprint — the changes were reverted and the run halted");
        defect({
          slice: next.slice,
          unit: next.id,
          activity: "unit execution",
          trigger: "containment",
          impact: "run halted",
          detail: "worker wrote outside its footprint; offending paths reverted",
        });
        st.halt();
        break;
      }
      if (!oracle) {
        ok = outcome.ok;
        if (!ok) failWith(next.id, ...(outcome.undelivered ?? ["failed"]));
        else if (role === "test")
          decisions.push(...extractDecisions(outcome.finalText).map((text) => ({ unit: next.id, text })));
        break;
      }

      // MANDATORY-GREEN: the oracle's verdict on the current state decides,
      // not the worker's self-report.
      const confirm = await oracle.confirmGreen();
      if (confirm.green) {
        ok = true;
        if (outcome.undelivered?.length)
          undelivered.push(...outcome.undelivered.map((u) => `${next.id}: ${u}`));
        break;
      }
      const r = confirm.result;
      if (r.kind === "stalled" || r.kind === "exhausted") {
        failWith(next.id, `verify oracle ${r.kind} — the checks are not green`);
        break;
      }
      if (attempt < attempts) {
        log(`↻ ${next.id}: checks not green — rework ${attempt + 1}/${attempts}`, next.id);
        brief =
          baseBrief +
          oracleStanza +
          disclosure +
          `\n\nREWORK ${attempt + 1}/${attempts} — a previous attempt left the checks NOT GREEN. The oracle's last verdict:\n${formatVerifyReply(r)}`;
      } else {
        failWith(
          next.id,
          `checks not green after ${attempts} attempts — ${formatVerifyReply(r).split("\n")[0]}`,
        );
        defect({
          slice: next.slice,
          unit: next.id,
          activity: "unit execution",
          trigger: "gate-verifier",
          type: "code",
          impact: "unit undelivered",
          detail: formatVerifyReply(r).slice(0, 1000),
        });
      }
    }
    st.aborts.delete(next.id);
    liveFootprints.delete(next.id);
    if (role === "test") {
      testInflight--;
      if (ok) {
        try {
          await persistProbes(storeDir, testerWt, next.footprint);
        } catch (err) {
          // A durable done-flag with no persisted probe is the lie the store
          // exists to remove — the unit fails instead.
          ok = false;
          failWith(
            next.id,
            `declared probe missing at persist (${err instanceof Error ? err.message : String(err)})`,
          );
        }
      }
    }
    await finishUnit(next.id, next.slice, ok);
  };

  // The pump: launch what is ready up to the cap, wake on any completion.
  const concurrency = Math.max(1, deps.concurrency ?? 2);
  const inflight = new Map<string, Promise<void>>();
  while (!st.halted) {
    // The engine's own frontier: it refuses a unit whose footprint is being
    // written by a running unit — two coders in one file is a silent lost update.
    const ready = frontier(dag, {
      pending,
      done,
      failed,
      running: [...liveFootprints.values()].flatMap((v) => v.paths),
    });
    for (const u of ready) {
      if (inflight.size >= concurrency) break;
      pending.delete(u.id);
      // On the record synchronously with the launch — registering it later,
      // inside the worker, leaves a window the next frontier cannot see.
      liveFootprints.set(u.id, {
        tree: (u.role ?? "code") === "test" ? testerWt : worktree,
        paths: u.footprint,
      });
      // A crash inside one unit is that unit's failure, on the record —
      // never the end of the run for every other unit.
      const p = runOne(u)
        .catch(async (err) => {
          const why = err instanceof Error ? (err.stack ?? err.message) : String(err);
          log(`⛔ ${u.id}: crashed — ${why.split("\n")[0]}`, u.id);
          defect({ slice: u.slice, unit: u.id, activity: "unit execution", trigger: "crash", impact: "unit failed", detail: why.slice(0, 1200) });
          st.aborts.delete(u.id);
          liveFootprints.delete(u.id);
          if (u.role === "test") testInflight = Math.max(0, testInflight - 1);
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
  // Never ran is not failed. A unit the run never reached says so, and
  // the one unit that really failed stays findable among them.
  for (const id of pending)
    st.block(id, "never ran — the run stopped, or something it waits on failed");

  return await closeGate({
    tep, branch, baseSha, worktree, testerWt, slices, space, cut, deps,
    sliceProbes, sliceTestHomes, sliceCommitted, checkOf, undelivered, rulings, decisions,
    exec, boundedExec, log, defect,
  });
  } finally {
    await unlock();
  }
}
