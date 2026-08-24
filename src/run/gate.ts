/**
 * The closing gate: everything after the last unit — probes ride the
 * branch, the delivered tree is built, every check runs, assessments are
 * graded by a fresh reviewer, the honesty scan reads the diff, the
 * repository's own suite decides, the checks are recorded on the delivery
 * and discarded from the tree, and the delivery is opened.
 *
 * A red suite is not delivered. The work may satisfy its own checks and
 * still leave the repository's standing checks red; that delivery is
 * withheld — recorded, with the reason in intent terms — never handed over
 * red for the human to finish.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Cut, Delivery, Proof, Ruling, Space } from "../core/schema";
import type { SliceForDag } from "../engine/core/dag";
import { runAcVerifications } from "../engine/core/closingGate";
import { gradeAssessments, logRedChecks } from "./assess";
import type { Exec } from "./oracle";
import { prepareAtGate } from "./setup";
import type { BoundedExec } from "./setup";
import {
  closingVerifications,
  confessedDeferrals,
  docsObligations,
  keptChecks,
  writeDeliveryRecord,
} from "./plan";
import { porcelainPaths } from "./worker";
import { criterionMapOf } from "./criteria";
import { observationsOf } from "./observations";
import { provedByExecution } from "./wiring";
import type { WiringVerdict } from "./wiring";
import { isTestPath } from "./testHomes";
import type { DispatchDeps, DispatchOutcome } from "./dispatch";
import type { RunState } from "./state";
import { filesNamedIn, suiteFootprint, suiteVerdictOf } from "./suite";
import { repairSuiteAtGate } from "./gateRepair";
import { close, convergenceScore } from "./closer";
import { repairUnkept } from "./unkept";
import { shellLine } from "./execs";
import type { RunWorkerDeps, WorkerOutcome } from "./worker";

export interface GateContext {
  tep: string;
  branch: string;
  baseSha: string;
  worktree: string;
  slices: SliceForDag[];
  space: Space;
  cut: Cut;
  deps: DispatchDeps;
  /** The run's identity and the moment it produced its work — stamped onto
   *  every delivery this gate constructs, opened or withheld. */
  runId: string;
  producedAt: string;
  sliceProbes: Map<string, string[]>;
  sliceCommitted: Set<string>;
  checkOf: Map<string, string>;
  undelivered: string[];
  rulings: Ruling[];
  decisions: { unit: string; text: string }[];
  exec: Exec;
  boundedExec: BoundedExec;
  /** Runs the suite command, bounded for a whole suite. */
  suiteExec: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
  state: RunState;
  /** The session a unit was worked in, when the run still holds it. */
  sessionOf: (unit: string) => string | undefined;
  /** The run's worker, so a repair is the next message in that session. */
  worker: (deps: RunWorkerDeps, brief: string) => Promise<WorkerOutcome>;
  /** How many times this run made a person interpret the machine. */
  machineAttention: () => number;
  log: (line: string, step?: string) => void;
  defect: (entry: {
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
  }) => void;
}

/** The reason a red suite withholds the delivery — intent-level, no internals. */
const RED_SUITE_REFUSAL =
  "the repository's standing checks are red after the work — the delivery is withheld " +
  "rather than handed over red; the branch keeps the work and the run record keeps the " +
  "suite's verdict (if the repository was already red before, it must be green first)";

