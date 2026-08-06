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
import { execFile } from "node:child_process";
import { accessSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Cut, Delivery, Proof, Space } from "../core/schema";
import type { SliceForDag } from "../engine/core/dag";
import { buildUnitDag } from "../engine/core/dag";
import { buildWorkerPrompt } from "../engine/core/preflight";
import {
  runAcVerifications,
  AcVerification,
  AcExec,
  DEFAULT_AC_TIMEOUT_MS,
  runBounded,
} from "../engine/core/closingGate";
import { validateDag } from "../engine/methodology/parallelSlices";
import { MAX_REWORK_ATTEMPTS, unmetDocsObligation } from "../engine/core/redispatch";
import { isStubScannableFile, scanStubMarkers } from "../engine/core/stubScan";
import { buildVerificationTrace } from "../engine/core/trace";
import { formatVerifyReply } from "../engine/verifyOracle";
import { persistProbes, restoreProbes } from "../engine/oracleStore";
import { appendDefect } from "../engine/defectLog";
import { resolveWorkerModel, WorkerModelConfig } from "../engine/workerModel";
import { copyRel, ensureSnapshot, scrubbedEnv, sliceOracleFactory } from "./oracle";
import { foldBlastRadius } from "./plan";
import { renderTepBody } from "./briefs";
import { runReadRound } from "../derive/round";
import { Forge } from "../dispatch/forge";
import { RunState } from "./state";
import { runUnitWorker, porcelainPaths, WorkerOutcome } from "./worker";

export interface DispatchDeps {
  repoRoot: string;
  model: string;
  /** Per-role model resolution (judgment raised above the base). */
  workerModel?: WorkerModelConfig;
  suiteCommand: string[];
  forge?: Forge;
  state: RunState;
  spaceName: string;
  /** The store dir for find-time defect rows (fail-soft; absent = no ledger). */
  storeDir?: string;
  /** Concurrent workers on the ready frontier (default 4, the v1 default). */
  concurrency?: number;
  /** Injectable for tests: replaces the SDK worker. */
  worker?: (
    deps: Parameters<typeof runUnitWorker>[0],
    brief: string,
  ) => Promise<WorkerOutcome>;
  /** Injectable for tests: replaces the supervisor's SDK round. */
  supervisorRound?: typeof runReadRound;
  exec?: (cmd: string, args: string[], cwd: string) => Promise<{ code: number; out: string }>;
}

const defaultExec = (
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; out: string }> =>
  new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) =>
        resolve({
          code:
            err && typeof (err as { code?: unknown }).code === "number"
              ? ((err as { code?: number }).code as number)
              : err
                ? 1
                : 0,
          out: `${stdout}\n${stderr}`,
        }),
    );
  });

export interface DispatchOutcome {
  delivery?: Delivery;
  refusals: string[];
  undelivered: string[];
  url?: string;
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
  const branch = `tandem/${tep}`;
  const wtRoot = path.join(
    path.dirname(deps.repoRoot),
    `${path.basename(deps.repoRoot)}-worktrees`,
  );
  const worktree = path.join(wtRoot, tep);
  const testerWt = path.join(wtRoot, `${tep}-tester`);
  const storeDir = path.join(wtRoot, "oracle-store", tep);
  const log = (l: string) => st.log(l);
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

  const blast = await foldBlastRadius(slices, deps.repoRoot, exec, log);
  if (blast) return { refusals: [blast], undelivered: [] };

  const dag = buildUnitDag(slices);
  const verdict = validateDag(dag) as { ok: boolean; error?: string };
  if (!verdict.ok)
    return { refusals: [`the engine refused the plan: ${JSON.stringify(verdict)}`], undelivered: [] };
  for (const u of dag)
    st.seed(
      u.id,
      u.slice,
      (u.role ?? "code") as "code" | "test",
      u.requires.filter((r) => dag.some((x) => x.id === r)),
    );

