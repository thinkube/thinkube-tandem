/**
 * OracleStore — durable persistence for held-out acceptance probes (2026-07-14).
 *
 * `role: test` units author their probes as UNTRACKED files in the Spec's detached
 * TESTER worktree — deliberately never committed, so pre-Done blinding keeps probe
 * content off the spec branch and out of the code workers' view. But `createTester`
 * re-snapshots that worktree on every run (`reset --hard` + `clean -fd`), which
 * deletes untracked files. Without this store, a rework re-run wiped the probes
 * while `units_done` still recorded their test units as done — the closing gate /
 * verify oracle then ENOENT'd copying probe files that no longer existed anywhere.
 *
 * The store is a plain directory OUTSIDE every worktree and branch (blinding intact):
 *
 *   <worktreesRoot>/oracle-store/<specWtName>/meta.json        — { acHash }
 *   <worktreesRoot>/oracle-store/<specWtName>/files/<rel...>   — probe bytes
 *
 * Lifecycle: probes are persisted when their test unit checkpoints (BEFORE the
 * durable `units_done` flag is written — a unit is only "done" once its output is),
 * restored into the tester right after each re-snapshot, and invalidated when the
 * Spec's `ac_verifications_hash` changes (a re-signed contract voids the old oracle)
 * or a `last_fault: test` rework implicates the unit (its re-author starts clean).
 * The signature itself covers only the AC prose + run commands, never probe bytes —
 * this store is the persistence the signing scheme deliberately does not provide.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { specWtName, worktreesRoot } from "./WorktreeService";

const META = "meta.json";
const FILES = "files";

interface StoreMeta {
  /** The Spec's `ac_verifications_hash` the probes were authored against
   *  (null when the spec was unsigned at persist time). */
  acHash: string | null;
}

/** The Spec's oracle-store directory under the repo's worktrees root. */
export function oracleStoreDir(
  canonicalRepo: string,
  specNumber: string,
  baseDir?: string,
): string {
  return path.join(
    worktreesRoot(canonicalRepo, baseDir),
    "oracle-store",
    specWtName(specNumber),
  );
}

async function readMeta(storeDir: string): Promise<StoreMeta | undefined> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(storeDir, META), "utf8"),
    ) as StoreMeta;
  } catch {
    return undefined; // absent / unreadable store — treated as "no meta"
  }
}

/** Hashes match when either side declares none — an unsigned spec (or probes
 *  persisted before it was signed) stays usable rather than looping re-authors. */
function hashOk(meta: StoreMeta | undefined, acHash?: string): boolean {
  return !meta?.acHash || !acHash || meta.acHash === acHash;
}

/**
 * Persist a test unit's probe files from its authoring root (the tester worktree).
 * THROWS when a declared probe file is missing — the caller must then NOT record
 * the unit in `units_done` (a durable done-flag with no persisted probe is exactly
 * the lie this store exists to remove). A changed `acHash` wipes the previous
 * (stale-contract) content before the new probes land.
 */
export async function persistProbes(
  storeDir: string,
  fromRoot: string,
  files: string[],
  acHash?: string,
): Promise<void> {
  const meta = await readMeta(storeDir);
  if (meta && !hashOk(meta, acHash))
    await fs.rm(path.join(storeDir, FILES), { recursive: true, force: true });
  await fs.mkdir(path.join(storeDir, FILES), { recursive: true });
  for (const rel of files) {
    const dst = path.join(storeDir, FILES, rel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(path.join(fromRoot, rel), dst); // a missing source MUST propagate
  }
  const nextMeta: StoreMeta = { acHash: acHash ?? null };
  await fs.writeFile(
    path.join(storeDir, META),
    JSON.stringify(nextMeta, null, 2),
  );
}

/** Depth-first listing of every file under `root`, as `/`-relative paths. */
async function walk(root: string, rel = ""): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
  } catch {
    return []; // absent files dir — nothing persisted
  }
  const out: string[] = [];
  for (const e of entries) {
    const r = rel ? path.join(rel, e.name) : e.name;
    if (e.isDirectory()) out.push(...(await walk(root, r)));
    else out.push(r);
  }
  return out;
}

/**
 * Restore persisted probes into `toRoot` (the freshly re-snapshotted tester).
 * Returns the relative paths actually restored; empty when the store is absent
 * or its contract hash no longer matches (stale probes stay out of the tester).
 *
 * Committed-wins (2026-07-14): a probe that already exists in the fresh snapshot
 * is COMMITTED on the branch — newer truth than the store (an /attend or
 * auto-attend fix lands on the branch, not in the store). Restoring over it
 * would shadow the fix with a stale copy — the exact clobber that kept
 * TEP-21_SP-1_SL-3 red while its fix sat committed. The store fills in only
 * what the reset wiped: the uncommitted probes.
 */
export async function restoreProbes(
  storeDir: string,
  toRoot: string,
  acHash?: string,
): Promise<string[]> {
  const meta = await readMeta(storeDir);
  if (!hashOk(meta, acHash)) return [];
  const filesRoot = path.join(storeDir, FILES);
  const restored: string[] = [];
  for (const rel of await walk(filesRoot)) {
    const dst = path.join(toRoot, rel);
    try {
      await fs.access(dst);
      continue; // committed on the branch — the snapshot's copy wins
    } catch {
      /* absent — the reset wiped it; restore from the store */
    }
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(path.join(filesRoot, rel), dst);
    restored.push(rel);
  }
  return restored;
}

/**
 * True iff EVERY given probe file is persisted AND the stored contract hash still
 * matches. An empty `files` list is vacuously present (nothing to persist means
 * nothing can be lost — treating it as absent would re-author such a unit forever).
 */
export async function probesPresent(
  storeDir: string,
  files: string[],
  acHash?: string,
): Promise<boolean> {
  if (files.length === 0) return true;
  const meta = await readMeta(storeDir);
  if (!hashOk(meta, acHash)) return false;
  for (const rel of files) {
    try {
      await fs.access(path.join(storeDir, FILES, rel));
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Drop specific persisted probes — an implicated (`last_fault: test`) unit
 * re-authors against a clean oracle. Best-effort: a missing entry is a no-op and
 * unexpected fs errors never break the caller's scheduling pass.
 */
export async function removeProbes(
  storeDir: string,
  files: string[],
): Promise<void> {
  for (const rel of files) {
    try {
      await fs.rm(path.join(storeDir, FILES, rel), { force: true });
    } catch {
      /* best-effort — worst case the stale probe is overwritten by the re-author */
    }
  }
}
