// Verifiability audit runner (SP-6/1, TEP-6) — the server-side auditor `write_spec` runs itself.
//
// `write_spec` no longer trusts an agent-supplied `ac_verifications` map: it runs the adversarial
// verifiability audit (the same pass the `/spec-prepare` skill does at step 7) **inside the server**
// and signs only what its own audit produced. This module is that runner — a **stub-injectable**
// seam:
//
//   - The real runner (`createSdkAuditRunner`) spawns a **headless Claude** by reusing the
//     orchestrator's `query()` spawn path (`OrchestratorService.runViaSdk`): the SDK is lazy-imported
//     so it never loads at activation, the session is read-only (the audit only reads the ACs we hand
//     it), and the message-shape helpers (`sessionIdOf` / `summarizeEvent` / `isResultSuccess`) are
//     reused from `orchestratorCore` rather than forked.
//   - The `AuditRunner` *type* is the injection point. `write_spec` takes a runner; tests pass a
//     stub (`fixedAuditRunner`) so the handler's enforcement — *honor the verdict, sign on pass,
//     refuse otherwise* — is unit-testable in `env: local` with no live model call (Spec constraint).
//     The live headless-Claude pass is a separate, non-gating integration concern.
//
// The runner *returns per-AC verdicts*; it does not sign and does not gate. `write_spec` decides
// pass/fail (and signs on pass) from these verdicts, and the pure `readyGate` verifies the signature
// downstream — this module stays model-side and authority-free.

import type { AcVerdict, AcVerdictKind } from "./openingGate";
// Reuse, don't fork (SP-th1ddy): the same stream-json message-shape readers the orchestrator's
// spawn path uses, so the audit session is summarized and its session id / success read identically.
import {
  isResultSuccess,
  sessionIdOf,
  summarizeEvent,
} from "./orchestratorCore";

/** One acceptance criterion as the auditor interrogates it: its 1-based ordinal and prose. */
export interface AuditAc {
  /** 1-based AC ordinal (document order). */
  ordinal: number;
  /** The acceptance-criterion text the auditor judges `verifiable | needs-reframe`. */
  text: string;
}

/** What the runner is asked to audit: the AC list, optional surrounding Spec body, and the cwd the
 *  headless session runs in (a worktree of the code repo — the auditor may read it for context). */
export interface AuditRequest {
  acs: AuditAc[];
  /** The full Spec body, for context (Design / Constraints inform what "verifiable" means here). */
  specBody?: string;
  /** Working directory for the headless session. Required for the real runner; stubs ignore it. */
  cwd: string;
}

/**
 * The runner's result: the per-AC verdicts plus a convenience `passed` flag and provenance.
 *
 *   - `verdicts` — one {@link AcVerdict} per AC the auditor reached (the map `write_spec` signs
 *     when it passes, via `emitAcVerifications`). Authority for pass/fail still rests with
 *     `write_spec` (`passed` is a derived convenience, not the gate).
 *   - `passed` — every requested AC ordinal got a `verifiable` verdict (see {@link computePassed}).
 *   - `sessionId` — the headless audit's SDK session id (trace / float-out); undefined for stubs
 *     and failed spawns.
 *   - `error` — set iff the audit could not run or produced nothing parseable. `write_spec` must
 *     treat an errored audit as a refusal (never sign), distinct from a clean `passed: false`.
 */
export interface AuditResult {
  verdicts: AcVerdict[];
  passed: boolean;
  sessionId?: string;
  error?: string;
}

/**
 * The injection seam. `write_spec` depends on this type, not on the SDK: production wires
 * {@link createSdkAuditRunner}; tests wire {@link fixedAuditRunner}. The handler's enforcement is
 * tested against the stub; the live model run is integration-only.
 */
export type AuditRunner = (req: AuditRequest) => Promise<AuditResult>;

// ── pass derivation ──────────────────────────────────────────────────────────

/**
 * True iff **every** requested AC ordinal got a `verifiable` verdict (with a runnable `run`). A
 * `needs-reframe` verdict, a missing verdict, or a `verifiable` verdict with no command all fail
 * the audit — mirroring `readyGate`'s structural rule so a passing audit's emitted map is
 * Ready-eligible by construction. An empty AC set fails (nothing to certify).
 */
export function computePassed(acs: AuditAc[], verdicts: AcVerdict[]): boolean {
  if (!acs.length) return false;
  const byOrdinal = new Map<number, AcVerdict>();
  for (const v of verdicts) byOrdinal.set(v.ordinal, v);
  for (const ac of acs) {
    const v = byOrdinal.get(ac.ordinal);
    if (!v || v.verdict !== "verifiable") return false;
    if (typeof v.run !== "string" || !v.run.trim()) return false;
  }
  return true;
}

