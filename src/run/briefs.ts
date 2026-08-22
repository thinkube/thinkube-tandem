/**
 * The TEP rendered for worker briefs: the asks' verbatim words, the
 * decisions in force, and the grounded changes with their acceptance
 * criteria — the north star every brief carries. Also the run of ONE unit:
 * built and briefed here so the dispatcher's own pump stays readable.
 */
import { Cut, Space } from "../core/schema";
import type { SchedUnit } from "../engine/core/dag";
import type { VerifyOracle } from "../engine/verifyOracle";
import { formatVerifyReply } from "../engine/verifyOracle";
import { buildWorkerPrompt } from "../engine/core/preflight";
import { MAX_REWORK_ATTEMPTS } from "../engine/core/redispatch";
import { resolveWorkerModel, WorkerModelConfig } from "../engine/workerModel";
import { confirmWaitingForTree, verifyWithRepair, type Repair } from "./repair";
import { finishAuthoring } from "./authoring";
import { formatBuild } from "./execs";
import type { Diagnoser } from "./diagnose";
import {
  decisionsStanza,
  extractDecisions,
  isProbePath,
  missingProbes,
  testerTurns,
  testHomesOf,
  testHomesStanza,
} from "./testHomes";
import { clearanceStanza, coderStanza, testerStanza } from "./brief";
import { porcelainPaths, runUnitWorker, type WorkerOutcome } from "./worker";
import { isMaintainUnit, maintainedElsewhere } from "./plan";
import type { RunState } from "./state";

/** The TEP rendered for briefs: the asks' words plus the grounded slices. */
export function renderTepBody(space: Space, cut: Cut): string {
  const byId = new Map(space.nodes.map((n) => [n.id, n]));
  const members = cut.changeIds.map((id) => byId.get(id)).filter((c) => !!c);
  const askIds = new Set(members.flatMap((c) => c!.serves));
  const asks = space.asks.filter((a) => askIds.has(a.id));
  const lines: string[] = [];
  lines.push(`# ${cut.tepId ?? cut.id}`);
  lines.push(`## The asks (verbatim)`);
  for (const a of asks) lines.push(`- ${a.text.trim()}`);
  const decided = space.questions.filter((q) => q.decided);
  if (decided.length) {
    lines.push(`## Decisions in force (the human settled these — build under them)`);
    for (const q of decided) lines.push(`- ${q.decided!.text}`);
  }
  if (cut.docsExemption?.reason)
    lines.push(`Documentation is not needed for this cut — ${cut.docsExemption.reason}`);
  lines.push(`## The changes`);
  for (const c of members) {
    lines.push(`- ${c!.sentence}`);
    for (const t of c!.grounding?.touchpoints ?? [])
      lines.push(`  - lands at ${t.path}${t.symbol ? ` › ${t.symbol}` : ""}${t.planned ? " (new file)" : ""}`);
    lines.push(`  ## Acceptance Criteria`);
    for (const ac of c!.acceptance) lines.push(`  - [ ] ${ac.text}`);
  }
  return lines.join("\n");
}

/** Mutable across a run's whole pump, not just one unit: how many testers
 *  are mid-flight right now, and the shared reset promise they wait on —
 *  a crash outside the runner (the pump's own catch) still has to account
 *  for a tester that never reached its own decrement. */
interface TesterInflight {
  count: number;
  reset: Promise<void>;
}

/** Everything one unit's run needs that the dispatcher already built: the
 *  trees, the oracle machinery, the brief text and the bookkeeping every
 *  unit reports into. Grouped here so the pump that launches units stays
 *  readable, and so this factory takes exactly what it uses — nothing
 *  reached back out of a closure it does not own. */
