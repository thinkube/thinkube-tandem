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
import { Proof, unkeptProof } from "../core/schema";
import { runAcVerifications } from "../engine/core/closingGate";
import { gradeAssessments, logRedChecks, proposeRewording, stagedProofs } from "./assess";
import { prepareAtGate } from "./setup";
import {
  closingVerifications,
  confessedDeferrals,
  docsObligations,
  keptChecks,
  writeDeliveryRecord,
} from "./plan";
import { porcelainPaths } from "./worker";
import { criterionMapOf } from "./criteria";
import { traceWiring } from "./wiringTrace";
import { handOver } from "./handOver";
import { landDelivery } from "./land";
import { criterionVerdicts, unprovenDoorPromises } from "../gates/render";
import { aRunnerAnswered } from "./suiteCommand";
import { imitationsDelivered } from "./probeAudit";
import { observationsOf } from "./observations";
import { provedByExecution } from "./wiring";
import { judgingRules } from "./selfHosted";
import { isTestPath } from "./testHomes";
import type { DispatchOutcome } from "./dispatch";
import type { GateContext } from "./state";
import { filesNamedIn, suiteFootprint, suiteVerdictOf, type SuiteFailure } from "./suite";
import { repairSuiteAtGate } from "./gateRepair";
import { close, convergenceScore, readProbes } from "./closer";
import { repairUnkept } from "./unkept";
import { unsettledReviews, withheldDelivery } from "./withheld";
import { treeShape } from "../gates/moduleSizes";
import { runnerFor } from "./proved";
import { thinkubeDeclaration } from "../core/thinkubeYaml";
import { askTheTool } from "./settles";

export type { GateContext } from "./state";

/** The reason a red suite withholds the delivery — intent-level, no internals. */
const RED_SUITE_REFUSAL =
  "the repository's standing checks are red after the work — the delivery is withheld " +
  "rather than handed over red; the branch keeps the work and the run record keeps the " +
  "suite's verdict (if the repository was already red before, it must be green first)";

/** The step the closing gate files its OWN lines under — the same name its
 *  card carries, so a click on that card opens the gate's own account. Its
 *  sub-steps ("gate#closer", "gate#finisher") are spelled from it, so the
 *  parent and its children can never drift apart. */
const GATE_STEP = "gate";

/**
 * How the closing gate files a line of its own.
 *
 * The gate's own lines — its opening line and the reason it withholds or
 * keeps a delivery — file under {@link GATE_STEP}, the same name its card
 * carries: the surface asks for "gate" and expects to read what the gate
 * itself said, not an empty panel next to "gate#closer" and "gate#finisher"
 * where the actual account lives.
 */
function sayAt(log: (line: string, step?: string) => void): (line: string) => void {
  return (line: string): void => log(line, GATE_STEP);
}