// ── prompt ─────────────────────────────────────────────────────────────────-

/**
 * Build the adversarial verifiability-audit prompt — the same judgment the `/spec-prepare` skill
 * runs at step 7, framed for a headless one-shot session that must answer in machine-readable JSON.
 * The auditor flags an AC `needs-reframe` when its verifying actor is a human (no AI evidence is
 * producible) or its check is deploy/merge-circular (it can't be checked before the gate it arms);
 * otherwise `verifiable` with the concrete proof command.
 */
export function buildAuditPrompt(acs: AuditAc[], specBody?: string): string {
  const acBlock = acs
    .map((ac) => `${ac.ordinal}. ${ac.text.trim()}`)
    .join("\n");
  const context = specBody?.trim()
    ? `\n\nFor context, the full Spec body:\n\n<spec>\n${specBody.trim()}\n</spec>`
    : "";
  return [
    "You are an adversarial verifiability auditor for a software Spec's Acceptance Criteria.",
    "For EACH acceptance criterion below, decide whether an AI agent could prove it with a",
    "concrete, runnable command BEFORE any merge/deploy, producing evidence a verifier (not a",
    "human) reads. Flag a criterion `needs-reframe` when:",
    "  - its verifying actor is a human (it says a person looks/checks/confirms by eye), or",
    "  - its verification is deploy/merge-circular (it can only be checked after the very",
    "    merge or deploy that the gate it arms gates).",
    "Otherwise call it `verifiable` and give the single command (`run`) that proves it, and",
    'where it runs (`env`: "local" or "cluster").',
    "",
    "Acceptance Criteria:",
    acBlock,
    context,
    "",
    "Respond with ONLY a JSON array (no prose, no markdown fence needed) of one object per",
    "criterion, in ordinal order:",
    '  [{"ordinal":1,"verdict":"verifiable","run":"npm test","env":"local"},',
    '   {"ordinal":2,"verdict":"needs-reframe","why":"a human confirms by eye"}]',
    "Include `run` (and optionally `env`) only for `verifiable`; include `why` for `needs-reframe`.",
  ].join("\n");
}

// ── verdict parsing ──────────────────────────────────────────────────────────

const VERDICT_KINDS = new Set<AcVerdictKind>(["verifiable", "needs-reframe"]);

/**
 * Parse the auditor's reply into {@link AcVerdict}s. Tolerant of a surrounding ```json fence or
 * stray prose: it extracts the last top-level `[ ... ]` array and validates each entry. An entry
 * with an unrecognized/absent `verdict` is coerced to `needs-reframe` (conservative — a malformed
 * verdict must never silently pass the audit). Non-object entries and non-positive-integer ordinals
 * are dropped. Returns `[]` when nothing parseable is found (the runner then reports an error).
 */
export function parseAuditVerdicts(text: string): AcVerdict[] {
  const arr = extractJsonArray(text);
  if (!Array.isArray(arr)) return [];
  const out: AcVerdict[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const ordinal = rec.ordinal;
    if (
      typeof ordinal !== "number" ||
      !Number.isInteger(ordinal) ||
      ordinal <= 0
    )
      continue;
    const kind =
      typeof rec.verdict === "string" &&
      VERDICT_KINDS.has(rec.verdict as AcVerdictKind)
        ? (rec.verdict as AcVerdictKind)
        : "needs-reframe";
    const verdict: AcVerdict = { ordinal, verdict: kind };
    if (kind === "verifiable") {
      if (typeof rec.run === "string" && rec.run.trim())
        verdict.run = rec.run.trim();
      if (rec.env === "cluster" || rec.env === "local") verdict.env = rec.env;
    } else if (typeof rec.why === "string" && rec.why.trim()) {
      verdict.why = rec.why.trim();
    }
    out.push(verdict);
  }
  return out;
}

/** Extract the last top-level JSON array from arbitrary text (handles a ```json fence or prose
 *  around it). Returns the parsed value, or `null` when no array parses. */
function extractJsonArray(text: string): unknown {
  if (!text) return null;
  // Scan from the last `[` outward so a fenced/last array wins over an example earlier in prose.
  const starts: number[] = [];
  for (let i = 0; i < text.length; i++) if (text[i] === "[") starts.push(i);
  for (let s = starts.length - 1; s >= 0; s--) {
    const start = starts[s];
    const end = text.lastIndexOf("]");
    for (let e = end; e > start; e--) {
      if (text[e] !== "]") continue;
      try {
        const v = JSON.parse(text.slice(start, e + 1));
        if (Array.isArray(v)) return v;
      } catch {
        /* try a shorter close */
      }
    }
  }
  return null;
}