interface UnitRunnerArgs {
  deps: {
    repoRoot: string;
    model: string;
    workerModel?: WorkerModelConfig;
    digest?: string;
    prepare?: string;
    testConvention?: string;
    worker?: (deps: Parameters<typeof runUnitWorker>[0], brief: string) => Promise<WorkerOutcome>;
  };
  tep: string;
  tepBody: string;
  branch: string;
  worktree: string;
  testerWt: string;
  storeDir: string;
  cutId: string;
  st: RunState;
  log: (line: string, step?: string) => void;
  defect: (entry: {
    slice?: string;
    unit?: string;
    activity: string;
    trigger: string;
    type?: string;
    impact: string;
    detail: string;
  }) => void;
  resumed: boolean;
  dag: readonly SchedUnit[];
  slices: readonly { handle: string; maintains?: string; files?: string[] }[];
  built: readonly string[];
  boundedExec: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
  ensureSnapshot: (repoRoot: string, ref: string, dir: string, exec: unknown) => Promise<boolean>;
  exec: (cmd: string, args: string[], cwd: string) => Promise<{ code: number; out: string }>;
  restoreTester: () => Promise<void>;
  buildOracle: (slice: string) => VerifyOracle | undefined;
  acting: Map<string, { unit: string }>;
  briefBySlice: Map<string, string>;
  decisions: { unit: string; text: string }[];
  undelivered: string[];
  rulings: { criterionId: string; unit: string; granted: boolean; reason: string }[];
  criterionOf: (slice: string, ac: number) => { id: string; text: string } | undefined;
  liveFootprints: Map<string, { tree: string; paths: string[] }>;
  unionFor: (tree: string, unitId: string) => () => string[];
  testerPaths: readonly string[];
  wakers: (slice: string, self: string) => string[];
  waitForCommit: (id: string) => Promise<void>;
  challengeFor: (slice: string) => (ac: number, argument: string) => Promise<string>;
  parkFor: (
    slice: string,
    unit: string,
  ) => (question: string, answer: (a: string) => void, escalate: (intent: string) => void) => Promise<void>;
  repairFor: Repair;
  diagnoseFor: Diagnoser;
  answerEnd: (slice: string, unit: string, undelivered: readonly string[]) => Promise<string[]>;
  closeUnit: (unit: { id: string; slice: string; footprint: string[] }, oracle: VerifyOracle) => Promise<boolean>;
  probeSourceFor: (slice: string) => unknown;
  settleTransfers: (args: {
    result: unknown;
    prunedHomes: string[];
    probeSource: unknown;
    slice: string;
    unit: string;
    criterionOf: (slice: string, ac: number) => { id: string; text: string } | undefined;
    onRuling: (r: { criterionId: string; unit: string; granted: boolean; reason: string }) => void;
    log: (l: string) => void;
  }) => boolean;
  pendingPlanned: () => string[];
  failWith: (id: string, ...why: string[]) => void;
  finishUnit: (id: string, slice: string, ok: boolean) => Promise<void>;
  persistProbes: (storeDir: string, testerWt: string, footprint: string[], cutId: string) => Promise<void>;
  testerState: TesterInflight;
}

/** The run of ONE unit: builds its brief, drives the worker through its
 *  rework attempts, and reports what it decided. Kept apart from the
 *  dispatcher's pump so the frontier loop that launches units reads as a
 *  loop rather than as this whole procedure inlined into it. */