  log(`${tep}: worktree on ${branch}`);
  for (const stale of [worktree, testerWt])
    await exec("git", ["-C", deps.repoRoot, "worktree", "remove", "--force", stale], deps.repoRoot);
  await exec("git", ["-C", deps.repoRoot, "worktree", "prune"], deps.repoRoot);
  await exec("git", ["-C", deps.repoRoot, "branch", "-D", branch], deps.repoRoot);
  const wt = await exec("git", ["-C", deps.repoRoot, "worktree", "add", "-b", branch, worktree], deps.repoRoot);
  if (wt.code !== 0)
    return { refusals: [`worktree failed: ${wt.out.trim().slice(0, 300)}`], undelivered: [] };
  if (!(await ensureSnapshot(deps.repoRoot, branch, testerWt, exec)))
    return { refusals: [`tester snapshot failed at ${testerWt}`], undelivered: [] };
  const baseSha = (await exec("git", ["-C", worktree, "rev-parse", "HEAD"], worktree)).out.trim();
  await restoreProbes(storeDir, testerWt);
  log(`${tep}: tester snapshot at ${path.basename(testerWt)} (structural blinding)`);

  const specBody = renderTepBody(space, cut);
  const undelivered: string[] = [];
  const done = new Set<string>();
  const failed = new Set<string>();
  const inDag = new Set(dag.map((u) => u.id));
  const pending = new Set(dag.map((u) => u.id));

  // Per-slice bookkeeping: probe files + runnable checks for the oracle, and
  // the countdown that triggers the slice commit when its last unit lands.
  const sliceProbes = new Map<string, string[]>();
  const sliceVerifs = new Map<string, AcVerification[]>();
  const sliceFiles = new Map<string, string[]>();
  const sliceRemaining = new Map<string, number>();
  for (const s of slices) {
    const probes = s.workUnits
      .filter((u) => u.role === "test")
      .flatMap((u) => u.footprint);
    sliceProbes.set(s.handle, probes);
    sliceVerifs.set(
      s.handle,
      probes.map((p, i) => ({ ac: i + 1, run: `node --test ${p}`, env: "local" })),
    );
    sliceFiles.set(s.handle, s.files ?? []);
  }
  for (const u of dag)
    sliceRemaining.set(u.slice, (sliceRemaining.get(u.slice) ?? 0) + 1);

  const briefBySlice = new Map<string, string>();
  const buildOracle = sliceOracleFactory({
    repoRoot: deps.repoRoot,
    branch,
    wtRoot,
    tep,
    worktree,
    testerWt,
    sliceProbes,
    sliceVerifs,
    briefBySlice,
    model: deps.model,
    workerModel: deps.workerModel,
    supervisorRound: deps.supervisorRound,
    exec,
    boundedExec,
    log,
    defect,
  });

  // Containment across the frontier: a unit is fenced to its own footprint,
  // but writes by OTHER live units in the same tree are theirs, not strays.
  const liveFootprints = new Map<string, { tree: string; paths: string[] }>();
  const unionFor = (tree: string, selfId: string): (() => string[]) => () =>
    [...liveFootprints.entries()]
      .filter(([id, v]) => id !== selfId && v.tree === tree)
      .flatMap(([, v]) => v.paths);

  let testInflight = 0;
  const sliceCommitted = new Set<string>();

