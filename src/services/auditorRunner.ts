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

import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { AcVerdict, AcVerdictKind } from "./openingGate";
// Reuse, don't fork (SP-th1ddy): the same stream-json message-shape readers the orchestrator's
// spawn path uses, so the audit session is summarized and its session id / success read identically.
import {
  isResultSuccess,
  sessionIdOf,
  summarizeEvent,
} from "./orchestratorCore";
// SP-6/7 AC6: an AC whose verification command points at a held-out `acceptance/` path is KEPT by the
// auditor, not overridden to the repo's `npm test`. Reuse the single path-convention regex.
import { ACCEPTANCE_EVIDENCE_RE } from "../methodology/parallelSlices";

/**
 * The auditor's verdict kinds, extended with `assessment` (SP-6/7): a prose/UX/skill AC that no
 * runnable probe fits is *verifiable-by-assessment* — an independent assessor session grades it at
 * the closing gate — which is DISTINCT from a `needs-reframe` that leaves the AC un-gateable. Widened
 * locally so `openingGate`'s exported {@link AcVerdictKind} (outside this Spec's footprint) is untouched.
 */
export type AuditVerdictKind = AcVerdictKind | "assessment";

/**
 * One auditor verdict, widened to carry the SP-6/7 `assessment` kind. A `verifiable`/`needs-reframe`
 * verdict is structurally exactly an {@link AcVerdict}; an `assessment` verdict needs no runnable `run`
 * (the closing gate dispatches an assessor for it) and may carry a `rationale`. `env` stays
 * `cluster | local` so a non-assessment verdict narrows cleanly back to {@link AcVerdict}.
 */
export interface AuditVerdict {
  /** 1-based AC ordinal this verdict covers. */
  ordinal: number;
  /** The auditor's call, including the SP-6/7 `assessment` kind. */
  verdict: AuditVerdictKind;
  /** The command that proves a `verifiable` AC. */
  run?: string;
  /** Where a `verifiable` AC runs. */
  env?: "cluster" | "local";
  /** Why a `needs-reframe` AC can't be verified as written. */
  why?: string;
  /** Why an `assessment` AC must be graded by an independent assessor rather than a command. */
  rationale?: string;
}

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
  verdicts: AuditVerdict[];
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
export function computePassed(
  acs: AuditAc[],
  verdicts: AuditVerdict[],
): boolean {
  if (!acs.length) return false;
  const byOrdinal = new Map<number, AuditVerdict>();
  for (const v of verdicts) byOrdinal.set(v.ordinal, v);
  for (const ac of acs) {
    const v = byOrdinal.get(ac.ordinal);
    if (!v) return false;
    // `assessment` (SP-6/7) passes the audit with no runnable `run` — the closing gate grades it via
    // an independent assessor. `verifiable` still requires a concrete command. `needs-reframe` fails.
    if (v.verdict === "assessment") continue;
    if (v.verdict !== "verifiable") return false;
    if (typeof v.run !== "string" || !v.run.trim()) return false;
  }
  return true;
}

// ── prompt ─────────────────────────────────────────────────────────────────-

