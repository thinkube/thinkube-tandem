import { spawn } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { loadTemplate } from "../promptTemplates";
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
export const MAX_REWORK_ATTEMPTS = 3;

/**
 * The durable marker the orchestrator stamps onto an **escalated** slice's `## ⚑ Requires attention`
 * block (SP-6/6 AC5). It is the human-facing, reload-surviving signal that the bounded loop gave up
 * on auto-re-dispatch: a slice carrying it is awaiting a human decision, not a re-queue. Detected by
 * {@link hasEscalationMarker} and stamped by {@link markEscalated}; the test asserts via THIS constant
 * (never a hand-copied string) so the marker and its detector can never silently diverge.
 */
export const ESCALATION_MARKER =
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
export const CONTRACT_DEFECT_MARKER =
  "⛔ CONTRACT-DEFECT — the contract is incomplete";

/**
 * Marker for a **gate-attributed** escalation (2026-07-11): the verification
 * PROBE itself cannot run (shell exit 126/127 or spawn error). The defect is
 * the gate's own machinery — the probe command, its environment — never the
 * slice, so no rework attempt is burned and no role is re-dispatched; the
 * remedy is re-authoring `ac_verifications` (auditor re-run), and only if that
 * still cannot produce a runnable probe does a human see this marker.
 */
export const GATE_DEFECT_MARKER =
  "⛔ GATE-DEFECT — the verification probe cannot run";

/**
 * Marker for a **deterministic-failure** escalation (2026-07-11): the same AC
 * failed with (normalized-)identical evidence to the prior attempt. Re-running
 * unchanged inputs cannot converge, so remaining rework attempts are not
 * burned — the loop stops immediately and a human (or auto-attend) decides.
 */
