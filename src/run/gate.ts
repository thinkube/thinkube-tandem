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
import { provedByExecution } from "./wiring";
import type { WiringVerdict } from "./wiring";
import { isTestPath } from "./testHomes";
import type { DispatchDeps, DispatchOutcome } from "./dispatch";
import type { RunState } from "./state";
import { suiteFootprint, suiteVerdictOf } from "./suite";
import { repairSuiteAtGate } from "./gateRepair";
import { close } from "./closer";

export interface GateContext {
  tep: string;
  branch: string;
  baseSha: string;
  worktree: string;
  slices: SliceForDag[];
  space: Space;
  cut: Cut;
  deps: DispatchDeps;
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
export const RED_SUITE_REFUSAL =
  "the repository's standing checks are red after the work — the delivery is withheld " +
  "rather than handed over red; the branch keeps the work and the run record keeps the " +
  "suite's verdict (if the repository was already red before, it must be green first)";

export async function closeGate(g: GateContext): Promise<DispatchOutcome> {
  const { tep, branch, worktree, slices, space, cut, deps, exec, boundedExec, log, defect } = g;
  const undelivered = g.undelivered;
  log(`${tep}: closing gate`);
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
  log(`${tep}: running the repository's own suite on the delivered tree (minutes)`);
  const ran = await exec(deps.suiteCommand[0], deps.suiteCommand.slice(1), worktree);
  let verdict = suiteVerdictOf(ran.code, ran.out, worktree);
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
      suiteExec: g.suiteExec,
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
          const r = await exec(deps.suiteCommand[0], deps.suiteCommand.slice(1), worktree);
          const v = suiteVerdictOf(r.code, r.out, worktree);
          return {
            green: v.green,
            score: v.failures.length,
            evidence: `${v.summary}\n${v.failures.map((f) => `${f.name}${f.file ? ` (${f.file})` : ""}\n${f.detail}`).join("\n\n")}`.slice(0, 6000),
            // The last actor's clearance grows with what fails it. At the
            // gate this was computed once, at the start, so the closer was
            // handed "full authority" and then had two of its edits
            // restored by the guard because the files the failure named
            // were not in a list made before the failure was read.
            alsoOwn: suiteFootprint(v.failures, worktree),
          };
        },
        exec,
        boundedExec: g.suiteExec,
        halted: () => g.state.halted,
        log: (l) => log(l, "gate#closer"),
        say: (t) => g.state.doing("gate#closer", t),
        onRuling: (r) => g.rulings.push({ criterionId: r.criterionId, unit: r.unit, granted: r.granted, reason: r.reason }),
        defect: (e) => defect({ unit: "gate#closer", ...e }),
        ...(deps.worker ? { worker: deps.worker } : {}),
      });
      if (closed.green) {
        const again = await exec(deps.suiteCommand[0], deps.suiteCommand.slice(1), worktree);
        verdict = suiteVerdictOf(again.code, again.out, worktree);
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
      await writeDeliveryRecord(deps.storeDir, { tep, branch, baseSha: g.baseSha, proofs, undelivered, verifs, acResults });
    undelivered.push(...docsObligations(slices, worktree));
    await exec("git", ["add", "-A", "."], worktree);
    await exec("git", ["commit", "-m", `tandem: ${tep} (suite red — withheld)`], worktree);
    // Withheld is still on the record: what was checked and why it stopped
    // is readable; nothing was opened and it cannot be accepted.
    const withheld: Delivery = {
      id: `delivery-${tep}`,
      cutId: cut.id,
      branch,
      proofs,
      withheld: `${RED_SUITE_REFUSAL} — still red: ${names.join("; ").slice(0, 500)}`,
      ...(undelivered.length ? { undelivered } : {}),
      ...(g.rulings.length ? { rulings: g.rulings } : {}),
      ...(g.decisions.length ? { decisions: g.decisions } : {}),
    };
    return { refusals: [RED_SUITE_REFUSAL], undelivered, delivery: withheld };
  }

  // A check proves a promise once; it does not join the repository's suite
  // because it exists. Its source and its verdict are kept on the delivery
  // record — where a person can read what was driven — and the file leaves
  // the tree, so a delivery of N promises does not hand the repository N
  // permanent tests to maintain forever.
  const kept = await keptChecks([...g.sliceProbes.values()].flat(), worktree, criterionByProbe);
  for (const c of kept) await fs.rm(path.join(worktree, c.path), { force: true }).catch(() => {});
  log(`${tep}: ${kept.length} check(s) recorded on the delivery and discarded from the tree`);

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
      checks: kept,
    });
  undelivered.push(...docsObligations(slices, worktree));

  // Delivery only at zero. The branch may hold any state along the way —
  // there is deliberately no rule that it may never get worse, because that
  // would forbid demolition — but nothing is handed over while a promise is
  // unkept. A delivery with a red proof asks the person to finish the work
  // and to decide which reds are acceptable, which is the machine's job.
  const unkept = proofs.filter((p) => p.verdict !== "green");
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
        proofs,
        withheld:
          `${unkept.length} of the cut's promises are not kept, so nothing is handed over. The branch holds the work:\n` +
          named.join("\n"),
        ...(undelivered.length ? { undelivered } : {}),
        ...(g.rulings.length ? { rulings: g.rulings } : {}),
        ...(g.decisions.length ? { decisions: g.decisions } : {}),
      },
    };
  }

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
