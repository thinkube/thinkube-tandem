/**
 * The delivery's persisted record: the engine's structured verification
 * trace plus the run facts, written beside the space, and the checks a
 * delivery consumed — kept here because their files leave the tree, and
 * restored from here when a later run needs them back.
 */
import * as path from "node:path";
import { readFileSync } from "node:fs";
import * as fsp from "node:fs/promises";
import type { AcVerification } from "../engine/orchestratorCore";
import { buildVerificationTrace } from "../engine/core/trace";
import type { Proof } from "../core/schema";

/**
 * The delivery's MACHINE FACE persists beside the space: the engine's
 * structured verification trace plus the run facts — the delivery page is
 * a render, this file is the evidence record. Best-effort: the run's
 * verdicts already live on the delivery.
 */
export async function writeDeliveryRecord(
  storeDir: string,
  record: {
    tep: string;
    branch: string;
    baseSha: string;
    proofs: Proof[];
    undelivered: string[];
    verifs: AcVerification[];
    acResults: Parameters<typeof buildVerificationTrace>[0]["acResults"];
    /** The run that produced this record, and when — the same id and
     *  stamp the gate put on the delivery it handed back. Optional only
     *  for a caller that predates the field; the gate always supplies it. */
    runId?: string;
    producedAt?: string;
    /** The checks themselves — kept here because the files are discarded.
     *  Passed only by an OPENED delivery: a withheld run once overwrote a
     *  good record's fifty-eight sources with thirty-eight entries at the
     *  wrong addresses, and the next run could restore nothing. Absent, the
     *  record's existing checks are preserved. */
    checks?: KeptCheck[];
    /** Attention events about the machine in this run. Target: zero. */
    machineAttention?: number;
    /** What only the person can certify, on the delivery's face. */
    observations?: string[];
  },
): Promise<void> {
  try {
    const trace = buildVerificationTrace({
      round: 1,
      declared: record.verifs,
      acResults: record.acResults,
    });
    const dir = path.join(storeDir, "deliveries");
    await fsp.mkdir(dir, { recursive: true });
    // What an opened delivery captured outlives every later failed run.
    const checks =
      record.checks?.length
        ? record.checks
        : (() => {
            try {
              return (JSON.parse(readFileSync(path.join(dir, `${record.tep}.json`), "utf8")) as { checks?: KeptCheck[] })
                .checks ?? [];
            } catch {
              return [];
            }
          })();
    await fsp.writeFile(
      path.join(dir, `${record.tep}.json`),
      JSON.stringify(
        {
          tep: record.tep,
          branch: record.branch,
          baseSha: record.baseSha,
          proofs: record.proofs,
          undelivered: record.undelivered,
          ...(record.runId ? { runId: record.runId } : {}),
          ...(record.producedAt ? { producedAt: record.producedAt } : {}),
          trace,
          ...(checks.length ? { checks } : {}),
          machineAttention: record.machineAttention ?? 0,
          ...(record.observations?.length ? { observations: record.observations } : {}),
        },
        null,
        2,
      ),
    );
  } catch {
    /* best-effort */
  }
}

/** The check paths a cut's delivery record holds, or nothing. */
export function recordedCheckPaths(storeDir: string, tep: string): string[] {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(storeDir, "deliveries", `${tep}.json`), "utf8"),
    ) as { checks?: { path?: string }[] };
    return (parsed.checks ?? []).map((c) => c.path).filter((x): x is string => !!x);
  } catch {
    return [];
  }
}

/**
 * Put a delivery's recorded checks back into a tree.
 *
 * A delivery consumes its checks — the sources live on the record, the
 * files leave the tree. A run of the same cut after that (the person ran
 * it again, or the acceptance loop proves it three times) finds standing
 * testers and no check files, which once turned a fully-delivered cut into
 * sixty-four file-not-found reds. What the record kept is written back,
 * and only where nothing else has since claimed the path.
 */
export async function restoreChecksFromRecord(
  storeDir: string,
  tep: string,
  worktree: string,
  wanted: readonly string[],
): Promise<string[]> {
  let checks: KeptCheck[];
  try {
    const raw = await fsp.readFile(path.join(storeDir, "deliveries", `${tep}.json`), "utf8");
    checks = (JSON.parse(raw) as { checks?: KeptCheck[] }).checks ?? [];
  } catch {
    return [];
  }
  const restored: string[] = [];
  for (const rel of wanted) {
    const kept = checks.find((c) => c.path === rel);
    if (!kept) continue;
    const dst = path.join(worktree, rel);
    if (await fsp.access(dst).then(() => true, () => false)) continue;
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.writeFile(dst, kept.source);
    restored.push(rel);
  }
  return restored;
}

export interface KeptCheck {
  criterionId: string;
  /** Where the check lived while the run drove it. */
  path: string;
  source: string;
}

/**
 * Read the run's checks out of the tree so the delivery can carry them.
 *
 * A check that cannot be read is dropped rather than recorded empty: an
 * empty source on the record would read as "this criterion was proven by
 * nothing", which is worse than its absence.
 */
export async function keptChecks(
  probes: readonly string[],
  worktree: string,
  criterionByProbe: ReadonlyMap<string, string>,
): Promise<KeptCheck[]> {
  const out: KeptCheck[] = [];
  for (const rel of [...new Set(probes)]) {
    const criterionId = criterionByProbe.get(rel);
    if (!criterionId) continue;
    const source = await fsp.readFile(path.join(worktree, rel), "utf8").catch(() => undefined);
    if (source !== undefined) out.push({ criterionId, path: rel, source });
  }
  return out;
}
