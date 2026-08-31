import { SchedUnit } from "./dag";
// ── Bounded re-dispatch + escalation (SP-6/6 AC5) ──────────────────────────
//
// The failure→fix loop must not re-queue a slice toward green forever. After a bounded
// number of failed rework attempts on the SAME slice the orchestrator stops re-dispatching
// and escalates: the slice is left `requires-attention` with a durable escalation marker and
// is excluded from the ready frontier, so a human must decide. The decision is pure /
// deterministic (no LLM) — the bound and the escalate-vs-re-dispatch verdict are control-plane,
// per the Spec's constraint that the loop bound must not use a model.

/**
 * Default per-slice bound on failed rework attempts before escalation (SP-6/6 AC5). Counts the
 * number of failed acceptance runs recorded for a slice; once a slice reaches this many, the loop
 * escalates instead of re-dispatching. Overridable per run via {@link SchedulerState.attemptBound}.
 */
export const MAX_REWORK_ATTEMPTS = 2;

/**
 * The durable marker the orchestrator stamps onto an **escalated** slice's `## ⚑ Requires attention`
 * block (SP-6/6 AC5). It is the human-facing, reload-surviving signal that the bounded loop gave up
 * on auto-re-dispatch: a slice carrying it is awaiting a human decision, not a re-queue. Detected by
 * {@link hasEscalationMarker} and stamped by {@link markEscalated}; the test asserts via THIS constant
 * (never a hand-copied string) so the marker and its detector can never silently diverge.
 */
const ESCALATION_MARKER =
  "⛔ ESCALATED — bounded rework attempts exhausted";

/**
 * The durable marker the orchestrator stamps onto a **contract-attributed** escalation (SP-6/9) — a
 * peer to {@link ESCALATION_MARKER} that names the CONTRACT (not a role) as the defect. When the judge
 * triangulates a red slice to `fault: contract` (both hands conform to the contract yet still disagree
 * on a seam the contract never defined), the requires-attention diagnosis leads with THIS marker so the
 * human-facing signal reads "the contract is incomplete" and routes to a contract re-cut — NOT another
 * bounded role-rework guess. Non-empty and contains "CONTRACT" (assert a SUBSTRING, never equality, so
 * the wording can evolve without breaking the detector). Distinct from the exhausted-attempts marker
 * because its cause and its remedy differ: this is a design defect the slicer re-cuts, and no rework
 * attempt is burned reaching it.
 */
const CONTRACT_DEFECT_MARKER =
  "⛔ CONTRACT-DEFECT — the contract is incomplete";

/**
 * Has a slice **crossed its rework bound** (SP-6/6 AC5)? True once the recorded failed-attempt count
 * reaches the bound (default {@link MAX_REWORK_ATTEMPTS}) — at which point {@link readyFrontier} drops
 * every unit the slice owns, so it is no longer auto-re-dispatchable. Fail-safe on junk input: a
 * negative / non-finite count is treated as zero, a non-positive bound falls back to the default.
 * Pure.
 */
export function isEscalated(
  attempts: number,
  bound: number = MAX_REWORK_ATTEMPTS,
): boolean {
  const n = Number.isFinite(attempts) ? Math.max(0, Math.floor(attempts)) : 0;
  const b =
    Number.isFinite(bound) && bound >= 1
      ? Math.floor(bound)
      : MAX_REWORK_ATTEMPTS;
  return n >= b;
}

/**
 * The role a failed acceptance run is attributed to (SP-6/7 AC4): the **code**-author (the
 * implementation diverged from intent), the **test**-author (the held-out probe is itself wrong), or
 * `both` / ambiguous (neither can be singled out → escalate to a human), or — SP-6/9, re-anchored
 * 2026-07-12 — **`contract`**: an INSTRUMENT of the plan (the contract, an acceptance criterion, a
 * unit instruction) misserves the Spec's INTENT as written, so the defect is the plan and the slice
 * routes to the plan-repair lane (amend the instrument against the intent), not another role guess.
 * **`intent`** (2026-07-12): the intent itself is ambiguous or contradictory — the one verdict no
 * machine may resolve; it always escalates to a human. The verdict of {@link JudgeFailure}; routes
 * {@link reDispatchDecision}.
 */
