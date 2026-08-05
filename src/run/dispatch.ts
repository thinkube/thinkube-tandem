/**
 * The run between the gates, driven by the imported engine: the signed
 * TEP's slices go through the REAL buildUnitDag; test units author probes
 * first (tests-first edges), coders build against verified briefs; the
 * closing gate runs every acceptance verification through the engine's
 * bounded executor; the branch becomes a delivery on the forge. Every
 * failure lands as an artifact — UNDELIVERED, containment, red proofs —
 * never as silence.
 */
import { execFile } from "node:child_process";
import * as fs from "node:fs";
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
import { Forge } from "../dispatch/forge";
import { RunState } from "./state";
import { runUnitWorker, porcelainPaths, WorkerOutcome } from "./worker";

export interface DispatchDeps {
  repoRoot: string;
  model: string;
  suiteCommand: string[];
  forge?: Forge;
  state: RunState;
  spaceName: string;
  /** Injectable for tests: replaces the SDK worker. */
  worker?: (
    deps: Parameters<typeof runUnitWorker>[0],
    brief: string,
  ) => Promise<WorkerOutcome>;
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
  const worktree = path.join(path.dirname(deps.repoRoot), `${path.basename(deps.repoRoot)}-worktrees`, tep);
  const log = (l: string) => st.log(l);

  const dag = buildUnitDag(slices);
  const verdict = validateDag(dag) as { ok: boolean; error?: string };
  if (!verdict.ok)
    return { refusals: [`the engine refused the plan: ${JSON.stringify(verdict)}`], undelivered: [] };
  for (const u of dag) st.seed(u.id, u.slice, (u.role ?? "code") as "code" | "test");

  log(`${tep}: worktree on ${branch}`);
  await exec("git", ["-C", deps.repoRoot, "worktree", "remove", "--force", worktree], deps.repoRoot).catch(() => ({ code: 1, out: "" }));
  await exec("git", ["-C", deps.repoRoot, "branch", "-D", branch], deps.repoRoot).catch(() => ({ code: 1, out: "" }));
  const wt = await exec("git", ["-C", deps.repoRoot, "worktree", "add", "-b", branch, worktree], deps.repoRoot);
  if (wt.code !== 0)
    return { refusals: [`worktree failed: ${wt.out.trim().slice(0, 300)}`], undelivered: [] };

  const specBody = renderTepBody(space, cut);
  const undelivered: string[] = [];
  const done = new Set<string>();
  const failed = new Set<string>();

  // Dependency-ordered execution over the engine's DAG (serial walk; the
  // frontier's parallel pump returns with the full shell re-host).
  const inDag = new Set(dag.map((u) => u.id));
  const pending = new Set(dag.map((u) => u.id));
  while (pending.size && !st.halted) {
    const next = dag.find(
      (u) =>
        pending.has(u.id) &&
        u.requires.every((r) => !inDag.has(r) || done.has(r)) &&
        u.requires.every((r) => !failed.has(r)),
    );
    if (!next) break;
    pending.delete(next.id);
    const role = (next.role ?? "code") as "code" | "test";
    st.set(next.id, "running");
    log(`▸ ${next.id} (${role})`);
    const baseline = new Set(await porcelainPaths(worktree));
    const abort = new AbortController();
    st.aborts.set(next.id, abort);
    const brief = buildWorkerPrompt(next, tep, {
      specBody,
      tepBody: specBody,
      cwd: worktree,
      testConvention:
        "node:test ESM modules run directly with `node --test <file>` — name probe files exactly as the footprint states (.test.mjs, no build step)",
    });
    const outcome = await worker(
      {
        model: deps.model,
        worktree,
        role,
        footprint: next.footprint,
        baseline,
        abort,
        onPark: (q, answer) => st.park(next.id, q, answer),
        log,
      },
      brief,
    );
    st.aborts.delete(next.id);
    if (outcome.containment) {
      failed.add(next.id);
      st.set(next.id, "failed");
      log(`⛔ ${next.id}: footprint violation — run halted`);
      st.halt();
      break;
    }
    if (!outcome.ok) {
      failed.add(next.id);
      st.set(next.id, "failed");
      undelivered.push(...(outcome.undelivered ?? [`${next.id}: failed`]).map((u) => `${next.id}: ${u}`));
    } else {
      done.add(next.id);
      st.set(next.id, "done");
    }
  }
  for (const id of pending) {
    st.set(id, "failed");
    undelivered.push(`${id}: not dispatched (halted or blocked by a failed dependency)`);
  }

  log(`${tep}: closing gate`);
  const verifs: AcVerification[] = [];
  let ord = 0;
  for (const s of slices)
    for (const u of s.workUnits)
      if (u.role === "test")
        for (const probe of u.footprint)
          verifs.push({ ac: ++ord, run: `node --test ${probe}`, env: "local" });
  // Probe runs must not inherit the host test-runner's context: a child
  // `node --test` that detects a parent runner SKIPS itself and exits 0 —
  // a false green (the env-leak defect class from the ledger). Scrub the
  // runner-context variables before every proof spawn.
  const scrubbedEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(scrubbedEnv))
    if (/^NODE_TEST|^TEST_|^NODE_OPTIONS$/.test(k)) delete scrubbedEnv[k];
  const scrubbedExec: AcExec = (run, cwd) =>
    runBounded(run, cwd, { timeoutMs: DEFAULT_AC_TIMEOUT_MS, env: scrubbedEnv });
  const acResults = await runAcVerifications(verifs, worktree, scrubbedExec);
  const proofs: Proof[] = acResults.map((r) => ({
    kind: "probe",
    label: `AC-${r.ac}`,
    verdict: r.pass ? "green" : "red",
    ...(r.evidence ? { ref: r.evidence.slice(0, 200) } : {}),
  }));
  const suite = await exec(deps.suiteCommand[0], deps.suiteCommand.slice(1), worktree);
  proofs.push({ kind: "suite", label: "repo suite", verdict: suite.code === 0 ? "green" : "red" });

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

/** The TEP rendered for briefs: the asks' words plus the grounded slices. */
function renderTepBody(space: Space, cut: Cut): string {
  const byId = new Map(space.nodes.map((n) => [n.id, n]));
  const members = cut.changeIds.map((id) => byId.get(id)).filter((c) => !!c);
  const askIds = new Set(members.flatMap((c) => c!.serves));
  const asks = space.asks.filter((a) => askIds.has(a.id));
  const lines: string[] = [];
  lines.push(`# ${cut.tepId ?? cut.id}`);
  lines.push(`## The asks (verbatim)`);
  for (const a of asks) lines.push(`- ${a.text.trim()}`);
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

