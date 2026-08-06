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
import { MAX_REWORK_ATTEMPTS } from "../engine/core/redispatch";
import {
  createVerifyOracle,
  formatVerifyReply,
  VerifyOracle,
} from "../engine/verifyOracle";
import { persistProbes, restoreProbes } from "../engine/oracleStore";
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
  /** Concurrent workers on the ready frontier (default 2). */
  concurrency?: number;
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

type Exec = NonNullable<DispatchDeps["exec"]>;

/** Probe runs and oracle rounds must not inherit the host test-runner's
 *  context: a child `node --test` that detects a parent runner SKIPS itself
 *  and exits 0 — a false green. */
function scrubbedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env))
    if (/^NODE_TEST|^TEST_|^NODE_OPTIONS$/.test(k)) delete env[k];
  return env;
}

/**
 * Create or re-point a detached snapshot worktree at `ref`'s current commit.
 * Reuse = re-snapshot: hard reset + `clean -fd` (no -x — provisioning like
 * node_modules survives), so every use grades a fresh base.
 */
async function ensureSnapshot(
  repoRoot: string,
  ref: string,
  dir: string,
  exec: Exec,
): Promise<boolean> {
  const sha = (await exec("git", ["-C", repoRoot, "rev-parse", ref], repoRoot)).out.trim();
  const reg = await exec("git", ["-C", repoRoot, "worktree", "list", "--porcelain"], repoRoot);
  if (reg.out.includes(`worktree ${dir}`)) {
    await exec("git", ["-C", dir, "reset", "--hard", sha], dir);
    await exec("git", ["-C", dir, "clean", "-fd"], dir);
    return true;
  }
  await fs.mkdir(path.dirname(dir), { recursive: true });
  const add = await exec(
    "git",
    ["-C", repoRoot, "worktree", "add", "--detach", dir, sha],
    repoRoot,
  );
  return add.code === 0;
}

async function copyRel(fromRoot: string, toRoot: string, rel: string): Promise<void> {
  const dst = path.join(toRoot, rel);
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(path.join(fromRoot, rel), dst);
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

  const dag = buildUnitDag(slices);
  const verdict = validateDag(dag) as { ok: boolean; error?: string };
  if (!verdict.ok)
    return { refusals: [`the engine refused the plan: ${JSON.stringify(verdict)}`], undelivered: [] };
  for (const u of dag) st.seed(u.id, u.slice, (u.role ?? "code") as "code" | "test");

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

  const oracles = new Map<string, VerifyOracle>();
  const buildOracle = (slice: string): VerifyOracle | undefined => {
    const probes = sliceProbes.get(slice) ?? [];
    const verifs = sliceVerifs.get(slice) ?? [];
    if (!probes.length || !verifs.length) return undefined;
    const existing = oracles.get(slice);
    if (existing) return existing;
    const runnerDir = path.join(wtRoot, "oracle-runners", `${tep}-${slice}`);
    const oracle = createVerifyOracle({
      codeWorktree: worktree,
      testerWorktree: testerWt,
      runnerDir,
      probeFiles: probes,
      verifications: verifs,
      exec: boundedExec,
      porcelain: async (cwd) =>
        (await exec("git", ["-C", cwd, "status", "--porcelain", "--untracked-files=all"], cwd)).out,
      resetRunner: async () => {
        await ensureSnapshot(deps.repoRoot, branch, runnerDir, exec);
      },
      copyIn: (fromRoot, rel) => copyRel(fromRoot, runnerDir, rel),
      removeIn: async (rel) => {
        await fs.rm(path.join(runnerDir, rel), { force: true });
      },
      readFile: (root, rel) => fs.readFile(path.join(root, rel)),
      log,
    });
    oracles.set(slice, oracle);
    return oracle;
  };

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
    const baseBrief = buildWorkerPrompt(next, tep, {
      specBody,
      tepBody: specBody,
      cwd: tree,
      testConvention:
        "node:test ESM modules run directly with `node --test <file>` — name probe files exactly as the footprint states (.test.mjs, no build step)",
    });
    const oracleStanza = oracle
      ? "\n\nA `verify` tool is available (tandem MCP): it runs this slice's acceptance checks against your CURRENT work in an isolated runner and returns per-criterion PASS/FAIL with evidence. Use it before declaring done — your completion is judged by its green, not by your claim."
      : "";

    let ok = false;
    const attempts = oracle ? MAX_REWORK_ATTEMPTS : 1;
    let brief = baseBrief + oracleStanza;
    for (let attempt = 1; attempt <= attempts && !st.halted; attempt++) {
      const outcome = await worker(
        {
          model: deps.model,
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
          `${next.id}: verify oracle ${r.kind} — the checks never went green`,
        );
        break;
      }
      if (attempt < attempts) {
        log(`↻ ${next.id}: checks not green — rework ${attempt + 1}/${attempts}`);
        brief =
          baseBrief +
          oracleStanza +
          `\n\nREWORK ${attempt + 1}/${attempts} — a previous attempt left the checks NOT GREEN. The oracle's last verdict:\n${formatVerifyReply(r)}`;
      } else {
        undelivered.push(
          `${next.id}: checks not green after ${attempts} attempts — ${formatVerifyReply(r).split("\n")[0]}`,
        );
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
  const decided = space.questions.filter((q) => q.decided);
  if (decided.length) {
    lines.push(`## Decisions in force (the human settled these — build under them)`);
    for (const q of decided) lines.push(`- ${q.decided!.text}`);
  }
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