export type Fault = "code" | "test" | "both" | "contract" | "gate" | "intent";

/**
 * An independent judge's verdict on a red acceptance run (SP-6/7 AC4): which role is at fault plus the
 * **rationale** (why), so the routing decision is recordable in the verification trace. The same
 * independent-judgment shape as {@link AcAssessment} — a verdict WITH a rationale.
 */
interface FailureJudgment {
  fault: Fault;
  rationale: string;
}

/**
 * Judge a FAILED acceptance verification (SP-6/7 AC4) — the same independent-judgment primitive as
 * {@link AssessAc}: a fresh session, NEVER the implementing worker, returning a verdict + rationale.
 * Given the failing unit + the failure evidence it decides whether the fault lies in the CODE or the
 * TEST (or both), so {@link reDispatchDecision} can route the re-dispatch to the right role (or
 * escalate on `both`). Injectable so the gate is unit-testable with no live model; the real
 * SDK-session dispatch lives in `OrchestratorService`.
 *
 * SP-6/9: gains an optional 3rd arg — the slice's CONTRACT, the triangulation arbiter. The judge
 * decides each hand's conformance against the contract itself (not by comparing the two hands), which
 * is what lets it return the `contract` fault when both conform yet still disagree on an undefined seam.
 */
type JudgeFailure = (
  unit: Pick<SchedUnit, "id" | "slice" | "role">,
  failure: string,
  contract?: string,
  /** 2026-07-12 — the Spec's INTENT (the body with the AC block stripped): the north star every
   *  artifact is judged against. The ACs/contract/notes are instruments approximating it; when an
   *  instrument misserves the intent as written, the verdict is `contract` (plan repair), and when
   *  the intent itself is ambiguous the verdict is `intent` (human). Optional for compatibility. */
  intent?: string,
) => Promise<FailureJudgment>;

/** One verdict from {@link reDispatchDecision}: whether to send a red slice back for rework or stop. */
interface ReDispatchVerdict {
  /** `re-dispatch` → bump the counter and return the slice to the ready frontier; `escalate` → leave
   *  it `requires-attention` with the {@link ESCALATION_MARKER}, excluded from the frontier (AC5);
   *  `repair` (2026-07-12) → the plan is the defect: route to the plan-repair lane (amend the
   *  instrument against the intent, re-certify, re-grade) — no attempt burned. A shell with no
   *  repair lane wired treats `repair` exactly as the old contract escalation. */
  action: "re-dispatch" | "escalate" | "repair";
  /** The slice's new failed-attempt count (prior + 1), to persist on `state.attempts`. */
  attempts: number;
  /** SP-6/7 AC4: which role the re-dispatch targets — set ONLY when a judged `fault` was supplied.
   *  `code`/`test` route the re-author to that role; `both` forces escalation (ambiguous); SP-6/9
   *  `contract` forces escalation to a contract re-cut (attempts NOT burned); `gate` forces
   *  escalation to gate re-authoring (attempts NOT burned — the probe, not the slice, is broken).
   *  Absent when no fault is given (the pure attempt-bound decision), so the AC5 behaviour is
   *  unchanged. */
  route?: Fault;
  /** Set when the escalation was forced by the identical-evidence circuit breaker: the same AC
   *  failed with the same normalized evidence as the prior attempt, so re-dispatch was refused
   *  ("deterministic failure — inputs unchanged") without burning the remaining attempts. */
  deterministic?: boolean;
}

