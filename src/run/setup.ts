/**
 * Making a run's trees ready to build and check.
 *
 * A worktree fresh from `git worktree add` is a bare checkout: whatever a
 * developer's clone accumulated — installed dependencies, toolchains — is
 * not there, so a build step that is right for the repository fails on
 * "not installed", every verify reports a build failure that no worker
 * can turn green, and the coder grinds against the environment.
 *
 * So the code worktree is PROVISIONED once, with the command the machine
 * derived from the repository's manifests, and what that command produced
 * is OBSERVED — the ignored entries that appeared — rather than named:
 * nothing here knows any package manager. Those entries are then linked
 * into every verify runner (a runner is a snapshot of the same branch), so
 * one install serves the whole run.
 *
 * Then the setup is PROVED on the untouched tree: if the build step fails
 * before any worker has changed a line, the fault is the environment's,
 * and the run is refused with the output — never dispatched into a wall.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Exec } from "./oracle";

export type BoundedExec = (
  cmd: string,
  cwd: string,
) => Promise<{ code: number | null; output: string }>;

/** Ignored entries at the tree's surface (`!! node_modules/`), collapsed —
 *  never one line per installed file. */
async function ignoredEntries(dir: string, exec: Exec): Promise<Set<string>> {
  const r = await exec("git", ["-C", dir, "status", "--porcelain", "--ignored"], dir);
  return new Set(
    r.out
      .split("\n")
      .filter((l) => l.startsWith("!! "))
      .map((l) => l.slice(3).trim().replace(/\/$/, ""))
      .filter(Boolean),
  );
}

export interface TreeSetup {
  /** What provisioning produced — ignored entries to link into runners. */
  provisioned: string[];
  /** Why the run cannot proceed, when the untouched tree fails its own setup. */
  refusal?: string;
}

const tail = (output: string, n = 400): string => output.trim().split("\n").slice(-6).join("\n").slice(-n);

/** Provision the tree, then prove the build step on it before any worker runs. */
export async function setupRunTree(args: {
  worktree: string;
  provision?: string;
  prepare?: string;
  exec: Exec;
  boundedExec: BoundedExec;
  log: (line: string) => void;
}): Promise<TreeSetup> {
  const provisioned: string[] = [];
  if (args.provision) {
    const before = await ignoredEntries(args.worktree, args.exec);
    args.log(`provisioning the worktree: ${args.provision}`);
    const p = await args.boundedExec(args.provision, args.worktree);
    if (p.code !== 0)
      return {
        provisioned,
        refusal: `the repository's own provisioning step (${args.provision}) fails on an untouched checkout — no worker can build here until it does:\n${tail(p.output)}`,
      };
    const after = await ignoredEntries(args.worktree, args.exec);
    for (const e of after) if (!before.has(e)) provisioned.push(e);
  }
  if (args.prepare) {
    const b = await args.boundedExec(args.prepare, args.worktree);
    if (b.code !== 0)
      return {
        provisioned,
        refusal: `the repository's own build step (${args.prepare}) fails on the untouched tree — every check would report a build failure no worker can fix:\n${tail(b.output)}`,
      };
  }
  return { provisioned };
}

/** Make a runner share the worktree's provisioning: each produced entry is
 *  linked in where the runner lacks it. Idempotent; a snapshot reset keeps
 *  ignored entries, so links survive it. */
export async function linkProvisioned(
  runnerDir: string,
  worktree: string,
  provisioned: readonly string[],
): Promise<void> {
  for (const rel of provisioned) {
    const dst = path.join(runnerDir, rel);
    try {
      await fs.lstat(dst);
      continue;
    } catch {
      /* absent — link it */
    }
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.symlink(path.join(worktree, rel), dst).catch(() => {});
  }
}

/** Build the delivered tree before the closing checks; a failure is spoken,
 *  and the checks still run — against an unbuilt tree, said so. */
export async function prepareAtGate(
  prepare: string | undefined,
  worktree: string,
  boundedExec: BoundedExec,
  log: (line: string) => void,
): Promise<void> {
  if (!prepare) return;
  const prep = await boundedExec(prepare, worktree);
  if (prep.code !== 0)
    log(
      `⚠ the prepare command failed at the gate — checks run against an unbuilt tree: ${prep.output.split("\n").pop()?.slice(0, 160) ?? ""}`,
    );
}