/**
 * Build the adversarial verifiability-audit prompt — the same judgment the `/spec-prepare` skill
 * runs at step 7, framed for a headless one-shot session that must answer in machine-readable JSON.
 * The auditor flags an AC `needs-reframe` when its verifying actor is a human (no AI evidence is
 * producible), its check is deploy/merge-circular (it can't be checked before the gate it arms),
 * or it fails **controllability** — the probe cannot establish the AC's preconditions using only
 * what the Design defines (an undefined arming/config seam); otherwise `verifiable` with the
 * concrete proof command.
 *
 * DRIFT GUARD: this rubric is DUPLICATED in the `/spec-prepare` skill's step 7
 * (`plugins/tandem-methodology/skills/spec-prepare/SKILL.md` + `reference.md`, "the four
 * questions") — and THIS copy is the authoritative one, because only this audit's verdicts get
 * signed into `ac_verifications` (SP-6/1; the skill-level Task pass is interactive/advisory).
 * They have drifted once already: the controllability question was added to the skill after a
 * real run lost 4/4 of an AC's tests to an undefined arming seam ("with a secret configured" —
 * how?), while this prompt kept asking only the first two questions, so the WEAKER rubric held
 * the signing pen. When you change the questions in either place, change both.
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
    "    merge or deploy that the gate it arms gates), or",
    "  - it fails CONTROLLABILITY: walk through the probe step by step — can it establish the",
    "    criterion's preconditions and drive the behaviour using ONLY seams the Spec's Design",
    '    names? If the criterion hinges on a state the Design never says how to reach ("with X',
    '    configured" but never how one configures it, "when the feature is enabled" with no named',
    "    enablement surface, an unnamed constant the assertion pivots on), the probe author must",
    "    INVENT that seam and the implementer will invent a DIFFERENT one — a guaranteed red",
    "    against a correct implementation. That is a Design defect: name the missing seam in `why`",
    "    (the fix is naming it in the Design — a config env var, an injectable parameter, a setup",
    "    call — then re-auditing).",
    "When a criterion CAN be judged before merge but no runnable command fits it (a prose / UX /",
    "skill / judgment AC), call it `assessment`: an independent assessor session will read the",
    "delivered artifact and grade it pass/fail with a rationale — this is DISTINCT from",
    "`needs-reframe` (which leaves the AC un-gateable). Otherwise call it `verifiable` and give the",
    'single command (`run`) that proves it, and where it runs (`env`: "local" or "cluster").',
    "",
    "Acceptance Criteria:",
    acBlock,
    context,
    "",
    "Respond with ONLY a JSON array (no prose, no markdown fence needed) of one object per",
    "criterion, in ordinal order:",
    '  [{"ordinal":1,"verdict":"verifiable","run":"npm test","env":"local"},',
    '   {"ordinal":2,"verdict":"assessment","rationale":"a UX quality an assessor judges"},',
    '   {"ordinal":3,"verdict":"needs-reframe","why":"a human confirms by eye"}]',
    "Include `run` (and optionally `env`) only for `verifiable`; `rationale` for `assessment`; `why`",
    "for `needs-reframe`.",
  ].join("\n");
}

// ── verdict parsing ──────────────────────────────────────────────────────────

const VERDICT_KINDS = new Set<AuditVerdictKind>([
  "verifiable",
  "needs-reframe",
  "assessment",
]);

/**
 * Parse the auditor's reply into {@link AcVerdict}s. Tolerant of a surrounding ```json fence or
 * stray prose: it extracts the last top-level `[ ... ]` array and validates each entry. An entry
 * with an unrecognized/absent `verdict` is coerced to `needs-reframe` (conservative — a malformed
 * verdict must never silently pass the audit). Non-object entries and non-positive-integer ordinals
 * are dropped. Returns `[]` when nothing parseable is found (the runner then reports an error).
 */
export function parseAuditVerdicts(text: string): AuditVerdict[] {
  const arr = extractJsonArray(text);
  if (!Array.isArray(arr)) return [];
  const out: AuditVerdict[] = [];
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
      VERDICT_KINDS.has(rec.verdict as AuditVerdictKind)
        ? (rec.verdict as AuditVerdictKind)
        : "needs-reframe";
    const verdict: AuditVerdict = { ordinal, verdict: kind };
    if (kind === "verifiable") {
      if (typeof rec.run === "string" && rec.run.trim())
        verdict.run = rec.run.trim();
      if (rec.env === "cluster" || rec.env === "local") verdict.env = rec.env;
    } else if (kind === "assessment") {
      // Verifiable-by-assessment (SP-6/7): no runnable command; carry the rationale hint if present.
      if (typeof rec.rationale === "string" && rec.rationale.trim())
        verdict.rationale = rec.rationale.trim();
      else if (typeof rec.why === "string" && rec.why.trim())
        verdict.rationale = rec.why.trim();
    } else if (typeof rec.why === "string" && rec.why.trim()) {
      verdict.why = rec.why.trim();
    }
    out.push(verdict);
  }
  return out;
}