/**
 * The pure, deterministic re-dispatch decision for a slice that just failed its (independently-graded)
 * acceptance run (SP-6/6 AC5 + SP-6/7 AC4). Given the slice's PRIOR recorded failed-attempt count, the
 * bound (default {@link MAX_REWORK_ATTEMPTS}), and — when the failure was judged — the code-vs-test
 * `fault`, it increments the counter and decides:
 *
 *   • while the new count is below the bound AND the fault is not ambiguous, the slice is
 *     **re-dispatched** for another bounded rework attempt, routed (`route`) to the faulting role —
 *     the code-author for a `code` fault, the test-author for a `test` fault;
 *   • once the count reaches the bound, OR the fault is `both`/ambiguous, the loop **escalates** — the
 *     slice stays `requires-attention` (marked with {@link ESCALATION_MARKER}) and {@link readyFrontier}
 *     stops dispatching it, so a human decides;
 *   • SP-6/9 — a `contract` fault **escalates** too, but to a contract re-cut (marked with
 *     {@link CONTRACT_DEFECT_MARKER}, `route: "contract"`) and WITHOUT burning an attempt: `attempts`
 *     stays === `priorAttempts`, regardless of the prior count or bound, because the slice was never
 *     the problem — the contract is.
 *
 * No model is consulted here — the bound and the route are control-plane, the deterministic analog of
 * "stop retrying after N"; the code-vs-test `fault` is the only model input and it is supplied by the
 * injectable {@link JudgeFailure}, never computed in this pure function.
 */
function reDispatchDecision(
  priorAttempts: number,
  bound: number = MAX_REWORK_ATTEMPTS,
  fault?: Fault,
  /** Identical-failure circuit breaker (2026-07-11): the current red's
   *  normalized evidence hash and the prior attempt's persisted one. When both
   *  are present and equal, a would-be re-dispatch becomes an immediate
   *  escalation (`deterministic: true`) WITHOUT burning the remaining
   *  attempts — re-running unchanged inputs cannot converge.
   *
   *  Route-aware (2026-07-14): `priorFault` is the fault the SAME evidence was
   *  judged as last time. Identical evidence only proves a re-roll of the SAME
   *  role is pointless — when the judge now routes the fault to a DIFFERENT
   *  role, that is a NEW experiment (e.g. code was reworked to no effect
   *  because the probes themselves were broken; a `test` verdict must be
   *  allowed to re-author them, or the known cure is blocked forever). An
   *  unknown prior fault keeps the conservative trip. */
  evidence?: { hash?: string; priorHash?: string; priorFault?: Fault },
): ReDispatchVerdict {
  const prior = Number.isFinite(priorAttempts)
    ? Math.max(0, Math.floor(priorAttempts))
    : 0;
  // SP-6/9 contract arm, re-anchored 2026-07-12: a plan-attributed fault (an instrument — contract /
  // AC / unit note — misserves the intent) routes to the PLAN-REPAIR lane REGARDLESS of the prior
  // count / bound, and does NOT burn a rework attempt: the work was never the problem, the plan was.
  // A shell with no repair lane wired falls back to the old escalate-for-a-human-re-cut behaviour.
  if (fault === "contract") {
    return { action: "repair", attempts: prior, route: "contract" };
  }
  // Intent arm (2026-07-12): the intent itself is ambiguous/contradictory — the ONE verdict no
  // machine may resolve (everything else is an instrument serving it). Always a human, no burn.
  if (fault === "intent") {
    return { action: "escalate", attempts: prior, route: "intent" };
  }
  // Gate arm (2026-07-11): the verification PROBE cannot run — the defect is the
  // gate's own machinery, never the slice. Escalate to gate re-authoring (the
  // shell first retries via the auditor) without burning an attempt.
  if (fault === "gate") {
    return { action: "escalate", attempts: prior, route: "gate" };
  }
  const attempts = prior + 1;
  // Circuit breaker: the same failure, byte-for-normalized-byte, as last time.
  // With unchanged inputs, re-rolling the SAME role is a coin with no new
  // sides — stop at THIS attempt count instead of burning the rest of the
  // bound on the identical experiment. But a fault RE-ROUTED to a different
  // role than the prior attempt's is a new experiment against the same
  // evidence (the other artifact never changed) — let it dispatch.
  if (
    evidence?.hash !== undefined &&
    evidence.priorHash !== undefined &&
    evidence.hash === evidence.priorHash &&
    (evidence.priorFault === undefined || evidence.priorFault === fault)
  ) {
    const verdict: ReDispatchVerdict = {
      action: "escalate",
      attempts,
      deterministic: true,
    };
    if (fault) verdict.route = fault;
    return verdict;
  }
  // Escalate at the bound OR when the fault is ambiguous (both code and test suspect) — AC4.
  const escalate = isEscalated(attempts, bound) || fault === "both";
  const verdict: ReDispatchVerdict = {
    action: escalate ? "escalate" : "re-dispatch",
    attempts,
  };
  if (fault) verdict.route = fault;
  return verdict;
}

