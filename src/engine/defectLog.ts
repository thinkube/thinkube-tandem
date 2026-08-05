/**
 * ODC find-time defect capture (TEP-22 mechanical half, minimal v1 — 2026-07-14).
 *
 * Every observation point where the orchestrator CATCHES a defect (a preflight refusal,
 * a red closing-gate AC, a judge verdict, a gate-machinery failure, a worker's declared
 * UNDELIVERED obligation, a stub-scan hit) appends ONE structured JSONL line to the
 * thinking space's `defects/{YYYY-MM}.jsonl`. The analysis half of TEP-22 reads these
 * later; this module only guarantees the find-time facts are captured where they happen.
 *
 * FAIL-SOFT is the contract: a defect-log write error must NEVER affect the run that is
 * doing the finding — {@link appendDefect} swallows every error and reports success as a
 * boolean nobody is required to read.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** One find-time defect observation (ODC-style axes, loosely held in v1). */
export interface DefectEntry {
  /** ISO timestamp — filled by {@link appendDefect} when absent. */
  ts?: string;
  /** The Spec id (`<tep>/<sp>`) the observation belongs to. */
  spec: string;
  /** The slice handle, when the observation is slice-scoped. */
  slice?: string;
  /** The execution-unit id, when unit-scoped. */
  unit?: string;
  /** The activity being performed when the defect surfaced (ODC "activity"). */
  activity: string;
  /** What surfaced it (ODC "trigger"): e.g. `preflight`, `gate-verifier`,
   *  `gate-infra`, `worker flag`, `post-hoc diagnosis`. */
  trigger: string;
  /** ODC defect type, when known (e.g. the judge's fault: code/test/contract/gate). */
  type?: string;
  /** ODC qualifier (missing / incorrect / extraneous), when known. */
  qualifier?: string;
  /** The cost class: e.g. `prevented` (caught before damage), `round lost`. */
  impact: string;
  /** Free-text detail — the evidence, clipped by the caller. */
  detail: string;
  /** Related identifiers (AC ordinals, file:line refs, …). */
  refs?: string[];
}

/** The month-keyed defect-log path under a thinking space dir. */
export function defectLogPath(thinkubeDir: string, when: Date): string {
  const ym = `${when.getUTCFullYear()}-${String(when.getUTCMonth() + 1).padStart(2, "0")}`;
  return path.join(thinkubeDir, "defects", `${ym}.jsonl`);
}

/**
 * Append one defect entry as a single JSONL line to
 * `<thinkubeDir>/defects/{YYYY-MM}.jsonl`, creating the directory on demand.
 * Fills `ts` when absent. Returns true when the line landed, false on ANY error —
 * and never throws: capture must never cost the run that is doing the finding.
 */
export function appendDefect(thinkubeDir: string, entry: DefectEntry): boolean {
  try {
    if (!thinkubeDir || typeof thinkubeDir !== "string") return false;
    const now = new Date();
    const full: DefectEntry = { ts: entry.ts ?? now.toISOString(), ...entry };
    // Keep `ts` first for human-scannable lines; JSON key order is cosmetic only.
    if (!full.ts) full.ts = now.toISOString();
    const file = defectLogPath(thinkubeDir, now);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(full)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}
