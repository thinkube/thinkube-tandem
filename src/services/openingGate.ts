// Opening AC-verifiability gate (SP-th1jtj / TEP-tgzx3p, the opening half — the closing half
// shipped in SP-tgzyfy). Pure, model-free core: the structural → Ready gate plus the helper
// that emits the per-AC `ac_verifications` map the closing gate consumes.
//
// Split of responsibility (see the Spec's constraints):
//   - The LLM auditor's `verifiable | needs-reframe` *judgment* runs inside `/spec-prepare`; a
//     `needs-reframe` AC simply gets no declaration.
//   - This module is the *structural* gate the server can run with no model: it enforces that
//     every AC ordinal 1..N carries a runnable `ac_verifications` entry. A missing/empty entry
//     (the footprint of a needs-reframe or undeclared AC) → blocked, naming the first ordinal.
//
// `emitAcVerifications` mirrors `kanbanMcpServer.ts`'s `normalizeAcVerifications` so the emitted
// map round-trips through the shipped closing gate's `parseAcVerifications`
// (`orchestratorCore.ts`) by construction — every AC present, no orphans.

// Import-only reuse of the closing gate's declaration shape — one serialization, both ends.
import type { AcVerification } from "./orchestratorCore";

/** The auditor's per-AC certification (the model-side judgment from `/spec-prepare`). */
export type AcVerdictKind = "verifiable" | "needs-reframe";

/**
 * One AC's audit verdict. A `verifiable` verdict carries the concrete `{ run, env }` declaration;
 * a `needs-reframe` verdict carries `why` and no runnable command (so the structural gate blocks
 * it until it is reworked).
 */
export interface AcVerdict {
  /** 1-based AC ordinal this verdict covers. */
  ordinal: number;
  /** The auditor's call. */
  verdict: AcVerdictKind;
  /** The command that proves the AC — present (non-empty) only for `verifiable`. */
  run?: string;
  /** Where it runs — informational, mirrors `AcVerification.env`. */
  env?: "cluster" | "local";
  /** Why it can't be verified as written — present for `needs-reframe`. */
  why?: string;
}

/** The canonical `ac_verifications` frontmatter shape (AC ordinal → declaration). */
export type AcVerificationMap = Record<
  string,
  { run: string; env?: "cluster" | "local" }
>;

/**
 * `readyGate` result: Ready-eligible (`ok: true`) or blocked, naming the *first* offending AC
 * ordinal (`ok: false`). The shell turns a block into the refused → Ready transition that names
 * the AC.
 */
export type ReadyGateResult = { ok: true } | { ok: false; ordinal: number };

/** True iff `decl` is a usable declaration — an object with a non-empty `run` string. */
function hasRunnableEntry(decl: unknown): decl is { run: string } {
  if (!decl || typeof decl !== "object") return false;
  const run = (decl as Record<string, unknown>).run;
  return typeof run === "string" && run.trim().length > 0;
}

/**
 * The structural → Ready gate (pure, model-free). Returns Ready-eligible **iff** every AC ordinal
 * carries a runnable `ac_verifications` entry; the first AC missing a declaration (or whose
 * declaration has no non-empty `run`) → `{ ok: false, ordinal }`. With no ACs the gate cannot
 * certify anything, so it blocks (there is nothing to be Ready *for*) — the bare AC-presence
 * check it replaces already refused an empty AC set.
 *
 * Ordinals are taken from `acs` (1-based, in document order) rather than assumed contiguous, so a
 * malformed AC list is judged by what it actually declares.
 */
export function readyGate(
  acs: { ordinal: number }[],
  verifications: Record<string, { run: string; env?: "cluster" | "local" }>,
): ReadyGateResult {
  if (!acs.length) return { ok: false, ordinal: 1 };
  const ordered = [...acs].sort((a, b) => a.ordinal - b.ordinal);
  for (const ac of ordered) {
    if (!hasRunnableEntry(verifications?.[String(ac.ordinal)])) {
      return { ok: false, ordinal: ac.ordinal };
    }
  }
  return { ok: true };
}

/**
 * Map-emission helper: turn the auditor's verdicts into the canonical `ac_verifications` map the
 * Spec frontmatter carries. Only `verifiable` verdicts with a non-empty `run` and a positive
 * integer ordinal contribute an entry; `needs-reframe` verdicts emit nothing (so the gate blocks
 * them). Keys are sorted by ordinal for a stable, low-diff write. Mirrors
 * `kanbanMcpServer.ts`'s `normalizeAcVerifications` so the result round-trips through
 * `parseAcVerifications` — every emitted AC present, no orphans.
 */
export function emitAcVerifications(verdicts: AcVerdict[]): AcVerificationMap {
  const entries: [number, { run: string; env?: "cluster" | "local" }][] = [];
  for (const v of verdicts) {
    if (v.verdict !== "verifiable") continue;
    if (!Number.isInteger(v.ordinal) || v.ordinal <= 0) continue;
    if (typeof v.run !== "string" || !v.run.trim()) continue;
    entries.push([
      v.ordinal,
      {
        run: v.run.trim(),
        ...(v.env === "cluster" || v.env === "local" ? { env: v.env } : {}),
      },
    ]);
  }
  entries.sort((a, b) => a[0] - b[0]);
  const out: AcVerificationMap = {};
  for (const [ordinal, decl] of entries) out[String(ordinal)] = decl;
  return out;
}

/** Re-export the closing gate's declaration type for callers wiring both ends. */
export type { AcVerification };