export async function closeGate(g: GateContext): Promise<DispatchOutcome> {
  const { tep, branch, worktree, slices, space, cut, deps, exec, boundedExec, log, defect } = g;
  const undelivered = g.undelivered;
  log(`${tep}: closing gate`);
  const { verifs, probeOfAc } = closingVerifications(slices);
  // The checks need `prepare`; the PRODUCT needs `build`. Both run, and
  // the product's is the one that decides whether this tree can ship.
  await prepareAtGate(deps.prepare, worktree, boundedExec, log);
  const built = deps.build && deps.build !== deps.prepare ? await prepareAtGate(deps.build, worktree, boundedExec, log) : { ok: true, words: "" };
  const acResults = await runAcVerifications(verifs, worktree, (run, cwd) => boundedExec(run, cwd));
  // Assessments: a FRESH reviewer over the DELIVERED tree, fail-soft red.
  const graded = await gradeAssessments({
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
  // Wiring proven by execution: a green check is asked whether running it
  // actually executed the code its promise lands in. A stub satisfies an
  // assertion; it cannot appear on a path nothing reaches.
  const subjectsOf = (criterionId?: string): string[] => {
    if (!criterionId) return [];
    const promise = space.nodes.find((n) => n.acceptance.some((a) => a.id === criterionId));
    return (promise?.grounding?.touchpoints ?? []).map((t) => t.path).filter((p) => !isTestPath(p));
  };
  const wiring = new Map<number, WiringVerdict>();
  for (const r of acResults) {
    if (!r.pass) continue;
    const v = verifs.find((x) => x.ac === r.ac);
    if (!v?.run || v.env === "assessment") continue;
    const probe = probeOfAc.get(r.ac);
    const verdict = await provedByExecution({
      run: v.run,
      subjects: subjectsOf(probe ? criterionByProbe.get(probe) : undefined),
      worktree,
      exec: boundedExec,
    });
    wiring.set(r.ac, verdict);
    if (verdict.executed === "no")
      defect({
        activity: "closing gate",
        trigger: "wiring-trace",
        type: "code",
        stage: "author",
        impact: "a green check proved nothing",
        detail: verdict.detail.slice(0, 400),
      });
  }
  const unproven = [...wiring.values()].filter((w) => w.executed === "unknown").length;
  if (unproven) log(`${tep}: ${unproven} check(s) ran under a runtime that does not report what it executed — their wiring is unproven`);
  const assessed = graded.proofs;
  // What only the running product can show is the person's to certify —
  // ON the delivery, because the delivery is the thing they certify with.
  // Holding the delivery back for it would demand the observation before
  // the thing to observe exists. Two sources, deliberately: the design's
  // own rule over the signed promises, and the reviewer's OBSERVE verdict
  // for wordings the rule misses.
  const observations = [...new Set([...observationsOf(space, cut), ...graded.observations])];
  if (observations.length)
    log(`${tep}: ${observations.length} observation(s) ride the delivery for the person to certify`);
  const proofs: Proof[] = assessed.concat(
    acResults.map((r) => {
      const probe = probeOfAc.get(r.ac);
      const criterionId = probe ? criterionByProbe.get(probe) : undefined;
      const wired = wiring.get(r.ac);
      const kept = r.pass && wired?.executed !== "no";
      const ref = wired && wired.executed !== "yes" ? wired.detail : r.evidence;
      return {
        kind: "probe" as const,
        label: (probe && g.checkOf.get(probe)) || `check ${r.ac}`,
        verdict: kept ? ("green" as const) : ("red" as const),
        ...(ref ? { ref: ref.slice(0, 300) } : {}),
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
  // One judgement of the tree, used by every rung at this gate: the
  // repository's suite AND the product build. A tree that does not build
  // as shipped is red whatever the suite says — the suite may compile a
  // different configuration than the one that ships the product — and the
  // build's own words join the suite's failures, so the finisher and the
  // closer repair it like any red, and a branch that still does not build
  // is withheld, never handed over. Three runs once reported deliveries of
  // a branch the product build rejected, because only the first judgement
  // here looked at it and every re-judgement after a repair did not.
  const judgeTree = async (cmd: string, cwd: string): Promise<{ code: number | null; output: string }> => {
    const suite = await g.suiteExec(cmd, cwd);
    if (!deps.build || deps.build === deps.prepare) return suite;
    const b = await boundedExec(deps.build, cwd);
    if (b.code === 0) return suite;
    return {
      code: suite.code === 0 ? b.code : suite.code,
      output: `${suite.output}\nnot ok 0 - the product build (${deps.build}) does not build as shipped\n${b.output.slice(-3000)}`,
    };
  };
  log(`${tep}: running the repository's own suite on the delivered tree (minutes)`);
  const ran = await judgeTree(shellLine(deps.suiteCommand), worktree);
  let verdict = suiteVerdictOf(ran.code, ran.output, worktree);
  if (!built.ok && verdict.green)
    verdict = {
      ...verdict,
      green: false,
      summary: `the delivered tree does not build as shipped (${deps.build}); ${verdict.summary}`,
      failures: [{ name: "the product build", detail: built.words, file: filesNamedIn(built.words, worktree)[0] }],
    };
  if (!verdict.green) {
    // The tests that bit at this gate are run early, at every slice, next time.
    deps.rememberSuiteReds?.(verdict.failures.map((f) => f.file).filter((f): f is string => !!f));
    // A red suite has owners in the run: the finisher brings the delivered
    // tree under the repository's checks, bounded; only then is it withheld.
    const repaired = await repairSuiteAtGate({
      tep,
      worktree,
      baseSha: g.baseSha,
      deps,
      state: g.state,
      exec,
      suiteExec: judgeTree,
      verdict,
      log,
      defect,
    });
    verdict = repaired.verdict;
    // The finisher is spent and the tree still does not stand: the closer
    // takes the whole delivery, with full sight and authority (§4).
    if (!verdict.green && !g.state.halted) {
      const closed = await close({
        subject: `${tep} (the delivery)`,
        worktree,
        footprint: [
          ...new Set([
            ...(await exec("git", ["-C", worktree, "diff", "--name-only", `${g.baseSha}..HEAD`], worktree)).out
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean),
            ...(await porcelainPaths(worktree)),
            ...verdict.failures.map((f) => f.file).filter((f): f is string => !!f),
          ]),
        ],
        probeSources: [],
        history: verdict.failures.map((f) => `${f.name}: ${f.detail.split("\n")[0]}`).slice(0, 12),
        criteria: [...g.checkOf.values()].slice(0, 40).map((text, i) => ({ id: `gate-${i}`, text })),
        ...(deps.digest ? { digest: deps.digest } : {}),
        ...(deps.prepare ? { prepare: deps.prepare } : {}),
        model: deps.model,
        ...(deps.workerModel ? { workerModel: deps.workerModel } : {}),
        measure: async () => {
          const r = await judgeTree(shellLine(deps.suiteCommand), worktree);
          const v = suiteVerdictOf(r.code, r.output, worktree);
          // Build first: an unbuildable tree is one failure, not many, so a
          // repair that breaks imports for a round is not read as a collapse.
          const built = deps.prepare ? await boundedExec(deps.prepare, worktree) : { code: 0, output: "" };
          return {
            green: v.green && built.code === 0,
            score: convergenceScore({ buildRed: built.code !== 0, reds: v.failures.length }),
            evidence: (
              (built.code === 0 ? "" : `THE TREE DOES NOT BUILD — fix this first:\n${built.output.slice(-3000)}\n\n`) +
              `${v.summary}\n${v.failures.map((f) => `${f.name}${f.file ? ` (${f.file})` : ""}\n${f.detail}`).join("\n\n")}`
            ).slice(0, 8000),
            // The last actor's clearance grows with what fails it —
            // including what the BUILD names. A tree that will not compile
            // fails the delivery, and the compiler names the file to fix;
            // reading only the test failures left the closer without it,
            // so the guard restored the very edit the evidence asked for.
            alsoOwn: [
              ...new Set([...suiteFootprint(v.failures, worktree), ...filesNamedIn(built.output, worktree)]),
            ],
          };
        },
        exec,
        boundedExec: g.suiteExec,
        halted: () => g.state.halted,
        abortable: (ab) => g.state.aborts.set("gate#closer", ab),
        log: (l) => log(l, "gate#closer"),
        say: (t) => g.state.doing("gate#closer", t),
        onRuling: (r) => g.rulings.push({ criterionId: r.criterionId, unit: r.unit, granted: r.granted, reason: r.reason }),
        defect: (e) => defect({ unit: "gate#closer", ...e }),
        ...(deps.worker ? { worker: deps.worker } : {}),
      });
      if (closed.green) {
        const again = await judgeTree(shellLine(deps.suiteCommand), worktree);
        verdict = suiteVerdictOf(again.code, again.output, worktree);
        if (verdict.green) {
          await exec("git", ["add", "-A", "."], worktree);
          await exec("git", ["commit", "-m", `tandem: ${tep} — closed`], worktree);
        }
      }
    }
  }
  proofs.push({
    kind: "suite",
    label: "repo suite",
    verdict: verdict.green ? "green" : "red",
    ...(verdict.green ? {} : { ref: verdict.failures.map((f) => f.name).join("; ").slice(0, 400) }),
  });

  if (!verdict.green) {
    const names = verdict.failures.map((f) => `${f.name}${f.file ? ` (${f.file})` : ""}`);
    log(`⛔ ${tep}: the repository's suite is red after the work and the finisher could not bring it under — the delivery is withheld: ${names.join("; ").slice(0, 600)}`);
    defect({
      activity: "closing gate",
      trigger: "suite",
      type: "code",
      impact: "delivery withheld",
      // The names, and each test's own words — never the tail of a log.
      detail: verdict.failures.map((f) => `${f.name}${f.file ? ` (${f.file})` : ""}\n${f.detail}`).join("\n\n").slice(0, 4000),
    });
    if (deps.storeDir)
      await writeDeliveryRecord(deps.storeDir, { tep, branch, baseSha: g.baseSha, runId: g.runId, producedAt: g.producedAt, proofs, undelivered, verifs, acResults });
    undelivered.push(...docsObligations(slices, worktree));
    await exec("git", ["add", "-A", "."], worktree);
    await exec("git", ["commit", "-m", `tandem: ${tep} (suite red — withheld)`], worktree);
    // Withheld is still on the record: what was checked and why it stopped
    // is readable; nothing was opened and it cannot be accepted.
    const withheld: Delivery = {
      id: `delivery-${tep}`,
      cutId: cut.id,
      branch,
      runId: g.runId,
      producedAt: g.producedAt,
      proofs,
      withheld: `${RED_SUITE_REFUSAL} — still red: ${names.join("; ").slice(0, 500)}`,
      ...(undelivered.length ? { undelivered } : {}),
      ...(g.rulings.length ? { rulings: g.rulings } : {}),
      ...(g.decisions.length ? { decisions: g.decisions } : {}),
    };
    return { refusals: [RED_SUITE_REFUSAL], undelivered, delivery: withheld };
  }

  undelivered.push(...docsObligations(slices, worktree));

  // Delivery only at zero. The branch may hold any state along the way —
  // there is deliberately no rule that it may never get worse, because that
  // would forbid demolition — but nothing is handed over while a promise is
  // unkept. A delivery with a red proof asks the person to finish the work
  // and to decide which reds are acceptable, which is the machine's job.
  let unkept = proofs.filter((p) => p.verdict !== "green");
  unkept = await repairUnkept({
    tep, worktree, slices, space, cut, deps, proofs, observations, verifs, probeOfAc, criterionByProbe, subjectsOf,
    checkOf: g.checkOf, sliceProbes: g.sliceProbes, sessionOf: g.sessionOf, worker: g.worker, baseSha: g.baseSha,
    halted: () => g.state.halted, doing: (t) => g.state.doing("gate#closer", t), rulings: g.rulings,
    abortable: (ab) => g.state.aborts.set("gate#closer", ab),
    exec, boundedExec, suiteExec: g.suiteExec, log, defect,
  });
  // A check proves a promise once; it does not join the repository's suite
  // because it exists. Its source and its verdict are kept on the delivery
  // record — where a person can read what was driven — and when a delivery
  // OPENS the file leaves the tree, so a delivery of N promises does not
  // hand the repository N permanent tests to maintain forever. A WITHHELD
  // run discards nothing: its checks are its evidence and the next run's
  // material, and one withheld commit that deleted them cost the run after
  // it fifty-three reds for files that no longer existed.
  const kept = await keptChecks([...g.sliceProbes.values()].flat(), worktree, criterionByProbe);

  const recordPath = deps.storeDir ? path.join(deps.storeDir, "deliveries", `${tep}.json`) : undefined;
  if (deps.storeDir)
    await writeDeliveryRecord(deps.storeDir, {
      tep,
      branch,
      baseSha: g.baseSha,
      runId: g.runId,
      producedAt: g.producedAt,
      proofs,
      undelivered,
      verifs,
      acResults,
      // Only an opened delivery captures its checks; a withheld run keeps
      // its files in the tree and must not replace what a delivery kept.
      ...(unkept.length ? {} : { checks: kept }),
      ...(observations.length ? { observations } : {}),
      machineAttention: g.machineAttention(),
    });
  undelivered.push(...docsObligations(slices, worktree));

  if (unkept.length) {
    await exec("git", ["add", "-A", "."], worktree);
    await exec("git", ["commit", "-m", `tandem: ${tep} (withheld — ${unkept.length} unkept)`], worktree);
    await exec("git", ["push", "-u", "origin", branch, "--force"], worktree);
    const named = unkept.map((p) => `- ${p.label}${p.ref ? `: ${p.ref.split("\n")[0].slice(0, 160)}` : ""}`);
    log(`${tep}: withheld — ${unkept.length} promise(s) are not kept`);
    return {
      refusals: [],
      undelivered,
      delivery: {
        id: `delivery-${tep}`,
        cutId: cut.id,
        branch,
        runId: g.runId,
        producedAt: g.producedAt,
        proofs,
        ...(observations.length ? { observations } : {}),
        withheld:
          `${unkept.length} of the cut's promises are not kept, so nothing is handed over. The branch holds the work:\n` +
          named.join("\n"),
        ...(undelivered.length ? { undelivered } : {}),
        ...(g.rulings.length ? { rulings: g.rulings } : {}),
        ...(g.decisions.length ? { decisions: g.decisions } : {}),
      },
    };
  }

  for (const c of kept) await fs.rm(path.join(worktree, c.path), { force: true }).catch(() => {});
  log(`${tep}: ${kept.length} check(s) recorded on the delivery and discarded from the tree`);
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
          `Delivered by the tandem run for ${tep}.\n` +
          `run: ${g.runId}\n` +
          `produced at: ${g.producedAt}\n\n` +
          (observations.length
            ? `FOR YOU TO CERTIFY — the machine cannot observe the running product:\n${observations.map((o) => `- ${o}`).join("\n")}\n\n`
            : "") +
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
    runId: g.runId,
    producedAt: g.producedAt,
    proofs,
    ...(observations.length ? { observations } : {}),
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