/**
 * Does a slice body / diagnosis already carry the {@link ESCALATION_MARKER} (SP-6/6 AC5)? The shell
 * reads this on a reloaded slice to know the bounded loop already gave up, so it never re-seeds the
 * slice into the ready frontier. Pure.
 */
/**
 * The → Done DOCS obligation, enforced on the ORCHESTRATED path (2026-07-14).
 *
 * `move_slice` carries a docs gate, but the orchestrator advances slices by
 * writing `status: done` directly — so every `docs: required` slice sailed to
 * Done with zero documentation (all four TEP-21/SP-1 slices, live). This pure
 * check is the automated path's equivalent: a `docs: required` slice may be
 * stamped done only when its declared doc-module paths (any `docs/`-prefixed
 * path in `files`/`creates`/unit footprints) all EXIST in the landed tree.
 * Returns `undefined` when the obligation is met (or not applicable), else a
 * human-readable diagnosis naming exactly what is missing. Existence — not a
 * diff — is the v1 check: it catches the real failure mode (a worker that
 * never wrote the doc page); a slice editing an existing page vacuously
 * passes, which the per-slice review still covers. Pure: the caller supplies
 * `exists`.
 */
export function unmetDocsObligation(
  fm: {
    docs?: unknown;
    docs_done?: unknown;
    files?: unknown;
    creates?: unknown;
    work_units?: unknown;
  },
  exists: (relPath: string) => boolean,
): string | undefined {
  if (fm.docs !== "required" || fm.docs_done === true) return undefined;
  const paths = new Set<string>();
  const take = (v: unknown) => {
    if (Array.isArray(v))
      for (const p of v)
        if (typeof p === "string" && p.startsWith("docs/")) paths.add(p);
  };
  take(fm.files);
  take(fm.creates);
  if (Array.isArray(fm.work_units))
    for (const u of fm.work_units)
      take((u as { footprint?: unknown })?.footprint);
  if (paths.size === 0)
    return (
      "docs obligation unmet: the slice is `docs: required` but declares no " +
      "doc-module path (no `docs/`-prefixed file in its footprint). Add the " +
      "doc page to the slice's files/footprint, or re-cut it `docs: n/a` " +
      "with a reason."
    );
  const missing = [...paths].filter((p) => !exists(p));
  if (missing.length)
    return (
      `docs obligation unmet: declared doc-module path(s) not present in the ` +
      `landed tree: ${missing.join(", ")}. The documentation must land with ` +
      `the slice before it can reach Done.`
    );
  return undefined;
}

function hasEscalationMarker(body: string): boolean {
  return (body ?? "").includes(ESCALATION_MARKER);
}

/**
 * Stamp the {@link ESCALATION_MARKER} onto a requires-attention diagnosis/body (SP-6/6 AC5), idempotently
 * — a body that already carries the marker is returned unchanged, so a re-run can't accumulate duplicate
 * markers. The marker is appended on its own line (the durable, human-facing signal that the bounded
 * rework loop has been exhausted and a human decision is required). Pure.
 */
function markEscalated(body: string): string {
  const text = body ?? "";
  if (hasEscalationMarker(text)) return text;
  return text.trim()
    ? `${text.replace(/\s+$/, "")}\n\n${ESCALATION_MARKER}`
    : ESCALATION_MARKER;
}

/**
 * Strip a `satisfies:` frontmatter key — and any YAML block-list items nested under it — from a
 * slice/spec body (SP-6 AC1). The slice keeps `satisfies` orchestrator-internally for the grader;
 * what's removed here is only the embedding the worker would read, so the implementer can't learn
 * which AC ordinals it is graded against. Targets the structured key (`^…satisfies:`) ONLY — a
 * prose mention of the word "satisfies" is never touched. Pure + idempotent.
 */