// ── the real (headless-Claude) runner ────────────────────────────────────────

/** Minimal structural type of the Agent SDK `query()` we depend on — kept loose so the lazy import
 *  doesn't pull SDK types into the module graph. */
type SdkQuery = (args: {
  prompt: string;
  options: { cwd: string; permissionMode: "bypassPermissions" };
}) => AsyncIterable<unknown>;

/** Deps for the real runner — both injectable so the spawn path is testable without a live model. */
export interface SdkAuditDeps {
  /** Progress sink (mirrors the orchestrator's `output.appendLine`). Defaults to a no-op. */
  log?: (line: string) => void;
  /** Loads the SDK `query`. Defaults to a lazy `import("@anthropic-ai/claude-agent-sdk")` — the
   *  same lazy-import the orchestrator uses, so the SDK never loads at activation. */
  loadQuery?: () => Promise<SdkQuery>;
}

/**
 * The production {@link AuditRunner}: spawn a headless Claude verifiability audit reusing the
 * orchestrator's `query()` spawn path, and return the parsed per-AC verdicts. Read-only (the audit
 * only needs the ACs we put in the prompt), lazy-imported, and failure-tolerant — a load/run error,
 * a non-success result, or an unparseable reply all degrade to an `error` result (never a thrown
 * crash, never a spurious pass).
 */
export function createSdkAuditRunner(deps: SdkAuditDeps = {}): AuditRunner {
  const log = deps.log ?? (() => {});
  const loadQuery =
    deps.loadQuery ??
    (async () =>
      (await import("@anthropic-ai/claude-agent-sdk")).query as SdkQuery);

  return async (req: AuditRequest): Promise<AuditResult> => {
    if (!req.acs.length)
      return {
        verdicts: [],
        passed: false,
        error: "no acceptance criteria to audit",
      };

    const prompt = buildAuditPrompt(req.acs, req.specBody);
    let sessionId: string | undefined;
    let resultText = "";
    let assistantText = "";
    let sawSuccess = false;

    try {
      const query = await loadQuery();
      for await (const msg of query({
        prompt,
        options: { cwd: req.cwd, permissionMode: "bypassPermissions" },
      })) {
        const rec = msg as Record<string, unknown>;
        sessionId = sessionId ?? sessionIdOf(rec);
        const line = summarizeEvent(rec);
        if (line) log(`  [audit] ${line}`);
        if (rec.type === "assistant")
          assistantText += collectAssistantText(rec);
        if (rec.type === "result") {
          if (typeof rec.result === "string") resultText = rec.result;
          sawSuccess = isResultSuccess(rec);
        }
      }
    } catch (err) {
      return {
        verdicts: [],
        passed: false,
        sessionId,
        error: `audit spawn failed: ${(err as Error).message}`,
      };
    }

    if (!sawSuccess)
      return {
        verdicts: [],
        passed: false,
        sessionId,
        error: "audit session did not complete successfully",
      };

    const verdicts = parseAuditVerdicts(resultText || assistantText);
    if (!verdicts.length)
      return {
        verdicts: [],
        passed: false,
        sessionId,
        error: "audit produced no parseable verdicts",
      };

    return { verdicts, passed: computePassed(req.acs, verdicts), sessionId };
  };
}

/** Concatenate the text blocks of an `assistant` stream-json event (a JSON-array fallback when the
 *  SDK `result` field is absent). */
function collectAssistantText(rec: Record<string, unknown>): string {
  const msg = rec.message as { content?: unknown } | undefined;
  const content = Array.isArray(msg?.content) ? msg!.content : [];
  let out = "";
  for (const b of content as Array<Record<string, unknown>>) {
    if (b.type === "text" && typeof b.text === "string") out += b.text;
  }
  return out;
}

// ── the test stub ────────────────────────────────────────────────────────────

/**
 * A fixed-verdict {@link AuditRunner} for tests (and the `env: local` enforcement path): it ignores
 * the request and returns the given verdicts, deriving `passed` from them against the request's ACs
 * (or honoring an explicit override). This is the seam that lets `write_spec`'s *honor the verdict,
 * sign on pass, refuse otherwise* invariant be unit-tested with no model call.
 */
export function fixedAuditRunner(
  verdicts: AcVerdict[],
  overrides: { passed?: boolean; sessionId?: string; error?: string } = {},
): AuditRunner {
  return async (req: AuditRequest): Promise<AuditResult> => ({
    verdicts,
    passed: overrides.passed ?? computePassed(req.acs, verdicts),
    ...(overrides.sessionId !== undefined
      ? { sessionId: overrides.sessionId }
      : {}),
    ...(overrides.error !== undefined ? { error: overrides.error } : {}),
  });
}
