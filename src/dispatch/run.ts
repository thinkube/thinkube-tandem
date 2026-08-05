/**
 * The run: everything between the two gates, with no human in it. A signed
 * cut becomes a worktree on its own branch; each work order gets a blind
 * probe author and then a builder; probes and the suite become proofs; the
 * branch becomes a delivery on the project's forge. Failures land as
 * artifacts — UNDELIVERED reports and red proofs — never as silence.
 */
import { execFile } from "node:child_process";
import * as path from "node:path";
import { Cut, Delivery, Proof, Space } from "../core/schema";
import { readStamp } from "../core/stamp";
import { assembleWorkOrders, renderWorkOrderBrief } from "./orders";
import { Forge } from "./forge";
import { renderProbeBrief, runWorker, WorkerDeps } from "./worker";

export interface RunDeps {
  repoRoot: string;
  model: string;
  /** Command that runs the repo's test suite, e.g. ["npm", "test"]. */
  suiteCommand: string[];
  forge: Forge;
  worker?: typeof runWorker;
  exec?: (cmd: string, args: string[], cwd: string) => Promise<{ code: number; out: string }>;
  log?: (line: string) => void;
}

export const defaultRunExec = (
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; out: string }> =>
  new Promise((resolve) => {
    execFile(cmd, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({
        code: err && typeof (err as { code?: unknown }).code === "number" ? ((err as { code?: number }).code as number) : err ? 1 : 0,
        out: `${stdout}\n${stderr}`,
      }),
    );
  });

export interface RunOutcome {
  delivery?: Delivery;
  refusals: string[];
  undelivered: string[];
  url?: string;
}

/** Execute one signed cut end to end. */
export async function runCut(
  deps: RunDeps,
  space: Space,
  cut: Cut,
): Promise<RunOutcome> {
  const exec = deps.exec ?? defaultRunExec;
  const worker = deps.worker ?? runWorker;
  const branch = `tandem/${cut.id}`;
  const worktree = path.join(deps.repoRoot, ".tandem-worktrees", cut.id);
  const log = deps.log ?? (() => {});

  log(`run ${cut.id}: creating worktree on ${branch}`);
  await exec("git", ["-C", deps.repoRoot, "worktree", "remove", "--force", worktree], deps.repoRoot).catch(() => {});
  await exec("git", ["-C", deps.repoRoot, "branch", "-D", branch], deps.repoRoot).catch(() => {});
  const wt = await exec("git", ["-C", deps.repoRoot, "worktree", "add", "-b", branch, worktree], deps.repoRoot);
  if (wt.code !== 0)
    return { refusals: [`worktree failed: ${wt.out.trim().slice(0, 300)}`], undelivered: [] };

  const stamp = [await readStamp(worktree)];
  const assembled = assembleWorkOrders(space, cut, worktree, stamp);
  const refusals = assembled.flatMap((a) => (a.ok ? [] : a.refusals));
  if (refusals.length) {
    log(`run ${cut.id}: refused — ${refusals.join("; ")}`);
    return { refusals, undelivered: [] };
  }

  const byId = new Map(space.nodes.map((n) => [n.id, n]));
  const undelivered: string[] = [];
  const probePaths: string[] = [];
  const workerDeps: WorkerDeps = { model: deps.model, worktree, log };

  for (const a of assembled) {
    if (!a.ok) continue;
    const order = a.order;
    const probeDir = `probes/${order.id}`;
    log(`${order.id}: probe author (blind)`);
    const probe = await worker(
      workerDeps,
      renderProbeBrief({
        orderId: order.id,
        contracts: order.contracts,
        checks: order.nodeIds.flatMap((id) => {
          const n = byId.get(id);
          return (n?.checks ?? []).map((c) => ({ nodeSentence: n!.sentence, text: c.text }));
        }),
        probeDir,
      }),
    );
    if (probe.undelivered) undelivered.push(`${order.id} probes: ${probe.undelivered}`);
    else probePaths.push(probeDir);

    log(`${order.id}: builder`);
    const built = await worker(
      workerDeps,
      renderWorkOrderBrief(space, { ...order, probes: [...order.probes, probeDir] }, a.resolved) +
        `\n\nWhen the changes are in place, run the probes under ${probeDir}/ and the repo suite; ` +
        `iterate until they pass or an obligation is honestly UNDELIVERED.`,
    );
    if (built.undelivered) undelivered.push(`${order.id}: ${built.undelivered}`);
  }

  log(`run ${cut.id}: collecting proofs`);
  const proofs: Proof[] = [];
  const suite = await exec(deps.suiteCommand[0], deps.suiteCommand.slice(1), worktree);
  proofs.push({
    kind: "suite",
    label: "repo suite",
    verdict: suite.code === 0 ? "green" : "red",
  });
  for (const p of probePaths) {
    const r = await exec("node", ["--test", p], worktree);
    proofs.push({
      kind: "probe",
      label: p,
      verdict: r.code === 0 ? "green" : "red",
    });
  }

  log(`run ${cut.id}: committing and opening the delivery`);
  await exec("git", ["add", "-A", "."], worktree);
  await exec("git", ["commit", "-m", `tandem: deliver ${cut.id}`], worktree);
  const pushed = await exec("git", ["push", "-u", "origin", branch, "--force"], worktree);
  if (pushed.code !== 0)
    return {
      refusals: [],
      undelivered,
      delivery: {
        id: `delivery-${cut.id}`,
        cutId: cut.id,
        branch,
        proofs: [...proofs, { kind: "ci", label: "push", verdict: "red" }],
      },
    };
  let url: string | undefined;
  try {
    url = await deps.forge.openDelivery({
      branch,
      title: `Tandem delivery: ${cut.id}`,
      body:
        `Delivered by the tandem run for ${cut.id}.\n\n` +
        (undelivered.length
          ? `UNDELIVERED:\n${undelivered.map((u) => `- ${u}`).join("\n")}\n\n`
          : "") +
        `Proofs:\n${proofs.map((p) => `- ${p.label}: ${p.verdict}`).join("\n")}`,
    });
  } catch (err) {
    log(`forge refused the delivery: ${err instanceof Error ? err.message : String(err)}`);
  }
  return {
    refusals: [],
    undelivered,
    url,
    delivery: {
      id: `delivery-${cut.id}`,
      cutId: cut.id,
      branch,
      proofs,
      ...(undelivered.length
        ? {}
        : {}),
    },
  };
}