export const DETERMINISTIC_FAILURE_MARKER =
  "⛔ DETERMINISTIC FAILURE — identical evidence to the prior attempt; retrying unchanged inputs cannot converge";

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
export interface FailureJudgment {
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
export type JudgeFailure = (
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
export interface ReDispatchVerdict {
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
 * Normalize failing-run evidence into a stable hash for the identical-failure
 * circuit breaker: volatile fragments (durations, timestamps, tmp paths, hex
 * addresses, pids) are stripped so two runs of the same deterministic failure
 * hash identically while any real change in the failure hashes differently.
 */
export function normalizeEvidenceHash(evidence: string): string {
  const normalized = (evidence ?? "")
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<ts>")
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|s|sec|seconds?|m|min|minutes?)\b/gi, "<dur>")
    .replace(/duration_ms:\s*[\d.]+/g, "duration_ms: <dur>")
    .replace(/\/tmp\/[^\s'"]+/g, "<tmp>")
    .replace(/0x[0-9a-fA-F]+/g, "<addr>")
    .replace(/\bpid[= ]\d+/gi, "pid=<pid>")
    .replace(/[ \t]+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex");
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
export function reDispatchDecision(
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

export function hasEscalationMarker(body: string): boolean {
  return (body ?? "").includes(ESCALATION_MARKER);
}

/**
 * Stamp the {@link ESCALATION_MARKER} onto a requires-attention diagnosis/body (SP-6/6 AC5), idempotently
 * — a body that already carries the marker is returned unchanged, so a re-run can't accumulate duplicate
 * markers. The marker is appended on its own line (the durable, human-facing signal that the bounded
 * rework loop has been exhausted and a human decision is required). Pure.
 */
export function markEscalated(body: string): string {
  const text = body ?? "";
  if (hasEscalationMarker(text)) return text;
  return text.trim()
    ? `${text.replace(/\s+$/, "")}\n\n${ESCALATION_MARKER}`
    : ESCALATION_MARKER;
}

/**
 * Strip the `## Acceptance Criteria` block — the heading PLUS its body, up to the next heading of
 * the same or higher level — from a Spec/slice markdown body (SP-6 AC1, "hold out the exam"). The
 * worker builds to **intent** (summary / Design / its task) and never receives the gradeable
 * criteria it would otherwise be tempted to optimise to. Pure + idempotent: a body with no AC block
 * passes through unchanged. Heading + AC-title matching mirrors `checkAcOrdinals` so the exact
 * section the grader later ticks is the section withheld here.
 */
export function stripAcceptanceCriteria(body: string): string {
  const lines = (body ?? "").split(/\r?\n/);
  const out: string[] = [];
  let skipLevel: number | null = null; // the AC heading's level while we're dropping its block
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      // Inside the AC block: a heading of the same/higher level ends it; a deeper sub-heading
      // belongs to the block and is dropped too.
      if (skipLevel !== null) {
        if (level <= skipLevel) skipLevel = null;
        else continue;
      }
      const text = heading[2].trim().toLowerCase();
      if (
        skipLevel === null &&
        (text === "acceptance criteria" || text === "acceptance_criteria")
      ) {
        skipLevel = level;
        continue;
      }
    } else if (skipLevel !== null) {
      continue; // body line inside the AC block — drop it.
    }
    out.push(line);
  }
  return out.join("\n");
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
 * Build the **autonomy-first prompt** for a worker dispatched on one execution unit
 *. Scoped to the unit's footprint + shape, it tells the worker to decide
 * autonomously (never seek confirmation), never touch git or the thinking space, and escalate
 * with a question ONLY when genuinely blocked — the posture that keeps headless
 * execution from stopping on routine approvals.
 *
 * **Full intention for BOTH roles (context tranche, 2026-07-14 — reversing SP-6 AC1's "exam held
 * out" for code units):** every worker now receives the parent TEP (the north star), the FULL spec
 * body INCLUDING the `## Acceptance Criteria` block, the Spec-wide contract, and every sibling
 * unit's note labeled by role. Zero rubric-gaming was ever observed while context-starvation
 * failures repeated, so blindness is now exactly TWO artifacts: the probe SOURCE is withheld from
 * code workers and the implementation SOURCE from test workers (the structural tester-worktree
 * isolation, unchanged). `satisfies` ordinals stay stripped for code units — grader bookkeeping,
 * not intent ({@link stripSatisfies}). Mostly pure (the doctrine preamble is loaded from an
 * editable template with a bundled fallback) → unit-tested.
 */
/**
 * Tools DENIED to a worker by role (SP-6/7). Independence is STRUCTURAL — a `role: test` worker's
 * cwd is the Spec's TESTER worktree, a base-commit snapshot where the code workers' in-progress
 * modifications simply do not exist — so its Read/Glob are unrestricted (there is nothing to hide in
 * its tree; it needs the base code to write a well-integrated test). The tool denial is the
 * SECONDARY control (the maintainer's layering: inform → structure → fence):
 *   • **Bash** — the roam vector (`cd` into the code worktree / other repos / session transcripts):
 *     an arbitrary shell command is NOT lexically containable, so it stays denied;
 *   • **WebFetch / WebSearch / Task** — no need, and Task could spawn an unfenced sub-agent.
 * SP-6/16 Part B: **Grep** is no longer denied wholesale — a pathless/absolute-path search was its only
 * escape route, and that is now closed LEXICALLY by {@link grepWithinCwd} (scoping the search to the
 * worker's own cwd snapshot) rather than by removing the tool. In-tree search is fair use (the tester
 * only ever reads within its own snapshot), so `Grep` is restored as an available tool + cwd guard.
 * A `code` worker keeps unrestricted `Grep` (it already has `Bash`, so scoping its `Grep` buys nothing;
 * its footprint fence stops it authoring the `acceptance/` grader, and `codeReadFence` stops it reading
 * copied-in probes during rework). Pure → the caller passes the result as the SDK query's `disallowedTools`.
 */
export function disallowedToolsForRole(role?: "code" | "test"): string[] {
  return role === "test" ? ["Bash", "WebFetch", "WebSearch", "Task"] : [];
}

/**
 * SP-6/16 Part B — the PURE, lexical cwd-containment guard for a `role: test` worker's `Grep` (the
 * tool un-denied above). A tester's `cwd` is its base-commit snapshot worktree, a sibling of the code
 * worktree where the graded implementation lives; the original blanket deny existed only to stop a
 * pathless / absolute-path search reaching that sibling. This restores in-tree search while closing
 * exactly that escape: a `Grep` whose `path` argument resolves OUTSIDE `cwd` is DENIED; an
 * omitted path (searches cwd) or any path — relative or absolute — resolving within cwd is ALLOWED
 * (consistent with `Read`, so workers learn ONE path rule); a non-`Grep` tool is
 * always allowed (this guard governs `Grep` only). Purely lexical — `path.resolve`/`path.relative`
 * against `cwd`, the SAME rule as {@link sliceFilesResolveInRepo}; no `realpath`/`fs` (the low-likelihood
 * symlink-escape gap is accepted, out of scope). The caller applies this in the PreToolUse hook only
 * when `isTest`, returning the same `permissionDecision: "deny"` shape on `{ allow: false }`.
 */
export function grepWithinCwd(
  toolName: string,
  toolInput: unknown,
  cwd: string,
): { allow: true } | { allow: false; reason: string } {
  // This guard governs Grep only — any other tool is outside its remit.
  if (toolName !== "Grep") return { allow: true };
  const rawPath = (toolInput as { path?: unknown } | null | undefined)?.path;
  // No `path` (or a blank one) → the Grep searches cwd itself → contained → allowed.
  if (rawPath == null || (typeof rawPath === "string" && !rawPath.trim())) {
    return { allow: true };
  }
  // A non-string path can't be reasoned about lexically — deny fail-safe.
  if (typeof rawPath !== "string") {
    return {
      allow: false,
      reason: `Grep path must be a string inside the working directory; got ${typeof rawPath}.`,
    };
  }
  const root = path.resolve(cwd);
  const target = rawPath.trim();
  // Absolute paths that resolve INSIDE cwd are allowed (2026-07-15). The old blanket
  // absolute-deny taught workers the wrong rule: Read accepts an absolute in-tree path,
  // so every worker learned "absolute is fine" and then burned calls rediscovering that
  // Grep disagreed — the same denial, in every worker, in every run (a fence defect, not
  // a worker defect). Containment is the resolve-and-relative check below, which is the
  // real escape guard; where the path is DECLARED from adds nothing to it.
  //
  // Resolve against cwd and require it to stay under root (an absolute target resolves to
  // itself). `path.relative` yields a leading `..` (or an absolute path on a drive change)
  // when the target escapes; `""` means the path IS cwd — allowed for a search (unlike a
  // slice footprint, cwd is a searchable directory).
  const resolved = path.resolve(root, target);
  const rel = path.relative(root, resolved);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    return {
      allow: false,
      reason: `Grep path escapes the working directory (${root}): ${rawPath}`,
    };
  }
  return { allow: true };
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
export const UNDELIVERED_PREFIX = "UNDELIVERED:";

/** The machine-parsed reply contract for undelivered obligations, appended to every worker
 *  prompt IN CODE (after the template-loaded preamble) so an edited doctrine file can never
 *  break the parser: the exact line shape `extractUndelivered` scans for. */
export const UNDELIVERED_FORMAT_STANZA =
  "FINAL-SUMMARY FORMAT (machine-parsed — do not vary it): every obligation you did not fully deliver goes in your final summary on its own line, starting exactly with " +
  `\`${UNDELIVERED_PREFIX} \` followed by the obligation and — question: <what you would have asked>. No undelivered obligations ⇒ no such lines.`;

/**
 * Pull a worker's declared undelivered obligations out of its final output (the go-set exit
 * protocol): every line whose text — after an optional list marker — starts with
 * {@link UNDELIVERED_PREFIX}, returned verbatim (prefix stripped, trimmed). A simple
 * line-prefix scan by design: the format stanza pins the shape, and a declared gap must
 * survive any surrounding prose. No matching lines ⇒ `[]`. Pure.
 */
/** Tester DECISIONS record (2026-07-15): the ambiguity resolutions a test author
 *  was forced to make where the contract ran out — the chosen rule + the exact
 *  literal, one line each, machine-parsed by prefix. Threaded into the SAME-slice
 *  coder's brief (tests-first guarantees the timing), so a naming/semantics
 *  divergence costs one contract line instead of oracle rounds. Interpretation
 *  choices ONLY — never the test matrix. */
export const DECISION_PREFIX = "DECISION: ";
export function extractDecisions(finalOutput: string): string[] {
  const out: string[] = [];
  for (const line of (finalOutput ?? "").split(/\r?\n/)) {
    const stripped = line.replace(/^\s*(?:[-*+]|\d+[.)])?\s*/, "");
    if (stripped.startsWith(DECISION_PREFIX)) {
      const text = stripped.slice(DECISION_PREFIX.length).trim();
      if (text) out.push(text);
    }
  }
  return out;
}

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