export async function closeGate(g: GateContext): Promise<DispatchOutcome> {
  const { tep, branch, worktree, slices, space, cut, deps, exec, boundedExec, log, defect } = g;
  const say = sayAt(log);
  // `dispatchTep` always supplies both from its own single clock read; a
  // caller that predates the field falls back here rather than failing —
  // this gate must still stamp SOME identity on what it hands back.
  const runId = g.runId ?? `${tep}@${Date.now().toString(36)}`;
  const producedAt = g.producedAt ?? new Date().toISOString();
  const undelivered = g.undelivered;
  // A stopped run is not graded, and the grading is where the gate spends
  // its time: every check run, every assessment reviewed, the finisher and
  // the closer after them. That verdict was thrown away at the end — the
  // report says "nothing was judged from a stopped run" whatever the
  // grading found — so a run halted before the gate spent another
  // fifty-five minutes producing an answer nobody could use. It is asked
  // first now, where the answer costs nothing.
  if (g.state.halted) {
    say(`${tep}: the run was stopped before the closing gate — nothing is judged; the branch holds the work.`);
    return {
      refusals: [],
      undelivered,
      delivery: withheldDelivery({
        tep, cut, branch, runId, producedAt, proofs: [], undelivered,
        rulings: g.rulings, decisions: g.decisions,
        reason:
          `the run was stopped before its promises were graded — nothing was judged from a stopped run. ` +
          `The branch holds the work; run it again to finish the grading.`,
      }),
    };
  }
  say(`${tep}: closing gate`);
  const { verifs, probeOfAc } = closingVerifications(slices, runnerFor(g.runOne, g.parts));
  // The checks need `prepare`; the PRODUCT needs `build`. Both run, and
  // the product's is the one that decides whether this tree can ship.
  await prepareAtGate(deps.prepare, worktree, boundedExec, log);
  // Prepares the tree so the checks can run. NOT a judgement: what the
  // build says at the END is the only reading that decides anything.
  if (deps.build && deps.build !== deps.prepare) await prepareAtGate(deps.build, worktree, boundedExec, log);
  const acResults = await runAcVerifications(verifs, worktree, (run, cwd) => boundedExec(run, cwd));
  // Assessments: a FRESH reviewer over the DELIVERED tree, fail-soft red.
  const graded = await gradeAssessments({
    space,
    cut,
    testerWt: worktree,
    model: deps.workerModel?.workerModel ?? "sonnet",
    ...(deps.workerModel ? { workerModel: deps.workerModel } : {}),
    // Stop reaches the reviews like every worker: none more is asked, and
    // the ones in flight are aborted by name.
    halted: () => g.state.halted,
    abortable: (ab, label) => g.state.aborts.set(`${GATE_STEP}#${label}`, ab),
    log,
    onRed: (label, ref) =>
      defect({
        activity: "closing gate",
        trigger: "assessment",
        type: "code",
        impact: "assessment check red",
        detail: `${label} — ${ref}`.slice(0, 400),
      }),
    // A reviewer that never reached a verdict is the machine failing to
    // judge. It is counted as an attention event about the machine, which
    // is the number this design is judged by, and never against the work.
    ungraded: (label, criterion) =>
      defect({
        activity: "closing gate",
        trigger: "gate-infra",
        type: "gate",
        impact: "the machine could not grade a review — it rides the delivery for the person",
        detail: `${label} — ${criterion}`.slice(0, 400),
      }),
  });
  if (g.state.halted) {
    say(`${tep}: the run was stopped during the closing gate — what was graded stands, nothing else is judged; the branch holds the work.`);
    return {
      refusals: [],
      undelivered,
      delivery: withheldDelivery({
        tep, cut, branch, runId, producedAt, proofs: [], undelivered,
        rulings: g.rulings, decisions: g.decisions,
        reason:
          `the run was stopped while its promises were being graded — nothing is delivered from a stopped run. ` +
          `The branch holds the work; run it again to finish the grading.`,
      }),
    };
  }
  // The rules that decide whether a promise is kept come from the TREE
  // UNDER TEST when that tree is the one that defines them. A cut that
  // corrects a judging rule was otherwise judged by the rule it corrects:
  // seventeen promises came back unkept for a defect both of the branch's
  // commits had already fixed, and no such cut could ever be delivered.
  const rules = await judgingRules({ worktree, running: { criterionMapOf, provedByExecution }, log });
  if (!rules.ok) {
    say(`⛔ ${tep}: ${rules.reason}`);
    defect({ activity: "closing gate", trigger: "self-hosted-judge", type: "infrastructure",
      impact: "the run cannot judge this cut", detail: rules.reason.slice(0, 500) });
    return { refusals: [rules.reason], undelivered: [] };
  }
  const { criterionMapOf: mapCriteria, provedByExecution: proveWiring } = rules;
  const { criterionByProbe, unreached } = await traceWiring({
    tep, space, slices, acResults, verifs, probeOfAc, checkOf: g.checkOf, worktree,
    exec: boundedExec, log, defect, mapCriteria, proveWiring,
  });
  // Wiring proven by execution, the same rule the gate judged the tree by:
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
  // Criteria settled elsewhere ride as pending, each naming its source.
  const staged = stagedProofs(space, cut);
  if (staged.length)
    log(`${tep}: ${staged.length} promise(s) are settled after the merge — ` +
      [...new Set(staged.map((p) => p.settledBy))].join("; "));
  // What the machine could not settle, put to the person at Accept. A doubt
  // about a check's REACH belongs here, never in a verdict: the vetoes are an
  // unkept promise and a product that does not build, and a passing check is
  // kept. Coverage sees none kept by a file's text, a bundle, or a mute runtime.
  const findings: string[] = [...unreached];
  const proofs: Proof[] = staged.concat(assessed).concat(
    acResults.map((r) => {
      const probe = probeOfAc.get(r.ac);
      const criterionId = probe ? criterionByProbe.get(probe) : undefined;
      const label = (probe && g.checkOf.get(probe)) || `check ${r.ac}`;
      // A check that could not run judged nothing. Calling that red hands a
      // repair actor work that was never assessed, and withholds a delivery
      // for the machine's own failure.
      const verdict = r.unrunnable ? ("unjudged" as const) : r.pass ? ("green" as const) : ("red" as const);
      return {
        kind: "probe" as const,
        label,
        verdict,
        ...(r.evidence ? { ref: r.evidence.slice(0, 1200) } : {}),
        ...(criterionId ? { criterionId } : {}),
      };
    }),
  );
  logRedChecks(acResults, defect, g.state.halted);

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
  // judgeTree runs the product build EVERY time it judges, and folds a
  // failure into the output as a named "not ok", so the verdict below is
  // always about the tree as it stands now. An earlier reading of the
  // build must never override it: the gate spends an hour between its
  // first measurement and this judgement — checks, assessments, reviews,
  // the finisher — and a tree repaired in that hour was still reported as
  // not building, withholding work that built perfectly well.
  // No whole-suite command runs here: there is no standing suite to hold
  // the delivery to, so the veto does not exist for this repository. The
  // proof row says so — "no standing suite runs here" is a fact the person
  // reads at Accept, not a green invented for a suite nobody ran.
  // A repository whose work is declarative has no suite and needs none: a
  // check asserting that a playbook declares what it declares restates the
  // file in a second language. Where it says how to ask its own tool
  // instead, that answer stands in for the suite — including the question
  // no test asks, whether running the work again still changes anything.
  const told = thinkubeDeclaration(worktree);
  const verify = told && "declared" in told ? told.declared.verify : undefined;
  if (!g.suite && verify) {
    const settled = await askTheTool({
      repoRoot: worktree,
      verify,
      invoke: async (command, cwd) => {
        const r = await g.suiteExec(command, cwd);
        return { code: r.code, out: r.output };
      },
      log,
    });
    log(`${tep}: the tool answered — ${settled.verdict}`);
    if (settled.verdict === "red")
      return { refusals: [`the repository's own tool says the work does not hold:\n${settled.detail}`], undelivered: [] };
  } else if (!g.suite) {
    log(`${tep}: no whole-suite command runs here — the standing-suite veto does not apply`);
  }
  const ran = g.suite ? await judgeTree(g.suite, worktree) : undefined;
  // A runner that ANSWERED — green, or red in its own words — is judging
  // the work. A command that did not run at all is judging nothing, and
  // reporting it as a red suite tells a person their work broke when what
  // broke is this run's idea of how to test their repository. That is the
  // sentence a whole delivery was withheld on.
  if (ran && !aRunnerAnswered(ran.code, ran.output)) {
    const why =
      `the command this repository proved for its whole suite (${g.suite}) did not run at the gate — ` +
      `no test runner answered, so nothing here is a verdict about the work. ` +
      `The branch keeps everything. What the shell said:\n${ran.output.trim().split("\n").slice(-8).join("\n").slice(0, 800)}`;
    say(`⛔ ${tep}: ${why}`);
    defect({ activity: "closing gate", trigger: "suite-could-not-run", type: "infrastructure",
      impact: "the delivered tree could not be judged", detail: why.slice(0, 500) });
    return { refusals: [why], undelivered: [] };
  }
  let verdict = ran
    ? suiteVerdictOf(ran.code, ran.output, worktree)
    : { green: true, failures: [] as SuiteFailure[], summary: "no standing suite runs here" };
  if (ran && !verdict.green) {
    // The tests that bit at this gate are run early, at every slice, next time.
    deps.rememberSuiteReds?.(verdict.failures.map((f) => f.file).filter((f): f is string => !!f));
    // A red suite has owners in the run: the finisher brings the delivered
    // tree under the repository's checks, bounded; only then is it withheld.
    const repaired = await repairSuiteAtGate({
      suite: g.suite!,
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
        probeSources: readProbes(worktree, [...new Set([...g.sliceProbes.values()].flat())]),
        history: verdict.failures.map((f) => `${f.name}: ${f.detail.split("\n")[0]}`).slice(0, 12),
        criteria: [...g.checkOf.values()].slice(0, 40).map((text, i) => ({ id: `gate-${i}`, text })),
        ...(deps.digest ? { digest: deps.digest } : {}),
        ...(deps.prepare ? { prepare: deps.prepare } : {}),
        model: deps.model,
        ...(deps.workerModel ? { workerModel: deps.workerModel } : {}),
        measure: async () => {
          const r = await judgeTree(g.suite!, worktree);
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
        abortable: (ab) => g.state.aborts.set(`${GATE_STEP}#closer`, ab),
        log: (l) => log(l, `${GATE_STEP}#closer`),
        say: (t) => g.state.doing(`${GATE_STEP}#closer`, t),
        onRuling: (r) => g.rulings.push({ criterionId: r.criterionId, unit: r.unit, granted: r.granted, reason: r.reason }),
        defect: (e) => defect({ unit: `${GATE_STEP}#closer`, ...e }),
        ...(deps.worker ? { worker: deps.worker } : {}),
      });
      if (closed.green) {
        const again = await judgeTree(g.suite!, worktree);
        verdict = suiteVerdictOf(again.code, again.output, worktree);
        if (verdict.green) {
          await exec("git", ["add", "-A", "."], worktree);
          await exec("git", ["commit", "-m", `tandem: ${tep} — closed`], worktree);
        }
      }
    }
  }
  if (g.suite)
    proofs.push({
      kind: "suite",
      label: "repo suite",
      verdict: verdict.green ? "green" : "red",
      ...(verdict.green ? {} : { ref: verdict.failures.map((f) => f.name).join("; ").slice(0, 400) }),
    });

  // What the machine could not settle rides the delivery for the person to
  // weigh at Accept. A rule may only veto when its failure names an actor
  // who can act; here every actor is spent, so the person at Accept IS the
  // actor — and a suite opinion (a size rule, a reachability rule, a
  // hygiene view) was never a reason to hold four kept promises hostage.
  // A tree that does not BUILD stays a veto: handing over a product that
  // cannot ship harms whoever pulls it, whatever the person decides.
  // Production that imitates the platform, said for the person to weigh.
  // The simulator rule reads checks; this reads what the run DELIVERED,
  // because that is where the imitation moved when the checks were watched.
  for (const hit of await imitationsDelivered({
    worktree, baseSha: g.baseSha, exec,
    readFile: (rel) => fs.readFile(path.join(worktree, rel), "utf8"),
    isTestPath,
  })) {
    findings.push(`${hit.where} — ${hit.detail}`);
    defect({ activity: "closing gate", trigger: "platform-imitation", type: "code",
      impact: "production imitates the platform — carried as a finding",
      detail: `${hit.where} ${hit.detail}`.slice(0, 500) });
  }
  if (!verdict.green && !verdict.failures.some((f) => /product build/i.test(f.name))) {
    const carried = verdict.failures.map((f) => `${f.name}${f.file ? ` (${f.file})` : ""}`);
    log(`${tep}: the repository's suite is red after every actor — ${carried.length} finding(s) ride the delivery for the person: ${carried.join("; ").slice(0, 400)}`);
    defect({
      activity: "closing gate",
      trigger: "suite",
      type: "code",
      impact: "suite findings carried on the delivery — the person decides at Accept",
      detail: carried.join("\n").slice(0, 2000),
    });
    findings.push(...verdict.failures.map((f) => `${f.name}${f.file ? ` (${f.file})` : ""} — ${f.detail.split("\n")[0].slice(0, 200)}`));
    verdict = { ...verdict, green: true };
  }
  if (!verdict.green) {
    const names = verdict.failures.map((f) => `${f.name}${f.file ? ` (${f.file})` : ""}`);
    say(`⛔ ${tep}: the repository's suite is red after the work and the finisher could not bring it under — the delivery is withheld: ${names.join("; ").slice(0, 600)}`);
    defect({
      activity: "closing gate",
      trigger: "suite",
      type: "code",
      impact: "delivery withheld",
      // The names, and each test's own words — never the tail of a log.
      detail: verdict.failures.map((f) => `${f.name}${f.file ? ` (${f.file})` : ""}\n${f.detail}`).join("\n\n").slice(0, 4000),
    });
    if (deps.storeDir)
      await writeDeliveryRecord(deps.storeDir, { tep, branch, baseSha: g.baseSha, proofs, undelivered, verifs, acResults, runId, producedAt });
    undelivered.push(...docsObligations(slices, worktree));
    await exec("git", ["add", "-A", "."], worktree);
    await exec("git", ["commit", "-m", `tandem: ${tep} (suite red — withheld)`], worktree);
    // Withheld is still on the record: what was checked and why it stopped
    // is readable; nothing was opened and it cannot be accepted. It carries
    // the same run id and produced-at stamp as a delivered one — a
    // withheld run is still a run, and its report still names itself.
    const withheld = withheldDelivery({
      tep, cut, branch, runId, producedAt, proofs, undelivered, observations, findings,
      rulings: g.rulings, decisions: g.decisions,
      reason: `${RED_SUITE_REFUSAL} — still red: ${names.join("; ").slice(0, 500)}`,
    });
    return { refusals: [RED_SUITE_REFUSAL], undelivered, delivery: withheld };
  }

  undelivered.push(...docsObligations(slices, worktree));

  // Delivery only at zero. The branch may hold any state along the way —
  // there is deliberately no rule that it may never get worse, because that
  // would forbid demolition — but nothing is handed over while a promise is
  // unkept. A delivery with a red proof asks the person to finish the work
  // and to decide which reds are acceptable, which is the machine's job.
  // A criterion nothing could judge is neither repaired nor withheld: only
  // a change to what was asked settles it, so it reaches the person.
  proposeRewording(tep, proofs, log, defect);
  let unkept = proofs.filter(unkeptProof);
  unkept = await repairUnkept({
    tep, worktree, slices, space, cut, deps, proofs, observations, verifs, probeOfAc, criterionByProbe,
    checkOf: g.checkOf, sliceProbes: g.sliceProbes, sessionOf: g.sessionOf, worker: g.worker, baseSha: g.baseSha,
    halted: () => g.state.halted, doing: (t) => g.state.doing(`${GATE_STEP}#closer`, t), rulings: g.rulings,
    abortable: (ab) => g.state.aborts.set(`${GATE_STEP}#closer`, ab),
    ...(g.restored?.length ? { restored: g.restored } : {}),
    ...(g.clearFor ? { clearFor: g.clearFor } : {}),
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
      proofs,
      undelivered,
      verifs,
      acResults,
      runId,
      producedAt,
      // Only an opened delivery captures its checks; a withheld run keeps
      // its files in the tree and must not replace what a delivery kept.
      ...(unkept.length ? {} : { checks: kept }),
      ...(observations.length ? { observations } : {}),
      machineAttention: g.machineAttention(),
    });
  undelivered.push(...docsObligations(slices, worktree));

  // A red REVIEW after every actor is spent is a judgement with nobody
  // left to satisfy it — the person at Accept is the only actor there is.
  // It rides the delivery as a finding, said by name; only a red CHECK of
  // the cut's own promises still withholds, because an unkept promise is
  // the one thing this gate exists to never hand over.
  for (const r of unsettledReviews(proofs)) {
    findings.push(r.line);
    log(`${tep}: "${r.label.slice(0, 70)}" stays red with every actor spent — it rides the delivery for the person`);
  }
  unkept = unkept.filter((x) => x.kind === "probe");
  if (unkept.length) {
    await exec("git", ["add", "-A", "."], worktree);
    await exec("git", ["commit", "-m", `tandem: ${tep} (withheld — ${unkept.length} unkept)`], worktree);
    const named = unkept.map((p) => `- ${p.label}${p.ref ? `: ${p.ref.split("\n")[0].slice(0, 160)}` : ""}`);
    // A person's Stop is not a verdict on the work. A run stopped
    // mid-grading once recorded every interrupted check as red — exit 124,
    // "[stopped]" — and withheld with "34 promises are not kept", which
    // reads as the work failing thirty-four times when what happened is
    // one person pressing one button. Stopped work is ungraded, not bad.
    // A stop during the repair round leaves verdicts that were reached
    // before it; those stand, and the stop only says the repair did not.
    if (g.state.halted) {
      const judged = unkept.filter((p) => !/the run was halted|\[stopped/i.test(p.ref ?? ""));
      say(`${tep}: stopped by the person — ${unkept.length} promise(s) were still being graded; nothing is judged from a stop`);
      return {
        refusals: [],
        undelivered,
        delivery: withheldDelivery({
          tep, cut, branch, runId, producedAt, proofs, undelivered, observations, findings,
          rulings: g.rulings, decisions: g.decisions,
          reason: judged.length
            ? `the run was stopped with ${judged.length} promise(s) found not kept and their repair unfinished. ` +
              `The branch holds the work; run it again to finish.`
            : `the run was stopped while ${unkept.length} promise(s) were still being graded — nothing was judged from the stop. ` +
              `The branch holds the work; run it again to finish the grading.`,
        }),
      };
    }
    say(`${tep}: withheld — ${unkept.length} promise(s) are not kept`);
    return {
      refusals: [],
      undelivered,
      delivery: withheldDelivery({
        tep, cut, branch, runId, producedAt, proofs, undelivered, observations, findings,
        rulings: g.rulings, decisions: g.decisions,
        reason:
          `${unkept.length} of the cut's promises are not kept, so nothing is handed over. The branch holds the work:\n` +
          named.join("\n"),
      }),
    };
  }

  // A criterion no proof mentions is not silently kept: it is named as
  // undelivered here, the same reading the delivery page gives it as
  // "not checked" — so the page, the pull request and this gate's own
  // kept-or-withheld verdict never disagree about a criterion nobody graded.
  const ungraded = criterionVerdicts(space, {
    id: `delivery-${tep}`,
    cutId: cut.id,
    branch,
    runId,
    producedAt,
    proofs,
    ...(observations.length ? { observations } : {}),
  }).filter((c) => c.verdict === "not checked");
  undelivered.push(...ungraded.map((c) => `${c.promise} — not checked: ${c.text}`));

  // A promise whose sentence names a human gesture, but whose door the
  // machine could not prove renders in the surface this build shipped, is
  // never silently dropped from its "see it" line: it is named here as
  // undelivered, in the same words the page's own render would give it.
  const cutMembers = cut.changeIds
    .map((id) => space.nodes.find((n) => n.id === id))
    .filter((n): n is (typeof space.nodes)[number] => !!n);
  const surfaceText = await fs
    .readFile(path.join(worktree, "media", "map", "index.html"), "utf8")
    .catch(() => "");
  undelivered.push(...unprovenDoorPromises(cutMembers, surfaceText));

  // The shape of what was delivered, said and never enforced.
  const moduleSizes = await treeShape(worktree);
  g.state.phase("gate", "done", "every check held");
  g.state.phase("delivery", "running", "committing the work and opening the delivery");
  return handOver({
    tep, branch, worktree, space, cut, deps, runId, producedAt, proofs, observations, undelivered, findings,
    ...(moduleSizes ? { moduleSizes } : {}),
    rulings: g.rulings, decisions: g.decisions, kept, recordPath, exec,
    // The work goes into the project here, so the platform can start
    // building it while the record is written.
    land: async () => {
      try {
        const l = await landDelivery({ repoRoot: deps.repoRoot, branch, tep, exec });
        return { ok: true, pushed: l.pushed, head: l.head, ...(l.why ? { why: l.why } : {}) };
      } catch (err) {
        return { ok: false, why: err instanceof Error ? err.message : String(err) };
      }
    },
    log: (l: string) => log(l, "delivery"),
  });
}