export function stripSatisfies(body: string): string {
  const lines = (body ?? "").split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)satisfies\s*:(.*)$/i.exec(lines[i]);
    if (m) {
      const indent = m[1].length;
      // Block-list form (`satisfies:` with an empty value) → also drop the deeper `- …` items.
      if (m[2].trim() === "") {
        while (i + 1 < lines.length) {
          const next = lines[i + 1];
          const ni = (/^(\s*)/.exec(next)?.[1] ?? "").length;
          if (ni > indent && /^\s*-\s/.test(next)) i++;
          else break;
        }
      }
      continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}

/**
 * The BUNDLED fallback for the worker preamble (the go-set, context tranche 2026-07-14) —
 * used only when no `worker-preamble.md` template resolves, so a missing doctrine file never
 * breaks a run. Content-mirrors `plugins/tandem-methodology/templates/worker-preamble.md`;
 * change both together. The UNDELIVERED line FORMAT the orchestrator parses is NOT here —
 * it is pinned in {@link UNDELIVERED_FORMAT_STANZA}, appended in code, never template-editable.
 */
export const BUNDLED_WORKER_PREAMBLE = [
  "HOW TO WORK (the go-set — behavioural doctrine for every dispatched worker):",
  "- THINK BEFORE CODING — BRIEFLY. Your FIRST output, before any code, is a SHORT statement (a dozen lines, no more) of your assumptions and anything unclear or unbuildable in the contract / instructions. Then ACT. Long deliberation is not the deliverable; surfacing a doubt is cheap, and the verify loop exists to correct course as you go.",
  "- SIMPLICITY FIRST. Build the simplest thing that honestly satisfies the intent and the contract — no speculative abstraction, no scaffolding for futures nobody asked for.",
  "- SURGICAL CHANGES. Touch only what the task requires; leave the surrounding code the way you found it. A small, legible diff is part of the deliverable.",
  "- NEVER INVENT AN UNSPECIFIED PROTOCOL SILENTLY. If the contract or Design does not name a seam you need (a config key, an arming mechanism, a constant an assertion pivots on), do not quietly make one up — name the gap (see the exit protocol below) or escalate with a question.",
  "- EXIT PROTOCOL — REPORT HONESTY. Anything not fully delivered MUST be listed in your final summary, one line per obligation, in the exact machine-parsed shape given by the FINAL-SUMMARY FORMAT stanza appended below this preamble (the shape is defined there and ONLY there). A declared gap is routed and fixed; an undeclared one is deception. Never stub silently, never leave a confession buried in a code comment — the summary line is the artifact the orchestrator reads.",
].join("\n");

/** The line prefix the orchestrator PARSES a worker's undelivered declarations by
 *  ({@link extractUndelivered}). A reply contract — in code, never template-editable. */
const UNDELIVERED_PREFIX = "UNDELIVERED:";

/** The machine-parsed reply contract for undelivered obligations, appended to every worker
 *  prompt IN CODE (after the template-loaded preamble) so an edited doctrine file can never
 *  break the parser: the exact line shape `extractUndelivered` scans for. */
export const UNDELIVERED_FORMAT_STANZA =
  "FINAL-SUMMARY FORMAT (machine-parsed — do not vary it): every obligation you did not fully deliver goes in your final summary on its own line, starting exactly with " +
  `\`${UNDELIVERED_PREFIX} \` followed by the obligation and — question: <what you would have asked>. No undelivered obligations ⇒ no such lines.`;

export function extractUndelivered(finalOutput: string): string[] {
  const out: string[] = [];
  for (const line of (finalOutput ?? "").split(/\r?\n/)) {
    const stripped = line.replace(/^\s*(?:[-*+]|\d+[.)])?\s*/, "");
    if (stripped.startsWith(UNDELIVERED_PREFIX)) {
      const text = stripped.slice(UNDELIVERED_PREFIX.length).trim();
      if (text) out.push(text);
    }
  }
  return out;
}