  /** Copy the slice's probes into the code worktree and commit the slice's
   *  own paths on the branch — later tester snapshots see committed truth. */
  const commitSlice = async (slice: string): Promise<void> => {
    if (sliceCommitted.has(slice)) return;
    sliceCommitted.add(slice);
    const probes = sliceProbes.get(slice) ?? [];
    for (const rel of probes)
      await copyRel(testerWt, worktree, rel).catch(() => {});
    const paths = [...(sliceFiles.get(slice) ?? []), ...probes];
    if (paths.length) await exec("git", ["add", "--", ...paths], worktree);
    await exec("git", ["commit", "-m", `tandem: ${tep} ${slice}`], worktree);
    log(`✓ ${slice}: committed on ${branch}`);
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
    log(`▸ ${next.id} (${role})`);
    const tree = role === "test" ? testerWt : worktree;
    if (role === "test") {
      // Re-snapshot only when no other test author is mid-flight — a reset
      // under a live author would wipe its work.
      if (testInflight === 0) {
        await ensureSnapshot(deps.repoRoot, branch, testerWt, exec);
        await restoreProbes(storeDir, testerWt);
      }
      testInflight++;
    }
    const baseline = new Set(await porcelainPaths(tree));
    const abort = new AbortController();
    st.aborts.set(next.id, abort);
    liveFootprints.set(next.id, { tree, paths: next.footprint });

    const oracle = role === "code" ? buildOracle(next.slice) : undefined;
    if (role === "code") await restoreProbes(storeDir, testerWt);

    // Grade-first: when the committed state already satisfies the checks
    // (a resume, a re-run, an earlier slice's work), the unit completes
    // without spending a worker.
    if (oracle) {
      const pre = await oracle.confirmGreen();
      if (pre.green) {
        log(`✓ ${next.id}: grade-first — the checks are already green, no worker spent`);
        st.aborts.delete(next.id);
        liveFootprints.delete(next.id);
        await finishUnit(next.id, next.slice, true);
        return;
      }
    }

    const baseBrief = buildWorkerPrompt(next, tep, {
      specBody,
      tepBody: specBody,
      cwd: tree,
      testConvention:
        "node:test ESM modules run directly with `node --test <file>` — name probe files exactly as the footprint states (.test.mjs, no build step)",
    });
    briefBySlice.set(next.slice, baseBrief);
    const oracleStanza = oracle
      ? "\n\nA `verify` tool is available (tandem MCP): it runs this slice's acceptance checks against your CURRENT work in an isolated runner and returns per-criterion PASS/FAIL with evidence. Use it before declaring done — your completion is judged by its green, not by your claim."
      : "";
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
          footprint: next.footprint,
          alsoAllowed: unionFor(tree, next.id),
          baseline,
          abort,
          onPark: (q, answer) => st.park(next.id, q, answer),
          log,
          ...(oracle
            ? {
                verifyTool: async () => {
                  const r = await oracle.verify();
                  return formatVerifyReply(r);
                },
              }
            : {}),
        },
        brief,
      );
      if (outcome.containment) {
        log(`⛔ ${next.id}: footprint violation — run halted`);
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
        if (!ok)
          undelivered.push(
            ...(outcome.undelivered ?? [`${next.id}: failed`]).map((u) => `${next.id}: ${u}`),
          );
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
        undelivered.push(
          `${next.id}: verify oracle ${r.kind} — the checks are not green`,
        );
        break;
      }
      if (attempt < attempts) {
        log(`↻ ${next.id}: checks not green — rework ${attempt + 1}/${attempts}`);
        brief =
          baseBrief +
          oracleStanza +
          disclosure +
          `\n\nREWORK ${attempt + 1}/${attempts} — a previous attempt left the checks NOT GREEN. The oracle's last verdict:\n${formatVerifyReply(r)}`;
      } else {
        undelivered.push(
          `${next.id}: checks not green after ${attempts} attempts — ${formatVerifyReply(r).split("\n")[0]}`,
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
          undelivered.push(
            `${next.id}: declared probe missing at persist (${err instanceof Error ? err.message : String(err)})`,
          );
        }
      }
    }
    await finishUnit(next.id, next.slice, ok);
  };

  // The frontier pump: launch every ready unit up to the concurrency cap;
  // wake on any completion; stop when nothing is ready and nothing is live.
  const concurrency = Math.max(1, deps.concurrency ?? 2);
  const inflight = new Map<string, Promise<void>>();
  while (!st.halted) {
    const ready = dag.filter(
      (u) =>
        pending.has(u.id) &&
        u.requires.every((r) => !inDag.has(r) || done.has(r)) &&
        !u.requires.some((r) => failed.has(r)),
    );
    for (const u of ready) {
      if (inflight.size >= concurrency) break;
      pending.delete(u.id);
      const p = runOne(u).finally(() => {
        inflight.delete(u.id);
      });
      inflight.set(u.id, p);
    }
    if (inflight.size === 0) break;
    await Promise.race([...inflight.values()]);
  }
  await Promise.all([...inflight.values()]);
  for (const id of pending) {
    st.set(id, "failed");
    undelivered.push(`${id}: not dispatched (halted or blocked by a failed dependency)`);
  }

  log(`${tep}: closing gate`);
  // Probes ride the branch: any not yet copied by a slice commit (failed or
  // halted slices) still land in the code worktree so the gate's verdict is
  // about the real state, not about a missing file.
  for (const [slice, probes] of sliceProbes)
    if (!sliceCommitted.has(slice))
      for (const rel of probes) await copyRel(testerWt, worktree, rel).catch(() => {});
  const verifs: AcVerification[] = [];
  let ord = 0;
  for (const s of slices)
    for (const u of s.workUnits)
      if (u.role === "test")
        for (const probe of u.footprint)
          verifs.push({ ac: ++ord, run: `node --test ${probe}`, env: "local" });
  const gateExec: AcExec = (run, cwd) => boundedExec(run, cwd);
  const acResults = await runAcVerifications(verifs, worktree, gateExec);
  const proofs: Proof[] = acResults.map((r) => ({
    kind: "probe",
    label: `AC-${r.ac}`,
    verdict: r.pass ? "green" : "red",
    ...(r.evidence ? { ref: r.evidence.slice(0, 200) } : {}),
  }));
  for (const r of acResults)
    if (!r.pass && /12[67]/.test(String((r as { code?: number }).code ?? "")))
      defect({
        activity: "closing gate",
        trigger: "gate-infra",
        type: "gate",
        impact: "verification unavailable",
        detail: `AC-${r.ac} runner exited 126/127 — a gate defect, not a code verdict`,
      });

  // The honesty scan over the delivered code: a self-declared deferral in a
  // shipped file is UNDELIVERED on the delivery's face, never a footnote.
  {
    const delivered = (
      await exec(
        "git",
        ["-C", worktree, "diff", "--name-only", "--diff-filter=d", `${baseSha}..HEAD`],
        worktree,
      )
    ).out
      .split("\n")
      .concat(await porcelainPaths(worktree))
      .map((p) => p.trim())
      .filter(Boolean);
    for (const rel of [...new Set(delivered)]) {
      if (!isStubScannableFile(rel)) continue;
      let content = "";
      try {
        content = await fs.readFile(path.join(worktree, rel), "utf8");
      } catch {
        continue;
      }
      const confessions = scanStubMarkers(rel, content).filter((h) => !h.weak);
      for (const h of confessions) {
        undelivered.push(`${h.file}:${h.line} confesses a deferral: ${h.text}`);
        defect({
          activity: "closing gate",
          trigger: "stub-scan",
          qualifier: "missing",
          impact: "undelivered surfaced",
          detail: `${h.file}:${h.line} ${h.text}`,
        });
      }
    }
  }
  const suite = await exec(deps.suiteCommand[0], deps.suiteCommand.slice(1), worktree);
  proofs.push({ kind: "suite", label: "repo suite", verdict: suite.code === 0 ? "green" : "red" });

  // The delivery's MACHINE FACE persists beside the space: the engine's
  // structured verification trace plus the run facts — the delivery page is
  // a render, this file is the evidence record.
  if (deps.storeDir) {
    try {
      const trace = buildVerificationTrace({ round: 1, declared: verifs, acResults });
      const dir = path.join(deps.storeDir, "deliveries");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, `${tep}.json`),
        JSON.stringify(
          { tep, branch, baseSha, proofs, undelivered, trace },
          null,
          2,
        ),
      );
    } catch {
      /* the record is best-effort; the run's verdicts already live on the delivery */
    }
  }

  // Docs gate: a slice that declares documentation (a docs/ touchpoint)
  // must have LANDED it — the engine's obligation check runs against the
  // real tree, and an unmet obligation is UNDELIVERED on the page's face.
  for (const s of slices) {
    const declaresDocs = (s.files ?? []).some((f) => f.startsWith("docs/"));
    const note = unmetDocsObligation(
      {
        docs: declaresDocs ? "required" : undefined,
        files: s.files,
        work_units: s.workUnits,
      },
      (rel) => {
        try {
          accessSync(path.join(worktree, rel));
          return true;
        } catch {
          return false;
        }
      },
    );
    if (note) undelivered.push(`${s.handle}: ${note}`);
  }

  log(`${tep}: committing and opening the delivery`);
  await exec("git", ["add", "-A", "."], worktree);
  await exec("git", ["commit", "-m", `tandem: deliver ${tep}`], worktree);
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
  return {
    refusals: [],
    undelivered,
    url,
    delivery: {
      id: `delivery-${tep}`,
      cutId: cut.id,
      branch,
      proofs,
      ...(url ? { url } : {}),
      ...(undelivered.length ? { undelivered } : {}),
    },
  };
}