/** Extract the auditor's top-level JSON array from arbitrary text (handles a ```json fence or
 *  prose around it). Returns the parsed value, or `null` when no array parses.
 *
 *  Ordering matters and was a live bug (the SP-1/1 rebrand certification): the old
 *  implementation went straight to a scan from the LAST `[` outward and returned the first slice
 *  that parsed as ANY array — but a verdict's own `run` command can contain bracket-indexing
 *  that is itself valid JSON (`[0]`, `["activitybar"]`, `packages[""]`), and one of those beat
 *  the real verdict array every time the audited spec's ACs demanded `node -e`-style commands.
 *  So: (1) a compliant reply — the prompt demands "ONLY a JSON array" — is tried WHOLE first;
 *  (2) then the content of a ```fence```; (3) only then the bracket scan, and a scan candidate
 *  must contain at least one OBJECT element (verdicts are objects; `parseAuditVerdicts` drops
 *  everything else anyway), so an indexing fragment inside a command string can never win. */
function extractJsonArray(text: string): unknown {
  if (!text) return null;
  // (1) The compliant happy path: the whole (trimmed) reply IS the array.
  const whole = text.trim();
  if (whole.startsWith("[")) {
    try {
      const v = JSON.parse(whole);
      if (Array.isArray(v)) return v;
    } catch {
      /* fall through to the fence / scan paths */
    }
  }
  // (2) A fenced reply: take the LAST ``` block (the answer, not an example quoted earlier).
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  for (let i = fences.length - 1; i >= 0; i--) {
    try {
      const v = JSON.parse(fences[i][1].trim());
      if (Array.isArray(v)) return v;
    } catch {
      /* not this fence */
    }
  }
  // (3) Prose around the array: scan from the last `[` outward (a trailing real answer beats an
  // example earlier in prose), but only accept an array carrying at least one object element.
  const starts: number[] = [];
  for (let i = 0; i < text.length; i++) if (text[i] === "[") starts.push(i);
  for (let s = starts.length - 1; s >= 0; s--) {
    const start = starts[s];
    const end = text.lastIndexOf("]");
    for (let e = end; e > start; e--) {
      if (text[e] !== "]") continue;
      try {
        const v = JSON.parse(text.slice(start, e + 1));
        if (
          Array.isArray(v) &&
          v.some((el) => el !== null && typeof el === "object")
        )
          return v;
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

/** Deps for the real runner — all injectable so the spawn path is testable without a live model. */
export interface SdkAuditDeps {
  /** Progress sink (mirrors the orchestrator's `output.appendLine`). Defaults to a no-op. */
  log?: (line: string) => void;
  /** Loads the SDK `query`. Defaults to a lazy `import("@anthropic-ai/claude-agent-sdk")` — the
   *  same lazy-import the orchestrator uses, so the SDK never loads at activation. */
  loadQuery?: () => Promise<SdkQuery>;
}

/**
 * Resolve a repo's REAL local verification command from the audit cwd — its own test entrypoint
 * (`npm test`) when `package.json` declares a `test` script. The design-phase audit can't know the
 * test FILE that will verify an AC: it doesn't exist yet (the slice that writes it hasn't run), so a
 * model-fabricated per-file command (e.g. `npx vitest run src/x.test.ts` in a `node --test` repo) is
 * a guess — and was observed wrong. The honest local command is the repo's actual test recipe.
 * Returns `undefined` when there's no `test` script (the caller then leaves the model's command as a
 * best-effort fallback rather than inventing one).
 */
export async function defaultLocalRunResolver(
  cwd: string,
): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(path.join(cwd, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    const test = pkg.scripts?.test;
    return typeof test === "string" && test.trim() ? "npm test" : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A repo's held-out **acceptance-probe recipe** (SP-6/7, the runnable half of mechanism 5) — how a
 * *runnable* AC is graded by an **independently-authored** probe instead of the self-graded whole
 * suite. Both templates carry `{spec}` (the sanitized Spec id) and `{ac}` (the 1-based AC ordinal)
 * slots. Declared per-repo in `.tandem/conventions.json` so the convention is **tech-agnostic**: a TS
 * repo fills it with `node --test …*.test.js`, a Python repo with `pytest …`, a Rust crate with
 * `cargo test …`. The methodology never hardcodes a language — the repo supplies it.
 */
export interface AcceptanceRecipe {
  /** Where the held-out test-author writes the probe (`/slice` fills this per AC). */
  sourcePath: string;
  /** How the closing gate runs it (the auditor fills this into `ac_verifications.run`). */
  run: string;
  /** Optional BUILD step the closing gate runs ONCE (per slice completion) before the per-AC `run`
   *  commands — e.g. `npx tsc -p tsconfig.test.json` for a compiled language whose `run` targets
   *  compiled output. A repo whose probes run from source (pytest, cargo test) declares none. */
  prepare?: string;
  /** SP-12: the repo-declared, non-mutating build-and-test command a CODE-author worker runs to
   *  self-verify its edits (targeting the gitignored `out-test/`, so it is guard-safe by construction).
   *  Read from the TOP-LEVEL `selfVerify` string in `.tandem/conventions.json` (a PEER of
   *  `acceptanceProbe`); `undefined` when absent or blank. Surfaced into the worker prompt's
   *  VERIFICATION BLOCK by `OrchestratorService`, closing the gap that let a worker improvise into
   *  shared build config to run tests. */
  selfVerify?: string;
}

/** Fill `{spec}`/`{ac}` in an acceptance-probe template. `spec` is sanitized to a path-safe token
 *  (any non-`[A-Za-z0-9._-]` run → `_`) so a composite id like `6/3` yields `6_3`; both the auditor
 *  (run) and `/slice` (sourcePath) fill the same way so the declared path and the written path match. */
export function fillProbeTemplate(
  template: string,
  spec: string,
  ac: number,
): string {
  const safeSpec = String(spec).replace(/[^A-Za-z0-9._-]+/g, "_");
  return template.replace(/\{spec\}/g, safeSpec).replace(/\{ac\}/g, String(ac));
}

/**
 * Load a repo's held-out {@link AcceptanceRecipe} from `.tandem/conventions.json` (its
 * `acceptanceProbe` object). Returns `undefined` when the file/field is absent or malformed — the
 * caller then falls back to the repo's whole-suite command (today's self-graded behavior), so a repo
 * that has not opted in is unaffected. Tech-agnostic: the file's own templates supply the language.
 */
export async function defaultAcceptanceRecipeResolver(
  cwd: string,
): Promise<AcceptanceRecipe | undefined> {
  try {
    const raw = await fs.readFile(
      path.join(cwd, ".tandem", "conventions.json"),
      "utf8",
    );
    const cfg = JSON.parse(raw) as {
      acceptanceProbe?: unknown;
      selfVerify?: unknown;
    };
    const p = cfg.acceptanceProbe as Record<string, unknown> | undefined;
    if (
      p &&
      typeof p.sourcePath === "string" &&
      p.sourcePath.trim() &&
      typeof p.run === "string" &&
      p.run.trim()
    ) {
      const prepare =
        typeof p.prepare === "string" && p.prepare.trim()
          ? p.prepare.trim()
          : undefined;
      // SP-12: the top-level `selfVerify` (a PEER of `acceptanceProbe`) — the code-author's sanctioned
      // build-and-test command. Trimmed; undefined when absent or blank.
      const selfVerify =
        typeof cfg.selfVerify === "string" && cfg.selfVerify.trim()
          ? cfg.selfVerify.trim()
          : undefined;
      return {
        sourcePath: p.sourcePath.trim(),
        run: p.run.trim(),
        prepare,
        selfVerify,
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Author each LOCAL `verifiable` AC's `run` command over the auditor's verdicts (SP-6/7). The auditor
 * only JUDGED verifiability; this deterministic, **model-free** step supplies the command from the
 * repo's CONVENTION — never a per-AC decision:
 *   - **held-out probe** — if the repo declares an {@link AcceptanceRecipe}, fill its `run` template
 *     with `(specId, ordinal)` so the AC is graded by an INDEPENDENTLY-authored probe (mechanism 5),
 *     not the self-graded whole suite;
 *   - **fallback** — a repo with no recipe keeps its whole-suite command (today's behavior), so it is
 *     unaffected until it opts in;
 *   - a command the auditor already pointed at a held-out `acceptance/` path is kept as-is.
 * `cluster` (an infra-lifecycle command the auditor is right to name) and `assessment` verdicts are
 * left untouched. Mutates and returns `verdicts`. Injectable resolvers keep it unit-testable.
 */
export async function deriveVerificationCommands(
  verdicts: AuditVerdict[],
  opts: {
    cwd: string;
    specId?: string;
    resolveLocalRun?: (cwd: string) => Promise<string | undefined>;
    resolveAcceptanceRecipe?: (
      cwd: string,
    ) => Promise<AcceptanceRecipe | undefined>;
  },
): Promise<AuditVerdict[]> {
  const resolveLocalRun = opts.resolveLocalRun ?? defaultLocalRunResolver;
  const resolveAcceptanceRecipe =
    opts.resolveAcceptanceRecipe ?? defaultAcceptanceRecipeResolver;
  const localRun = await resolveLocalRun(opts.cwd);
  const recipe = await resolveAcceptanceRecipe(opts.cwd);
  for (const v of verdicts) {
    if (v.verdict !== "verifiable" || v.env === "cluster") continue;
    // A declared recipe is deterministic + AUTHORITATIVE — fill from it FIRST, overriding any
    // model-authored `run`, even one that superficially points at an `acceptance/` path. The
    // auditor is a headless model that fabricates the runner + build dir (seen: `npx mocha
    // dist/acceptance/…` in a `node --test out-test/…` repo), and ACCEPTANCE_EVIDENCE_RE cannot
    // tell a fabricated acceptance path from a real probe — so letting the regex keep the model's
    // command silently defeats the very per-AC independence the recipe is meant to turn on.
    if (recipe && opts.specId) {
      v.run = fillProbeTemplate(recipe.run, opts.specId, v.ordinal);
      v.env = "local";
      continue;
    }
    // No recipe (the repo hasn't opted in): keep an auditor command already pointing at a held-out
    // acceptance/ path as-is; otherwise fall back to the repo's whole-suite command.
    if (v.run && ACCEPTANCE_EVIDENCE_RE.test(v.run)) continue;
    if (localRun) {
      v.run = localRun;
      v.env = "local";
    }
  }
  return verdicts;
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
      // The kanban MCP server is spawned rooted in the session's cwd. For a rejected
      // project-member that cwd is an ephemeral working-repo worktree the orchestrator
      // RESETS on a fresh run (remove + re-add → new inode) and accept later removes.
      // If that happens while this long-lived server is still alive, its process.cwd()
      // is a dangling reference and the SDK spawn below dies with `ENOENT: uv_cwd`
      // BEFORE it ever applies our `cwd` option (Node reads the parent cwd first).
      // Repair it to the audit's already-resolved good cwd so the audit survives a
      // worktree that moved under us (TEP-6). `req.cwd` is verified to exist upstream.
      try {
        process.cwd();
      } catch {
        process.chdir(req.cwd);
      }
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
    if (!verdicts.length) {
      // Evidence-fidelity: carry WHAT the auditor actually replied (head snippet + session id)
      // so a parse failure is a ten-second read, not transcript archaeology — diagnosing the
      // SP-1/1 recurrence required digging the reply out of ~/.claude/projects by hand.
      const reply = (resultText || assistantText).trim();
      const snippet = reply
        ? ` Reply began: ${JSON.stringify(reply.slice(0, 200))}${reply.length > 200 ? "…" : ""}`
        : " The audit session returned no text at all.";
      return {
        verdicts: [],
        passed: false,
        sessionId,
        error: `audit produced no parseable verdicts (session ${sessionId ?? "unknown"}).${snippet}`,
      };
    }

    // The auditor JUDGES only — verdict + env per AC. Authoring a local verifiable AC's `run`
    // command (from the repo's held-out acceptance-probe recipe, or a whole-suite fallback) is a
    // deterministic, model-free convention-fill that belongs to the builder, not the judge: see
    // `deriveVerificationCommands`, which `write_spec` runs over these verdicts before signing.
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
  verdicts: AuditVerdict[],
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