function makeUnitRunner(a: UnitRunnerArgs): (next: SchedUnit) => Promise<void> {
  const worker = a.deps.worker ?? runUnitWorker;

  return async function runOne(next: SchedUnit): Promise<void> {
    const maintain = isMaintainUnit(next);
    const role = (maintain ? "test" : (next.role ?? "code")) as "code" | "test";
    a.st.set(next.id, "running");
    if (role === "test" && !maintain && a.resumed && !(await missingProbes(a.testerWt, next.footprint)).length) {
      a.log(`✓ ${next.id}: probes standing from the earlier run — nothing to write`, next.id);
      return a.finishUnit(next.id, next.slice, true);
    }
    a.log(`▸ ${next.id} (${role})`, next.id);
    const tree = role === "test" && !maintain ? a.testerWt : a.worktree;
    if (role === "test" && !maintain) {
      const first = a.testerState.count === 0;
      a.testerState.count++;
      if (first)
        a.testerState.reset = (async () => {
          await a.ensureSnapshot(a.deps.repoRoot, a.branch, a.testerWt, a.exec);
          await a.restoreTester();
        })();
      await a.testerState.reset;
    }
    const baseline = new Set(await porcelainPaths(tree));
    const abort = new AbortController();
    a.st.aborts.set(next.id, abort);

    const oracle = role === "code" || maintain ? a.buildOracle(next.slice) : undefined;
    if (role === "code" || maintain) await a.restoreTester();

    if (oracle) a.acting.set(next.slice, { unit: next.id });

    const baseBrief =
      buildWorkerPrompt(next, a.tep, {
        tepBody: a.tepBody,
        cwd: tree,
        testConvention:
          a.deps.testConvention ??
          "node:test ESM modules run directly with `node --test <file>` — name probe files exactly as the footprint states (.test.mjs, no build step)",
      }) +
      (a.deps.digest
        ? `\n\n──── THE REPOSITORY'S CONVENTIONS (an established reading — build under it instead of re-discovering it) ────\n${a.deps.digest}`
        : "");
    if (role !== "test") a.briefBySlice.set(next.slice, baseBrief);
    const oracleStanza = () =>
      role === "test"
        ? testerStanza(a.built) +
          (maintain ? coderStanza(!!oracle) : "") +
          testHomesStanza(
            testHomesOf(next.footprint),
            (next.units ?? []).flatMap(
              (u) => (u as { testHomeWork?: { path: string; sentence: string; criteria: string[] }[] }).testHomeWork ?? [],
            ),
          )
        : clearanceStanza(next) +
          coderStanza(!!oracle) +
          decisionsStanza(a.decisions.filter((d) => d.unit.startsWith(`${next.slice}#`)).map((d) => d.text));
    let disclosure = "";
    if (oracle?.preflight) {
      a.st.doing(next.id, "supervisor pre-flight — reading the brief against the checks");
      const pf = await oracle.preflight();
      if (pf) disclosure = `\n\n──── SUPERVISOR PRE-FLIGHT (information the checks require) ────\n${pf}`;
    }

    a.st.doing(next.id, "working");
    let ok = false;
    const attempts = oracle ? MAX_REWORK_ATTEMPTS : 1;
    let brief = baseBrief + oracleStanza() + disclosure;
    for (let attempt = 1; attempt <= attempts && !a.st.halted; attempt++) {
      let outcome = await worker(
        {
          model: resolveWorkerModel(a.deps.workerModel ?? { workerModel: a.deps.model }, role),
          worktree: tree,
          role,
          blind: role !== "test" && !!oracle,
          footprint: next.footprint,
          ...(role === "test" ? { maxTurns: testerTurns(next.footprint.length) } : {}),
          alsoAllowed: () => [...a.unionFor(tree, next.id)(), ...(tree === a.worktree ? a.testerPaths : [])],
          baseline,
          abort,
          onPark: (q, answer) =>
            void a.parkFor(next.slice, next.id)(q, answer, (intent) => a.st.park(next.id, intent, answer)),
          log: (line: string) => a.log(line, next.id),
          ...(a.deps.prepare && tree === a.worktree
            ? { buildTool: async () => formatBuild(await a.boundedExec(a.deps.prepare!, tree)) }
            : {}),
          ...(oracle
            ? {
                verifyTool: async () => {
                  a.st.doing(next.id, `waiting on verify — round ${oracle.invocations() + 1}`);
                  try {
                    return await verifyWithRepair({
                      oracle,
                      slice: next.slice,
                      repair: a.repairFor,
                      diagnose: a.diagnoseFor,
                      halted: () => a.st.halted,
                      footprint: next.footprint,
                      pendingPlanned: () => a.pendingPlanned().filter((p) => !next.footprint.includes(p)),
                    });
                  } finally {
                    a.st.doing(next.id, "working");
                  }
                },
                challengeTool: a.challengeFor(next.slice),
              }
            : {}),
        },
        brief,
      );
      if (role === "test" && !outcome.containment)
        outcome = await finishAuthoring({
          outcome,
          tree,
          footprint: next.footprint,
          unit: next.id,
          maintain,
          brief,
          planned: a.dag.flatMap((u) => u.footprint).filter((f) => !isProbePath(f)),
          halted: () => a.st.halted,
          say: (text) => a.st.doing(next.id, text),
          log: (line) => a.log(line, next.id),
          defect: (detail) =>
            a.defect({
              slice: next.slice,
              unit: next.id,
              activity: "check authoring",
              trigger: "probe-audit",
              type: "test",
              impact: "refused before anyone was graded",
              detail,
            }),
          runWorker: (text, turns) =>
            worker(
              {
                model: resolveWorkerModel(a.deps.workerModel ?? { workerModel: a.deps.model }, role),
                worktree: tree,
                role,
                footprint: next.footprint,
                maxTurns: turns,
                alsoAllowed: () => a.unionFor(tree, next.id)(),
                baseline,
                abort,
                onPark: (q, answer) =>
                  void a.parkFor(next.slice, next.id)(q, answer, (intent) => a.st.park(next.id, intent, answer)),
                log: (line: string) => a.log(line, next.id),
              },
              text,
            ),
        });
      if (outcome.undelivered?.length && !outcome.containment) {
        const kept = await a.answerEnd(next.slice, next.id, outcome.undelivered);
        outcome = { ...outcome, undelivered: kept, ok: kept.length === 0 };
      }
      if (outcome.containment) {
        a.log(`⛔ ${next.id}: footprint violation — the changes were reverted; the unit failed`, next.id);
        a.st.fail(next.id, "wrote outside its footprint — the changes were reverted");
        a.defect({
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
        if (!ok && role === "test" && !(await missingProbes(tree, next.footprint)).length) {
          ok = true;
          a.undelivered.push(...(outcome.undelivered ?? []).map((u) => `${next.id}: ${u}`));
          a.log(`✎ ${next.id}: all declared probes are written — its remaining doubt rides the delivery`, next.id);
        }
        if (!ok) a.failWith(next.id, ...(outcome.undelivered ?? ["failed"]));
        if (ok && role === "test")
          a.decisions.push(...extractDecisions(outcome.finalText).map((text) => ({ unit: next.id, text })));
        break;
      }

      if (a.st.halted) {
        a.failWith(next.id, "stopped before its checks were confirmed");
        break;
      }
      a.st.doing(next.id, "confirming green — the oracle grades the final state");
      let confirm = await confirmWaitingForTree({
        oracle,
        slice: next.slice,
        repair: a.repairFor,
        halted: () => a.st.halted,
        footprint: next.footprint,
        pendingPlanned: () => a.pendingPlanned().filter((p) => !next.footprint.includes(p)),
        othersPending: () => a.wakers(next.slice, next.id).length > 0,
        waitForCommit: () => a.waitForCommit(next.id),
        say: (why) => {
          a.st.doing(next.id, why);
          a.log(
            `⏳ ${next.id}: ${why} — still able to land: ${a.wakers(next.slice, next.id).slice(0, 4).join(", ") || "nobody"}`,
            next.id,
          );
        },
      });
      a.st.doing(next.id, undefined);
      const settled =
        !confirm.green &&
        !maintain &&
        a.settleTransfers({
          result: confirm.result,
          prunedHomes: maintainedElsewhere(a.slices as never, next.slice),
          probeSource: a.probeSourceFor(next.slice),
          slice: next.slice,
          unit: next.id,
          criterionOf: a.criterionOf,
          onRuling: (r) => a.rulings.push(r),
          log: (l) => a.log(l, next.id),
        });
      if (settled) confirm = { ...confirm, green: true };
      if (confirm.green) {
        ok = true;
        if (outcome.undelivered?.length)
          a.undelivered.push(...outcome.undelivered.map((u) => `${next.id}: ${u}`));
        break;
      }
      let r = confirm.result;
      if (r.kind === "stalled") {
        const last = oracle.last()?.result;
        const reds = last?.kind === "results" ? last.results.filter((x) => !x.pass) : [];
        let mended = false;
        for (const f of reds) {
          const d = await a.diagnoseFor(next.slice, f.ac, f.evidence);
          if (d?.reauthored) mended = true;
          if (d) disclosure += `\n\n${d.note}`;
        }
        if (mended && attempt < attempts) r = (await oracle.confirmGreen()).result;
      }
      if (r.kind === "stalled" || r.kind === "exhausted" || attempt >= attempts) {
        const closed = await a.closeUnit(next, oracle);
        if (closed) {
          ok = true;
          break;
        }
      }
      if (r.kind === "stalled" || r.kind === "exhausted") {
        a.failWith(next.id, `verify oracle ${r.kind} — the checks are not green, and the closer could not finish it`);
        break;
      }
      if (attempt < attempts) {
        a.log(`↻ ${next.id}: checks not green — rework ${attempt + 1}/${attempts}`, next.id);
        brief =
          baseBrief +
          oracleStanza() +
          disclosure +
          `\n\nREWORK ${attempt + 1}/${attempts} — a previous attempt left the checks NOT GREEN. The oracle's last verdict:\n${formatVerifyReply(r)}`;
      } else {
        a.failWith(
          next.id,
          `checks not green after ${attempts} attempts and the closer — ${formatVerifyReply(r).split("\n")[0]}`,
        );
        a.defect({
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
    a.st.aborts.delete(next.id);
    a.liveFootprints.delete(next.id);
    if (role === "test" && !maintain) {
      a.testerState.count--;
      if (ok) {
        try {
          await a.persistProbes(a.storeDir, a.testerWt, next.footprint, a.cutId);
        } catch (err) {
          ok = false;
          a.failWith(next.id, `declared probe missing at persist (${err instanceof Error ? err.message : String(err)})`);
        }
      }
    }
    await a.finishUnit(next.id, next.slice, ok);
  };
}
