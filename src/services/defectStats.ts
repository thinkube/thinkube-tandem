/**
 * defectStats — pure aggregation over the thinking space's JSONL defect log (TEP-22/SP-1).
 *
 * No vscode import; no side effects; all functions are pure transforms over
 * in-memory data. Consumers call {@link parseDefectLog} to materialise rows
 * from on-disk text, then pass the result to the three view functions.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * One defect row as stored in the JSONL log (v1 schema, read-side).
 *
 * `ts` is always stamped by {@link appendDefect} at write time, so it is
 * always present on disk; the parser treats it as required.
 * `spec` is optional on the read side because manual rows carry the literal
 * `"manual"` and very early hand-crafted rows may omit it entirely.
 */
export interface DefectRow {
  ts: string;
  spec?: string;
  slice?: string;
  unit?: string;
  activity: string;
  trigger: string;
  type?: string;
  qualifier?: string;
  impact: string;
  detail: string;
  refs?: string[];
}

// ── Canonical trigger ranking ─────────────────────────────────────────────────

/**
 * Canonical catch-point ranking, earliest (cheapest) first.
 *
 * Exported so that capture-side code and future consumers (TEP-23) import
 * this single source rather than re-declaring the order independently.
 */
export const TRIGGER_ORDER: readonly string[] = [
  "authoring-time audit",
  "preflight",
  "fence denial / containment",
  "build gate (prepare)",
  "gate-verifier failure",
  "judge contradiction",
  "worker flag (⚑)",
  "human challenge",
  "post-hoc diagnosis",
];

// ── Parse ────────────────────────────────────────────────────────────────────

/**
 * Fail-soft JSONL parse: each line is parsed independently.
 *
 * Empty and whitespace-only lines are silently skipped (not errors).
 * Lines that are not valid JSON, or that are valid JSON but not a non-null
 * non-array object, are counted as parse errors and skipped — never thrown.
 */
export function parseDefectLog(text: string): {
  rows: DefectRow[];
  parseErrors: number;
} {
  const rows: DefectRow[] = [];
  let parseErrors = 0;
  if (!text) return { rows, parseErrors };
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj: unknown = JSON.parse(trimmed);
      if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
        rows.push(obj as DefectRow);
      } else {
        parseErrors++;
      }
    } catch {
      parseErrors++;
    }
  }
  return { rows, parseErrors };
}

// ── Aggregations ─────────────────────────────────────────────────────────────

/**
 * Group defect counts by month (`YYYY-MM` from `ts`) and by type.
 *
 * Rows whose `type` field is absent are omitted from this dimension —
 * type is filled at fix-time (ODC closer) and may be missing on find-time rows.
 */
export function typeByMonth(
  rows: DefectRow[],
): Map<string /* YYYY-MM */, Map<string /* type */, number>> {
  const result = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const type = row.type;
    if (!type) continue;
    const month = row.ts ? row.ts.slice(0, 7) : "unknown";
    let byType = result.get(month);
    if (!byType) {
      byType = new Map<string, number>();
      result.set(month, byType);
    }
    byType.set(type, (byType.get(type) ?? 0) + 1);
  }
  return result;
}

/**
 * Counts by trigger, ordered by {@link TRIGGER_ORDER} (known triggers first,
 * in catch-point order); unknown triggers follow, sorted alphabetically.
 */
export function catchPointCurve(
  rows: DefectRow[],
): Array<{ trigger: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const t = row.trigger;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }

  const known: Array<{ trigger: string; count: number }> = [];
  for (const t of TRIGGER_ORDER) {
    const c = counts.get(t);
    if (c !== undefined) known.push({ trigger: t, count: c });
  }

  const unknownTriggers = [...counts.keys()]
    .filter((t) => !TRIGGER_ORDER.includes(t))
    .sort();
  const unknown = unknownTriggers.map((t) => ({
    trigger: t,
    count: counts.get(t)!,
  }));

  return [...known, ...unknown];
}

/**
 * All rows whose `impact` equals `"integrity"`, sorted newest-first by `ts`.
 *
 * The integrity class — a false green — is the worst defect class and must
 * never be quiet: callers should surface this list loudly when non-empty.
 */
export function integrityList(rows: DefectRow[]): DefectRow[] {
  return rows
    .filter((r) => r.impact === "integrity")
    .sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? ""));
}
