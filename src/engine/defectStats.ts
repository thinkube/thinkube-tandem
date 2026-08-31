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
