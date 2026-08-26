/**
 * The delivery record's checks: where each criterion's proof lives.
 *
 * A check is discarded from the tree when a delivery opens; the record is
 * where it goes on living, and where a later run finds it again. Identity
 * is the CRITERION — an address is only where one plan happened to put it.
 */
import { readFileSync } from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type { KeptCheck } from "./deliveryRecord";

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

/** Criterion → the address its check was recorded at, from the delivery record. */
export function recordedCheckHomes(storeDir: string, tep: string): Map<string, string> {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(storeDir, "deliveries", `${tep}.json`), "utf8"),
    ) as { checks?: { criterionId?: string; path?: string }[] };
    return new Map(
      (parsed.checks ?? [])
        .filter((c): c is { criterionId: string; path: string } => !!c.criterionId && !!c.path)
        .map((c) => [c.criterionId, c.path]),
    );
  } catch {
    return new Map();
  }
}

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
