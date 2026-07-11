/**
 * Thinking Space orchestrator — the integration shell around `orchestratorCore`'s pure
 * scheduler. `dispatchSpec` runs a **makespan scheduler over the Spec's work-unit DAG**: it
 * pools every slice's execution units into one graph (units span slices, never Specs), keeps
 * a per-Spec pool of N workers saturated (ready frontier ∧ footprint-disjoint, critical-path
 * first), verifies each slice when all its units land, and commits **once** when the whole
 * Spec is green. A worker is an **Agent SDK `query()` session** (`runViaSdk`) — a headless
 * `claude` subprocess the SDK manages under `bypassPermissions`; workers only edit files, the
 * orchestrator owns git. The SDK is the sole substrate; tests inject the `runUnit` seam to
 * return outcomes (success / needs-input / failed) without a live SDK call.
 *
 * The pure DAG/frontier/prompt logic lives in `orchestratorCore` + `parallelSlices`
 * (unit-tested). This shell is the low-AI-testability part (live SDK worker + worktree +
 * commit): its end-to-end behaviour is a human verdict ( lever), exercised with fakes.
 */
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type * as vscode from "vscode";
// Type-only (erased at runtime — the SDK itself stays lazy-imported): the mcpServers value
// type for the in-process verify-oracle server (tests-first, 2026-07-08).
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { WorktreeService } from "./WorktreeService";
import type { OwnershipArbiter } from "./OwnershipArbiter";
import type { ThinkubeStore } from "../store/ThinkubeStore";
import {
  buildUnitDag,
  readyFrontier,
  buildWorkerPrompt,
  disallowedToolsForRole,
  grepWithinCwd,
  stripAcceptanceCriteria,
  stripSatisfies,
  extractNeedsInput,
  sessionIdOf,
  summarizeEvent,
  isResultSuccess,
  parseAcVerifications,
  runAcVerifications,
  checkAcOrdinals,
  buildDeliveryReport,
  extractDiscoveries,
  extractDiagnosis,
  buildTestReworkContext,
  buildVerificationTrace,
  mergeVerificationTrace,
  finalizationVerdict,
  FINALIZATION_WEDGED_DIAGNOSIS,
  commitPlan,
  resumeDecision,
  reDispatchDecision,
  markEscalated,
  hasEscalationMarker,
  normalizeEvidenceHash,
  ESCALATION_MARKER,
  CONTRACT_DEFECT_MARKER,
  GATE_DEFECT_MARKER,
  DETERMINISTIC_FAILURE_MARKER,
  type SliceForDag,
  type SchedUnit,
  type SchedulerState,
  type WorkUnit,
  type AcVerification,
  type AcResult,
  type AcAssessment,
  type AssessAc,
  type AssessContext,
  type Fault,
  type FailureJudgment,
  type JudgeFailure,
  type VerificationTraceEntry,
  type FinalizationState,
  type SliceOutcome,
  runBounded,
} from "./orchestratorCore";
import {
  validateDag,
  footprintGuard,
  footprintContainment,
  codeReadFence,
  codeTestFence,
  resolveFootprint,
  resolveRoleFootprint,
  normalizeFilePath,
  type ContainmentResult,
} from "../methodology/parallelSlices";
import {
  splitAttentionArtifacts,
  attentionHistoryEntry,
} from "../methodology/sliceLifecycle";
import { defaultAcceptanceRecipeResolver } from "./auditorRunner";
import { resolveWorkerModel, type WorkerModelConfig } from "./workerModel";
import { rtkRewrite } from "./rtkRewrite";
import {
  createVerifyOracle,
  formatVerifyReply,
  classifyPrepareFailure,
  runnerPath,
  type VerifyOracle,
} from "./verifyOracle";
import {
  startSession,
  appendSession,
  endSession,
  markUnitDone,
  parkWorker,
  unparkWorker,
  runningSessions,
} from "./orchestratorSessions";

/**
 * Called when a worker escalates a question and **parks resident**: the scheduler
 * frees its active slot but the worker stays alive, suspended. `answer` pushes the human's reply
 * into the live session (via `/attend`), continuing it in place.
 */
export type OnPark = (
  unit: SchedUnit,
  question: string,
  answer: (a: string) => void,
) => void;

const SLICE_REL_RE = /teps\/TEP-(\d+)\/SP-(\d+)\/SL-(\d+)\.md$/;

export interface OrchestratorDeps {
  worktrees: WorktreeService;
  arbiter: OwnershipArbiter;
  store: ThinkubeStore;
  output: vscode.OutputChannel;
  /** Absolute path to the canonical (non-worktree) code repo. */
  canonicalRepo: string;
  /** SP-17/1 — the pinned, decoupled worker-model configuration (read from `thinkube.orchestrator` →
   *  `workerModel` / `workerModelByRole` at the command boundary). REQUIRED: every construction (production
   *  AND test) supplies it, so no worker can silently inherit the session/env model — the resolved model is
   *  threaded into every worker spawn via {@link resolveWorkerModel}. There is no `?? {}` fallback. */
  workerModel: WorkerModelConfig;
  /** `thinkube.thinkingSpace.root` — injected into the worktree's `.mcp.json`. */
  thinkingSpaceRoot?: string;
  /** `thinkube.worktree.baseDir` — where linked worktrees are created. */
  baseDir?: string;
  /** Run the Spec's declared per-AC verifications at quiescence (tests): defaults to the core
   *  `runAcVerifications` runner (spawns each declared check in the worktree / live cluster).
   *  This is the closing gate's injectable seam — tests feed per-AC outcomes without a cluster. */
  runAcVerifications?: (
    verifs: AcVerification[],
    cwd: string,
  ) => Promise<AcResult[]>;
  /** Grade an `env: "assessment"` AC (SP-6/7 AC3) by dispatching a fresh INDEPENDENT assessor session
   *  (never the implementing worker), returning pass/fail + rationale from the AC + intent + delivered
   *  artifact. The closing gate hands it to `runAcVerifications` so a prose/UX/skill AC no runnable
   *  probe fits is still gated. Defaults to {@link createSdkAssessor} (a headless `query()` session);
   *  tests inject a fake so the assessment branch is unit-testable with no live model. */
  assessAc?: AssessAc;
  /** Judge a FAILED acceptance run (SP-6/7 AC4) — the same independent-judgment primitive as
   *  {@link assessAc}: a fresh session, NEVER the implementing worker, deciding whether the fault lies
   *  in the CODE or the TEST (or both) with a rationale, so the closing gate can route the re-dispatch
   *  to the right role (or escalate on `both`). Defaults to {@link createSdkJudge} (a headless read-only
   *  `query()` session in the worktree); tests inject a fake so the routing is unit-testable with no
   *  live model. */
  judgeFailure?: JudgeFailure;
  /** Tick the satisfied AC ordinals on the Spec doc (tests): defaults to flipping the checkboxes
   *  under the Spec body's `## Acceptance Criteria`, so the accept gate (every AC checked) passes. */
  checkAcs?: (specNumber: string, ordinals: number[]) => Promise<void>;
  /** @deprecated Legacy per-slice verify recipe (`thinkube.orchestrator.verifyCommand`); the
   *  closing gate is now per-AC, so this is no longer consulted. Kept so the command
   *  layer that still passes it compiles. */
  verifyCommand?: string;
  /** Advance a slice to Done (tests): defaults to stamping `status: done`. */
  advance?: (handle: string) => Promise<void>;
  /** Flag a slice requires-attention with a diagnosis (tests): defaults to a frontmatter+body write.
   *  `escalation` (SP-6/6 AC5) carries the durable bounded-loop state to persist alongside the flag:
   *  the threaded `attempts` counter (written as `rework_attempts`, read back by `buildSlices`) and,
   *  when `escalated`, the `escalated: true` frontmatter flag + the {@link ESCALATION_MARKER} stamped on
   *  the body — the reload-surviving signal that the loop gave up. Omitted ⇒ a plain requires-attention
   *  flag with no counter change (the pre-SP-6 behaviour). */
  flagAttention?: (
    handle: string,
    diagnosis: string,
    escalation?: {
      attempts: number;
      escalated: boolean;
      /** Normalized hash of this failure's evidence, persisted as
       *  `last_evidence_hash` — the identical-failure circuit breaker's memory. */
      evidenceHash?: string;
      /** The judged fault, persisted as `last_fault` — checkpoint seeding
       *  re-runs exactly the implicated role's units on the next dispatch. */
      fault?: Fault;
    },
  ) => Promise<void>;
  /** Re-author + re-sign the Spec's `ac_verifications` (the write_spec certify-only
   *  audit path) when the closing gate finds an UNRUNNABLE probe (exit 126/127) —
   *  the gate self-heal (2026-07-11). Returns true when the map was re-authored;
   *  the gate then retries once. Absent ⇒ no self-heal, the gate escalates with
   *  fault `gate` directly. */
  reauthorGate?: (specNumber: string, worktreeCwd: string) => Promise<boolean>;
  /** Auto-attend (2026-07-11): the one-shot fixer dispatched for an ESCALATED
   *  slice before a human is asked — full evidence, edits + commits in the
   *  worktree, then the closing gate re-runs (checkpoint seeding makes the
   *  commit count). Defaults to {@link createSdkAutoAttend}; tests inject a
   *  fake. Cap: one attempt per slice per orchestration run. */
  autoAttend?: AutoAttend;
  /** Park a slice needs-input with its question + the worker's session id + unit id (tests): defaults to a frontmatter+body write. */
  flagNeedsInput?: (
    handle: string,
    question: string,
    sessionId?: string,
    unitId?: string,
  ) => Promise<void>;
  /** Commit ONE slice's work before it is marked Done: per-slice
   *  commit-before-Done. Rejecting signals a git failure → the orchestrator rolls that slice back to
   *  `ready` (NOT Done) per `commitPlan`'s commit-failure protocol. Defaults to `git add -A && git
   *  commit` of the slice's footprint in the worktree (tests inject a fake git that fails one slice). */
  commit?: (handle: string, specNumber: string, cwd: string) => Promise<void>;
  /** Roll a slice back to `ready`: used when its commit fails — no slice ever ends
   *  Done with uncommitted work, so a later run re-attempts it. Defaults to stamping `status: ready`. */
  rollbackToReady?: (handle: string) => Promise<void>;
  /** Tear down a finished Spec — close its worktree (tests): defaults to `WorktreeService.remove`. */
  teardown?: (specNumber: string) => Promise<void>;
  /** Run one execution unit (tests): overrides the SDK substrate; `onPark` parks it resident. */
  runUnit?: (
    unit: SchedUnit,
    specNumber: string,
    cwd: string,
    onPark: OnPark,
  ) => Promise<WorkerResult>;
  /** Resolve the worktree HEAD's short SHA — the finalization watchdog's commit marker and the
   *  delivery report's stamp. Defaults to `git rev-parse --short HEAD` in the
   *  worktree; tests inject it so the watchdog sees a real commit without a live git repo. */
  gitShortSha?: (cwd: string) => Promise<string>;
  /** Post-tool footprint containment (SP-6/2 AC3 + SP-2/TEP-6 AC4): diff the worktree against the
   *  run-level UNION of every dispatched unit's `footprint` and REVERT only the changes outside it,
   *  returning the containment verdict. The whole-tree porcelain CANNOT attribute a change to a unit
   *  (`git status --porcelain` shows every unit's edits with no author), so it must not try — a change
   *  is a violation only when it lands outside ALL declared territory. A sibling's in-footprint change
   *  is in the union whether that sibling is still running OR has already finished, so it is never
   *  misattributed to this unit and reverted (the SP-6 mutual-destruction fix); `baseline` (paths
   *  already dirty when THIS unit started) additionally exempts pre-existing dirt outside the union.
   *  Defaults to `git status --porcelain` → `footprintContainment` → `git restore`/`clean` of only the
   *  offending paths; tests inject it to drive `runViaSdk`'s abort/rollback wiring without a live git repo. */
  containmentCheck?: (
    cwd: string,
    footprint: string[],
    ctx?: { baseline?: string[] },
  ) => Promise<ContainmentResult>;
  /** The Agent SDK `query()` entry (tests): defaults to the lazy `import("@anthropic-ai/claude-agent-sdk")`.
   *  Injected so a test can drive the REAL {@link OrchestratorService.runViaSdk} body — its PostToolUse
   *  containment hook, the `AbortController` hard-stop, and the success-precedence — with only the SDK
   *  boundary faked (no live `claude` subprocess). The default keeps production on the real lazy import. */
  sdkQuery?: (args: {
    prompt: AsyncIterable<unknown>;
    options: Record<string, unknown>;
  }) => AsyncIterable<unknown>;
  /** Run-halt failure THRESHOLD (SP-2/TEP-6 AC5): once this many ordinary unit failures accrue across
   *  the run, `dispatchSpec` HALTS — `fill()` stops pulling the ready frontier (no new dispatch), the
   *  loop drains the in-flight units, writes the report, and returns. Defaults to {@link DEFAULT_FAIL_THRESHOLD}
   *  (3). Overridable here (or via the `failThreshold` arg of `dispatchSpec`) so a test can set N=2.
   *  A footprint VIOLATION is NOT counted here — it halts on its FIRST occurrence regardless. */
  failThreshold?: number;
  /** Per-SLICE rework bound before escalation (SP-6/6 AC5): once a slice has recorded this many
   *  failed acceptance/rework attempts the bounded loop ESCALATES — it is left requires-attention
   *  with the {@link ESCALATION_MARKER} and `readyFrontier` stops auto-re-dispatching it. Threaded
   *  onto `SchedulerState.attemptBound`; defaults to the core's `MAX_REWORK_ATTEMPTS` when omitted.
   *  Overridable so a test can set a smaller bound (e.g. 2). The bound is control-plane — no model. */
  attemptBound?: number;
  /** SP-17/2 — probe whether the `rtk` binary is present on PATH. Always called at the top of
   *  dispatchSpec (guard is unconditional). Defaults to a `which rtk` PATH lookup; tests inject
   *  a fake so the loud guard is exercisable with no live binary. */
  rtkBinaryPresent?: () => boolean | Promise<boolean>;
}

/** The default run-halt failure threshold (SP-2/TEP-6 AC5): a small N of ordinary unit failures across
 *  a run after which no new units are dispatched. Kept low so a systemic failure can't burn a whole
 *  doomed run before the human can interrupt it; overridable via the dep / the `dispatchSpec` arg. */
export const DEFAULT_FAIL_THRESHOLD = 3;

/** Default PATH lookup for the `rtk` binary (SP-17/2): used when `OrchestratorDeps.rtkBinaryPresent`
 *  is not supplied. Runs `which rtk`; resolves `false` on any error (binary absent). */
function defaultRtkBinaryPresent(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const proc = spawn("which", ["rtk"], { stdio: "ignore" });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}

/** What a worker run resolved to — the third outcome carries the escalated question + session id. */
export interface WorkerResult {
  outcome: UnitOutcome;
  /** The escalated question (needs-input only). */
  question?: string;
  /** The worker's session id, captured for resume-on-answer (SL-3 / SL-5). */
  sessionId?: string;
  /** A requires-attention diagnosis to surface verbatim on the slice (failed only). Set by the
   *  post-tool footprint-containment hard-stop (SP-6/2 AC3) so the flagged slice names the exact
   *  out-of-footprint path, rather than the generic "exited without success" failure message. */
  attention?: string;
  /** True when this `failed` outcome is a **footprint VIOLATION** — the post-tool footprint-containment
   *  hard-stop (AC3/AC4) aborted the unit — rather than an ordinary worker/test failure. Threaded as a
   *  clean boolean (NOT a reason-string match) so `dispatchSpec`'s run-halt policy (SP-2/TEP-6 AC5) can
   *  halt the run on the FIRST footprint violation, distinct from the per-failure threshold. */
  containment?: boolean;
  /** SP-11/3: the worker's final output text, mined by `dispatchSpec` for a trailing `## Discoveries`
   *  block (out-of-scope findings) via `extractDiscoveries`. Any outcome may carry it. */
  finalOutput?: string;
}

export type UnitOutcome = "success" | "needs-input" | "failed";

export interface UnitResult {
  id: string;
  slice: string;
  outcome: UnitOutcome;
}

export interface SpecRunResult {
  specNumber: string;
  /** false only when the DAG was malformed (nothing dispatched). */
  ok: boolean;
  /** DAG-malformed reason (when ok=false). */
  reason?: string;
  /** Execution units dispatched this run. */
  dispatched: number;
  /** One result per dispatched unit. */
  results: UnitResult[];
  /** Slices that completed + verified + advanced this run. */
  advanced: string[];
  /** Slices flagged requires-attention (a worker failed or a verify was red) this run. */
  attention: string[];
  /** Slices the bounded rework loop ESCALATED this run (SP-6/6 AC5): their failed-attempt count
   *  reached the bound, so they are left requires-attention with the {@link ESCALATION_MARKER} and
   *  are no longer auto-re-dispatchable — a human must decide. A subset of `attention`. */
  escalated: string[];
  /** Slices parked needs-input (a worker asked a question) this run. */
  needsInput: string[];
  /** Slices rolled back to `ready` this run because their commit failed — a slice
   *  is never left Done with uncommitted work; a later run re-attempts (or resumes) it. */
  rolledBack: string[];
  /** The whole Spec landed and was committed. */
  committed: boolean;
  /** Thinking Space-relative path of the written delivery summary (DELIVERY.md), set when the report is written. */
  deliveryDoc?: string;
  /** The closing gate's per-AC verification results (pass/fail + evidence); empty when it couldn't run. */
  acResults: AcResult[];
  /** The build (`prepare`) failure that stopped the closing gate before ANY AC could run
   *  (repair window, 2026-07-08): the command + its bounded raw output. Rendered as a
   *  first-class section in DELIVERY.md — without it the report reads "every AC not run,
   *  no evidence" while the real cause lives only on the slice's attention note. */
  buildFailure?: { command: string; output: string };
  /** The durable, structured verification trace this run produced (SP-6/7 AC5) — per AC and per rework
   *  round: kind (probe/assessment), verdict, rationale, and any code-vs-test route. Persisted alongside
   *  DELIVERY.md and surfaced in the delivery report; empty when the closing gate could not run. */
  verificationTrace: VerificationTraceEntry[];
  /** SP-11/3: the closing-gate judge's UNCLIPPED per-AC rationale (`{ ac, text }` per red AC), kept
   *  whole here rather than discarded after the trace-table clip, so `buildDeliveryReport`'s
   *  "What happened" renders each diagnosis VERBATIM. Empty until a red AC is judged. */
  diagnosis: { ac: number; text: string }[];
  /** SP-11/3: out-of-scope findings workers reported under a trailing `## Discoveries` heading in their
   *  final output, each paired with the reporting unit id (collected verbatim via `extractDiscoveries`,
   *  no model-side summarizing). Rendered in the report's "Discoveries & recommendations" section. */
  discoveries: { unit: string; text: string }[];
}

// Leading/trailing shell punctuation to peel off a `run`-command token (quotes,
// parens, separators, redirects) before it is matched against a footprint path.
const RUN_TOKEN_TRIM_RE = /^['"`(]+|['"`);,&|<>]+$/g;

/**
 * Normalize a token from a verification `run` command to the repo-relative `src/`
 * source path a footprint declares: peel shell punctuation, drop a leading `./`,
 * rewrite the compiled `out-test/` tree back to `src/`, rewrite a compiled
 * `.js`/`.mjs`/`.cjs`/`.jsx` extension back to its `.ts`/… source, and normalize
 * separators. Mirrors `verificationRunnable`'s source mapping so a command like
 * `node --test out-test/x.test.js` resolves to the `src/x.test.ts` a worker owns.
 */
function runTokenToSource(token: string): string {
  let p = token
    .replace(RUN_TOKEN_TRIM_RE, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
  if (p.startsWith("out-test/")) p = "src/" + p.slice("out-test/".length);
  p = p.replace(/\.([cm]?)j(sx?)$/i, ".$1t$2");
  return normalizeFilePath(p);
}

/**
 * A `run` command **references** a worker-owned path: some whitespace token, normalized to its
 * `src/` source, lands inside a dispatched unit's footprint. This is the broad detector — it cannot
 * tell a grep/`[ -e … ]` *read* of the deliverable from an execution of a worker-authored script,
 * so it is NOT the grade's drop predicate (that is {@link verificationExecutesWorkerAuthored});
 * the gate uses it only to surface a "reads the deliverable" note in the log. Pure.
 */
export function verificationIsWorkerAuthored(
  run: string,
  workerOwned: ReadonlySet<string>,
): boolean {
  if (workerOwned.size === 0) return false;
  for (const raw of (run ?? "").split(/\s+/)) {
    if (!raw) continue;
    const src = runTokenToSource(raw);
    if (src && workerOwned.has(src)) return true;
  }
  return false;
}

// Shell tokens that put the scanner back in COMMAND position (the next token is executed).
const SHELL_COMMAND_BOUNDARY_RE =
  /^(;|&&?|\|\|?|\(|\)|\{|\}|do|done|then|else|elif|fi|if|while|until|!|exec|command|time)$/;
// Interpreters whose next non-flag argument is EXECUTED code (its content decides the verdict).
const INTERPRETER_RE =
  /^(node|nodejs|npx|tsx|ts-node|bash|sh|zsh|dash|ksh|python\d*|deno|bun|perl|ruby|source)$/i;
// Redirection operators: the token that follows is a data operand, never a command.
const REDIRECT_RE = /^\d*(<|>>?)$/;

/**
 * AC4 (SP-6/6 — the worker cannot grade itself). A declared AC verification is a worker-authored
 * **self-tick** only when its `run` command **executes** a file inside some dispatched unit's
 * footprint — the token sits in command position (start of a shell segment) or follows an
 * interpreter (`node x.js`, `bash y.sh`, `npx tsx z.ts`, `source f`), so the worker-authored
 * content produces the verdict. Merely *referencing* a worker-owned path as data (a grep target,
 * a `[ -e … ]` operand, a redirect) is NOT a self-tick: the logic that grades is the probe text
 * itself, which is server-authored and provenance-signed at the → Ready gate (`readyGate` /
 * `acSignature`) — and for a docs/config Spec the deliverable IS the files the probes must
 * inspect, so dropping reads deadlocks an honestly-green Spec (TEP-13_SP-1: AC probes naming
 * `docs/…` pages were discarded as "no verification ran" on every run). Held-out acceptance
 * evidence stays never-in-footprint via `resolveFootprint`, exactly as before. Pure.
 */
export function verificationExecutesWorkerAuthored(
  run: string,
  workerOwned: ReadonlySet<string>,
): boolean {
  if (workerOwned.size === 0) return false;
  let execPosition = true; // start of the command line = command position
  for (const raw of (run ?? "").split(/\s+/)) {
    if (!raw) continue;
    if (SHELL_COMMAND_BOUNDARY_RE.test(raw)) {
      execPosition = true;
      continue;
    }
    if (REDIRECT_RE.test(raw)) {
      execPosition = false; // next token is a redirect operand (data)
      continue;
    }
    // A boundary glued to the token's tail (`plan.md;`, `exit 1;`) re-arms command position
    // for the NEXT token; the current token keeps its own position.
    const gluedBoundary = /[;|&]$/.test(raw);
    if (execPosition && /^[A-Za-z_][A-Za-z0-9_]*=/.test(raw)) {
      // VAR=value prefix — the command is still to come.
    } else if (execPosition && raw.startsWith("-")) {
      // Interpreter/command flag (`node --test …`) — execution target still to come.
    } else if (execPosition) {
      const src = runTokenToSource(raw);
      if (src && workerOwned.has(src)) return true;
      // An interpreter keeps command position for its script argument; any other
      // command consumes it — what follows is that command's data.
      execPosition = INTERPRETER_RE.test(src) || raw === ".";
    }
    if (gluedBoundary) execPosition = true;
  }
  return false;
}

/**
 * A "whole-suite" verification runs the ENTIRE test suite (`npm|pnpm|yarn test`, `vitest`,
 * `jest`, `mocha`, or `node --test <dir>`) rather than a specific held-out acceptance probe.
 * Its green necessarily includes the worker's own `*.test.*` files, so it is SELF-GRADED, not
 * independent evidence — even though no single token resolves to a worker path (so
 * `verificationIsWorkerAuthored` cannot catch it). The grade surfaces this so a self-graded
 * green is never silently mistaken for an intent-check. It is NOT dropped from the grade: the
 * bootstrapping convention (Specs verified by `npm test`) still counts until each AC is migrated
 * to a held-out evidence path — the point where `verificationIsWorkerAuthored`'s independence
 * guarantee actually bites. Pure.
 */
export function verificationIsWholeSuite(run: string): boolean {
  const r = (run ?? "").trim();
  if (!r) return false;
  // A package `test` script runs the whole suite (the worker's tests included), whatever the args.
  if (/\b(npm|pnpm|yarn)\s+(run\s+)?test\b/.test(r)) return true;
  // A direct test-runner invocation is whole-suite ONLY when it names no specific file — a bare
  // runner or a directory target. Naming a specific file (any JS/TS extension) is a targeted probe
  // (a held-out `…/SP-6.acceptance.js` or `…/foo.test.js`), so it is NOT a blanket suite run.
  if (/\S+\.[cm]?[jt]sx?\b/.test(r)) return false;
  if (/\b(vitest|jest|mocha|ava)\b/.test(r)) return true;
  if (/\bnode\b[^\n]*--test\b/.test(r)) return true;
  return false;
}

// ── Independent assessor for `env: "assessment"` ACs (SP-6/7 AC3) ───────────
//
// The one independent-judgment primitive: a FRESH SDK session, never the implementing worker,
// that judges whether the delivered artifact satisfies an AC's intent and returns pass/fail WITH a
// rationale. `runAcVerifications` calls it (via `AssessContext`) for any AC declared `env:
// "assessment"`. Injectable end-to-end — tests wire `deps.assessAc` with a fake so no live model runs.

/** Minimal structural type of the Agent SDK `query()` the assessor/judge/worker depend on (loose so the
 *  lazy import doesn't pull SDK types into the module graph). `prompt` accepts a one-shot string (assessor
 *  / judge) OR a streaming `AsyncIterable` (the code/test-author worker), and `options` is a `Record` so a
 *  caller may spread extra fields (SP-17/1: `options.model`) without re-typing the seam. */
export type AssessorSdkQuery = (args: {
  prompt: string | AsyncIterable<unknown>;
  options: Record<string, unknown>;
}) => AsyncIterable<unknown>;

/** Deps for {@link createSdkAssessor} — the worktree cwd the assessor reads, plus injectable SDK
 *  loader + log sink (both defaulted) so the spawn path is testable without a live model. */
export interface SdkAssessorDeps {
  /** Working directory for the headless assessor session (the worktree carrying the delivered change). */
  cwd: string;
  /** SP-17/1 — the pinned worker model spread into `options.model` at the assessor/judge `query()` call
   *  so neither inherits the session/environment model (`ANTHROPIC_MODEL`). REQUIRED: every caller passes
   *  it explicitly (omission is a compile error — the loud guarantee), so there is no default. */
  model: string;
  /** Loads the SDK `query`. Defaults to a lazy `import("@anthropic-ai/claude-agent-sdk")`. */
  loadQuery?: () => Promise<AssessorSdkQuery>;
  /** Progress sink. Defaults to a no-op. */
  log?: (line: string) => void;
}

/** Clip a string to `n` chars with an ellipsis (local copy — the core's `clip` is not exported). */
function clipText(x: string, n: number): string {
  return x.length > n ? x.slice(0, n - 1) + "…" : x;
}

/**
 * Build the independent-assessor prompt (SP-6/7 AC3): judge ONE acceptance criterion's intent against
 * the delivered artifact, black-box, and answer in machine-readable JSON with a rationale. The session
 * runs in the worktree so the assessor may read the delivered change, but it did NOT author it.
 */
export function buildAssessPrompt(
  ac: AcVerification,
  intent: string,
  artifact: string,
): string {
  return [
    "You are an INDEPENDENT assessor for ONE acceptance criterion of a software Spec.",
    "You did NOT implement the change. Judge ONLY whether the delivered artifact satisfies the",
    "criterion's INTENT — not whether it is implemented a particular way.",
    "",
    `Acceptance criterion #${ac.ac}:`,
    intent.trim() ||
      "(criterion text unavailable — infer it from the artifact and the spec context)",
    artifact.trim()
      ? `\nDelivered artifact / context:\n${artifact.trim()}`
      : "",
    "\nYou may read the working tree (your cwd) to inspect the delivered change.",
    "",
    "Respond with ONLY a JSON object (no prose, no markdown fence needed):",
    '  {"pass": true, "rationale": "one or two sentences explaining the verdict"}',
  ]
    .filter((l) => l !== null && l !== undefined)
    .join("\n");
}

/** Extract the last top-level `{ ... }` object from arbitrary text (tolerant of a ```json fence /
 *  surrounding prose). Returns the parsed value, or null when nothing parses.
 *
 *  STRING-LITERAL-AWARE (SP-17/1): the scan tracks string state + escapes, so a brace INSIDE a
 *  string value never reads as structure. A prior raw `{`/`}` char scan returned the inner `{}` of a
 *  rationale string ("…default {} under contributes.configuration…") as an empty verdict object, so a
 *  PASSING assessment was recorded as `fail: (no rationale)` (AC-3, the first assessment AC ever run —
 *  its subject is a config default of `{}`). We collect every BALANCED top-level object and return the
 *  LAST one that parses to a plain object — the verdict is emitted last, after any reasoning/quoted JSON. */
function extractJsonObject(text: string): unknown {
  if (!text) return null;
  let last: unknown = null;
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          const v = JSON.parse(text.slice(start, i + 1));
          if (v && typeof v === "object" && !Array.isArray(v)) last = v;
        } catch {
          /* not valid JSON — keep scanning for a later top-level object */
        }
        start = -1;
      }
    }
  }
  return last;
}

/**
 * Parse an assessor session's reply into an {@link AcAssessment} (SP-6/7 AC3). Tolerant of a fence /
 * surrounding prose: the last top-level JSON object with a truthy `pass` (or `verdict: "pass"`) and a
 * `rationale`/`why` string. Fail-safe: an unparseable reply → a FAIL carrying the raw reply as the
 * rationale (never a silent pass — the no-skip rule). Pure.
 */
export function parseAssessment(text: string): AcAssessment {
  const obj = extractJsonObject(text);
  if (obj) {
    const rec = obj as Record<string, unknown>;
    const pass =
      rec.pass === true ||
      rec.pass === "true" ||
      rec.verdict === "pass" ||
      rec.passed === true;
    const rationale =
      (typeof rec.rationale === "string" && rec.rationale.trim()) ||
      (typeof rec.why === "string" && rec.why.trim()) ||
      "";
    return { pass, rationale: rationale || "(no rationale)" };
  }
  return {
    pass: false,
    rationale: `assessor produced no parseable verdict: ${clipText((text ?? "").trim(), 200)}`,
  };
}

/**
 * The production {@link AssessAc} (SP-6/7 AC3): dispatch a headless, read-only Claude session in the
 * worktree that judges one AC's intent against the delivered artifact and returns pass/fail + rationale.
 * Lazy-imported and failure-tolerant — a load/run error, a non-success result, or an unparseable reply
 * all degrade to a FAIL with a rationale (never a thrown crash, never a spurious pass).
 */
export function createSdkAssessor(deps: SdkAssessorDeps): AssessAc {
  const log = deps.log ?? (() => {});
  const loadQuery =
    deps.loadQuery ??
    (async () =>
      (await import("@anthropic-ai/claude-agent-sdk"))
        .query as unknown as AssessorSdkQuery);
  return async (ac, intent, artifact): Promise<AcAssessment> => {
    const prompt = buildAssessPrompt(ac, intent, artifact);
    let resultText = "";
    let assistantText = "";
    let sawSuccess = false;
    try {
      const query = await loadQuery();
      for await (const msg of query({
        prompt,
        // SP-17/1: pin the assessor's model explicitly so it never inherits the session/env model.
        options: {
          cwd: deps.cwd,
          model: deps.model,
          permissionMode: "bypassPermissions",
        },
      })) {
        const rec = msg as Record<string, unknown>;
        const line = summarizeEvent(rec);
        if (line) log(`  [assess AC#${ac.ac}] ${line}`);
        if (rec.type === "assistant") {
          const m = rec.message as { content?: unknown } | undefined;
          const content = Array.isArray(m?.content) ? m!.content : [];
          for (const b of content as Array<Record<string, unknown>>)
            if (b.type === "text" && typeof b.text === "string")
              assistantText += b.text;
        }
        if (rec.type === "result") {
          if (typeof rec.result === "string") resultText = rec.result;
          sawSuccess = isResultSuccess(rec);
        }
      }
    } catch (err) {
      return {
        pass: false,
        rationale: `assessor session failed: ${(err as Error).message}`,
      };
    }
    if (!sawSuccess)
      return {
        pass: false,
        rationale: "assessor session did not complete successfully",
      };
    return parseAssessment(resultText || assistantText);
  };
}

// ── Independent code-vs-test judge for a red acceptance run (SP-6/7 AC4) ────
//
// The SAME independent-judgment primitive as the assessor (a fresh SDK session, never the implementing
// worker, a verdict WITH a rationale) — reused to decide whether a FAILED acceptance run is a CODE
// fault (the implementation diverged from intent) or a TEST fault (the held-out probe is itself wrong),
// or BOTH/ambiguous. Its verdict routes `reDispatchDecision` to re-author the right role (or escalate
// on `both`). Injectable end-to-end — tests wire `deps.judgeFailure` with a fake so no live model runs.

/**
 * Build the code-vs-test judge prompt (SP-6/7 AC4 + SP-6/9): given the failing unit + the failure
 * evidence + the slice's CONTRACT, ask a fresh INDEPENDENT session (it did NOT author the change) to
 * **TRIANGULATE** against the contract — the one artifact both hands built against, and therefore the
 * neutral arbiter — and attribute the fault to the code, the test, both, or the CONTRACT itself, in
 * machine-readable JSON with a rationale. It runs in the worktree so it may read BOTH the implementation
 * and the held-out probe before deciding. Each hand's conformance is judged against the contract, NOT by
 * comparing the two hands to each other. The contract is embedded VERBATIM; a blank/undefined contract
 * ⇒ the prompt notes none was supplied (and omits the verbatim block — nothing to triangulate against).
 * Pure.
 */
export function buildJudgePrompt(
  unit: Pick<SchedUnit, "id" | "slice" | "role">,
  failure: string,
  contract?: string,
): string {
  const hasContract = !!(contract && contract.trim());
  // The contract goes in VERBATIM (SP-6/9) — it is the arbiter, so the judge must see the exact seam,
  // not a paraphrase. Absent ⇒ say so and omit the verbatim block (there is nothing to triangulate on).
  const contractBlock = hasContract
    ? [
        "",
        "──── SLICE CONTRACT (the shared interface BOTH hands built against — the ARBITER; verbatim) ────",
        contract!.trim(),
        "──── end contract ────",
      ].join("\n")
    : "\n(No contract was supplied for this slice — you cannot TRIANGULATE against a contract that is absent; judge from the intent and the working tree, and do NOT return `contract`.)";
  return [
    "You are an INDEPENDENT judge for a FAILED acceptance verification of a software Spec.",
    "You did NOT implement the change and you did NOT author the test. A held-out acceptance probe",
    "(the TEST, authored black-box by a test-author) graded the implementation (the CODE, authored by a",
    "code-author) and it went RED.",
    "",
    "TRIANGULATE against the CONTRACT below — the one artifact BOTH hands built against, and therefore",
    "the neutral arbiter. Judge EACH hand's conformance against the CONTRACT ITSELF; do NOT decide by",
    "comparing the two hands to each other. Then attribute the fault:",
    "  - `code`     — the implementation diverges from the contract; the probe is correct. Re-author the CODE.",
    "  - `test`     — the probe asserts something the contract does NOT define, or contradicts it; the",
    "                 code conforms to the contract. Re-author the TEST.",
    "  - `contract` — BOTH hands conform to the contract, yet the red pivots on a seam the contract never",
    "                 defined (an arming mechanism, a constant, a state location, an observable effect the",
    "                 contract never named). The CONTRACT itself is incomplete — name the undefined seam",
    "                 in the rationale. (This routes the slice to a contract re-cut, not another guess.)",
    "  - `both`     — both are suspect, or you cannot single one out. (This escalates to a human.)",
    contractBlock,
    "",
    `Failing unit: ${unit.id} (slice ${unit.slice}${unit.role ? `, role ${unit.role}` : ""}).`,
    "",
    "Failure evidence:",
    (failure ?? "").trim() ||
      "(no evidence supplied — inspect the working tree)",
    "",
    "You may read the working tree (your cwd) to inspect BOTH the implementation and the probe, then",
    "TRIANGULATE each against the contract above.",
    "",
    "Respond with ONLY a JSON object (no prose, no markdown fence needed):",
    '  {"fault": "code", "rationale": "one or two sentences explaining the attribution"}',
  ].join("\n");
}

/**
 * Parse a judge session's reply into a {@link FailureJudgment} (SP-6/7 AC4 + SP-6/9). Tolerant of a
 * fence / surrounding prose: the last top-level JSON object with a `fault` of
 * `code`/`test`/`both`/`contract` and a `rationale`/`why`. Fail-safe: an unrecognised fault or
 * unparseable reply → `both` (which escalates to a human — never a silent mis-route), carrying the raw
 * reply as the rationale. Pure.
 */
export function parseJudgment(text: string): FailureJudgment {
  const obj = extractJsonObject(text);
  if (obj) {
    const rec = obj as Record<string, unknown>;
    const raw =
      typeof rec.fault === "string"
        ? rec.fault.trim().toLowerCase()
        : typeof rec.verdict === "string"
          ? rec.verdict.trim().toLowerCase()
          : "";
    const fault: Fault =
      raw === "code" || raw === "test" || raw === "both" || raw === "contract"
        ? raw
        : "both";
    const rationale =
      (typeof rec.rationale === "string" && rec.rationale.trim()) ||
      (typeof rec.why === "string" && rec.why.trim()) ||
      "";
    return {
      fault,
      rationale:
        rationale ||
        (raw && fault === "both" && raw !== "both"
          ? `unrecognised fault "${raw}" — escalating`
          : "(no rationale)"),
    };
  }
  return {
    fault: "both",
    rationale: `judge produced no parseable verdict: ${clipText((text ?? "").trim(), 200)}`,
  };
}

/**
 * The production {@link JudgeFailure} (SP-6/7 AC4): dispatch a headless, read-only Claude session in the
 * worktree that attributes a red acceptance run to the code or the test (or both) and returns the fault
 * + rationale. Built exactly like {@link createSdkAssessor} (the shared independent-judgment seam) and
 * equally failure-tolerant — a load/run error, a non-success result, or an unparseable reply all degrade
 * to a `both` (escalate) verdict with a rationale, never a thrown crash and never a silent mis-route.
 * SP-6/9: the returned judge forwards its `contract` argument to {@link buildJudgePrompt}, so the live
 * session triangulates the red against the slice's contract (and can return the `contract` fault).
 */
export function createSdkJudge(deps: SdkAssessorDeps): JudgeFailure {
  const log = deps.log ?? (() => {});
  const loadQuery =
    deps.loadQuery ??
    (async () =>
      (await import("@anthropic-ai/claude-agent-sdk"))
        .query as unknown as AssessorSdkQuery);
  return async (unit, failure, contract): Promise<FailureJudgment> => {
    const prompt = buildJudgePrompt(unit, failure, contract);
    let resultText = "";
    let assistantText = "";
    let sawSuccess = false;
    try {
      const query = await loadQuery();
      for await (const msg of query({
        prompt,
        // SP-17/1: pin the judge's model explicitly so it never inherits the session/env model.
        options: {
          cwd: deps.cwd,
          model: deps.model,
          permissionMode: "bypassPermissions",
        },
      })) {
        const rec = msg as Record<string, unknown>;
        const line = summarizeEvent(rec);
        if (line) log(`  [judge ${unit.id}] ${line}`);
        if (rec.type === "assistant") {
          const m = rec.message as { content?: unknown } | undefined;
          const content = Array.isArray(m?.content) ? m!.content : [];
          for (const b of content as Array<Record<string, unknown>>)
            if (b.type === "text" && typeof b.text === "string")
              assistantText += b.text;
        }
        if (rec.type === "result") {
          if (typeof rec.result === "string") resultText = rec.result;
          sawSuccess = isResultSuccess(rec);
        }
      }
    } catch (err) {
      return {
        fault: "both",
        rationale: `judge session failed: ${(err as Error).message}`,
      };
    }
    if (!sawSuccess)
      return {
        fault: "both",
        rationale: "judge session did not complete successfully",
      };
    return parseJudgment(resultText || assistantText);
  };
}

/** The auto-attend fixer seam (2026-07-11): given an escalated slice's intent
 *  + the judged fault/evidence, attempt ONE automated fix in the worktree and
 *  commit it to the spec branch. Returns whether the session completed (the
 *  closing gate re-run is the real verdict, not this boolean). */
export type AutoAttend = (
  slice: string,
  sliceIntent: string,
  diagnosis: string,
) => Promise<boolean>;

/** Build the auto-attend fixer prompt: full evidence, no blindfolds —
 *  grading independence lives in the assessor/judge, never in hiding the
 *  failure from the fixer. */
export function buildAutoAttendPrompt(
  slice: string,
  sliceIntent: string,
  diagnosis: string,
): string {
  return [
    `You are the AUTO-ATTEND fix agent for slice ${slice}. The orchestrator escalated it: bounded rework did not converge. You get ONE attempt before a human is asked.`,
    ``,
    `## The slice's intent`,
    sliceIntent || "(no slice body available — infer intent from the diagnosis and the code)",
    ``,
    `## What failed (judged fault + verbatim evidence)`,
    diagnosis,
    ``,
    `## Your job, in this worktree (your cwd)`,
    `1. Fix the divergence — smallest correct change; follow the evidence, not guesses.`,
    `2. Verify locally (compile/typecheck/tests relevant to the change).`,
    `3. Commit to the current branch: git add -A && git commit -m "fix(auto-attend): ${slice} <one-line summary>".`,
    `Rules: never push; never edit board/thinking-space files; if the failure is genuinely unfixable from this worktree (needs credentials, cluster state, a human decision), commit nothing and say so plainly.`,
  ].join("\n");
}

/** Default auto-attend fixer: a headless SDK session IN the worktree with edit
 *  capability (same bypassPermissions channel as workers). */
export function createSdkAutoAttend(deps: SdkAssessorDeps): AutoAttend {
  const log = deps.log ?? (() => {});
  const loadQuery =
    deps.loadQuery ??
    (async () =>
      (await import("@anthropic-ai/claude-agent-sdk"))
        .query as unknown as AssessorSdkQuery);
  return async (slice, sliceIntent, diagnosis): Promise<boolean> => {
    const prompt = buildAutoAttendPrompt(slice, sliceIntent, diagnosis);
    let sawSuccess = false;
    try {
      const query = await loadQuery();
      for await (const msg of query({
        prompt,
        options: {
          cwd: deps.cwd,
          model: deps.model,
          permissionMode: "bypassPermissions",
        },
      })) {
        const rec = msg as Record<string, unknown>;
        const line = summarizeEvent(rec);
        if (line) log(`  [auto-attend ${slice}] ${line}`);
        if (isResultSuccess(rec)) sawSuccess = true;
      }
    } catch (err) {
      log(`  [auto-attend ${slice}] session failed: ${(err as Error).message}`);
      return false;
    }
    return sawSuccess;
  };
}

// ── The code/test-author worker query seam (SP-17/1) ───────────────────────
//
// Extracted out of the private {@link OrchestratorService.runViaSdk} into an exported, vscode-free
// function mirroring {@link createSdkAssessor} / {@link createSdkJudge}, so a held-out probe can wire a
// fake `query` and assert on the `options` (chiefly `options.model`) WITHOUT constructing an
// `OrchestratorService` or provisioning a worktree. Like the assessor, its `model` is a REQUIRED dep
// spread into `options.model`, so the code/test-author worker never inherits the session/env model.

/** Deps for {@link createSdkWorker} — the per-worker spawn inputs `runViaSdk` supplies. `cwd` + `model`
 *  are required; `loadQuery` is injectable (a fake captures the options it is called with); the rest are
 *  production pass-throughs (`hooks` / `abortController` / `mcpServers` / `disallowedTools`) a probe may
 *  omit. */
export interface SdkWorkerDeps {
  /** Working directory for the headless worker session (the code/test worktree). */
  cwd: string;
  /** SP-17/1 — the pinned worker model spread into `options.model` so the worker never inherits the
   *  session/environment model (`ANTHROPIC_MODEL`). REQUIRED (omission is a compile error). */
  model: string;
  /** Loads the SDK `query`. Defaults to a lazy `import("@anthropic-ai/claude-agent-sdk")`; a test injects
   *  a fake that records the `options` it is called with. */
  loadQuery?: () => Promise<AssessorSdkQuery>;
  /** SDK `Options.hooks` (PreToolUse footprint guard + PostToolUse containment) — passed through verbatim
   *  when supplied; a probe may omit it. */
  hooks?: unknown;
  /** SDK `Options.abortController` — the run-wide hard-stop for a containment breach / HALT. */
  abortController?: AbortController;
  /** SDK `Options.mcpServers` — the in-process verify-oracle server for an oracle-armed code worker. */
  mcpServers?: Record<string, unknown>;
  /** SDK `Options.disallowedTools` — the role-scoped tool restriction (`disallowedToolsForRole`). */
  disallowedTools?: string[];
  /** Progress sink. Defaults to a no-op. */
  log?: (line: string) => void;
}

/** A lazy async-iterable worker: consuming its stream triggers the `query()` call (and thus the
 *  `options.model` capture). See {@link createSdkWorker}. */
export type RunWorker = (
  prompt: AsyncIterable<unknown>,
) => AsyncIterable<unknown>;

/**
 * The code/test-author worker query (SP-17/1) — extracted from {@link OrchestratorService.runViaSdk}.
 * Returns a LAZY {@link RunWorker}: it awaits `loadQuery()` and calls `query({ prompt, options })` only
 * ON FIRST ITERATION, where `options = { cwd, model: deps.model, permissionMode: "bypassPermissions",
 * disallowedTools, ...hooks/abortController/mcpServers }`. Because the query call (and the `options.model`
 * capture) fires only when the stream is consumed, a test asserting on the captured options must drive the
 * stream first (`for await (const _ of createSdkWorker(deps)(prompt)) {}`) then assert.
 */
export function createSdkWorker(deps: SdkWorkerDeps): RunWorker {
  const loadQuery =
    deps.loadQuery ??
    (async () =>
      (await import("@anthropic-ai/claude-agent-sdk"))
        .query as unknown as AssessorSdkQuery);
  return (prompt: AsyncIterable<unknown>): AsyncIterable<unknown> =>
    (async function* () {
      // Lazy: nothing is spawned until the caller consumes the stream — the query() call (and the
      // options.model capture) fires here on first iteration.
      const query = await loadQuery();
      const options: Record<string, unknown> = {
        cwd: deps.cwd,
        // SP-17/1: pin the worker's model explicitly so it never inherits the session/env model.
        model: deps.model,
        permissionMode: "bypassPermissions",
        disallowedTools: deps.disallowedTools,
        ...(deps.mcpServers ? { mcpServers: deps.mcpServers } : {}),
        ...(deps.abortController
          ? { abortController: deps.abortController }
          : {}),
        ...(deps.hooks !== undefined ? { hooks: deps.hooks } : {}),
      };
      for await (const msg of query({ prompt, options })) yield msg;
    })();
}

/**
 * Extract the acceptance-criterion text by 1-based ordinal from a Spec body (SP-6/7 AC3) — the
 * `intent` an assessor grades. Mirrors the `## Acceptance Criteria` checkbox parser used elsewhere so
 * the ordinals align with the grade. Pure.
 */
export function acTextByOrdinal(body: string): Map<number, string> {
  const out = new Map<number, string>();
  const m = /##\s*Acceptance Criteria\s*\n([\s\S]*?)(?=\n##\s|$)/i.exec(
    body ?? "",
  );
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s*[-*+]\s*\[[ xX]\]\s?(.*)$/.exec(line);
    if (!item) continue;
    out.set(out.size + 1, item[1].trim());
  }
  return out;
}

export class OrchestratorService {
  constructor(private readonly deps: OrchestratorDeps) {}

  /** Spec + slice **intent views** to embed in each worker's prompt — the worktree has no specs dir,
   *  so the worker can't read them from disk. The `## Acceptance Criteria` block + `satisfies` ordinals
   *  are stripped here in `loadPromptContext` (SP-6 AC1), so these strings are already exam-free. Loaded
   *  once per dispatchSpec. */
  private promptCtx: { specBody: string; sliceBodies: Map<string, string> } = {
    specBody: "",
    sliceBodies: new Map(),
  };

  /** Per-slice resume state read from frontmatter: whether a slice's units already
   *  landed (`units_landed`) and whether its work was already committed (`committed` / `commit_sha`).
   *  `resumeDecision` consults this so a re-run COMMITS a complete-but-uncommitted slice rather than
   *  re-authoring it (the frontier never re-dispatches a worker for it). Loaded once per dispatchSpec. */
  private sliceResumeState: Map<
    string,
    {
      unitsLanded: boolean;
      committed: boolean;
      /** Unit ids already checkpoint-committed (`units_done` frontmatter,
       *  2026-07-11) — re-dispatch schedules only units NOT in here, plus
       *  units implicated by `lastFault`. */
      unitsDone: string[];
      /** The judged fault persisted with the last requires-attention flag
       *  (`last_fault`) — the role whose checkpointed units must re-run. */
      lastFault?: string;
    }
  > = new Map();

  /** Per-slice failed-rework-attempt counter, read from the slice frontmatter (`rework_attempts`)
   *  in `buildSlices` and threaded onto `SchedulerState.attempts` so the bounded loop (SP-6/6 AC5)
   *  survives a reload: a slice's count carries ACROSS runs, each requires-attention run adding one.
   *  Loaded once per dispatchSpec. */
  private reworkAttempts: Map<string, number> = new Map();
  /** Per-slice normalized hash of the LAST failing evidence (frontmatter
   *  `last_evidence_hash`) — the identical-failure circuit breaker's memory. */
  private priorEvidenceHash: Map<string, string> = new Map();

  /** Slices the bounded loop already ESCALATED on a prior run (SP-6/6 AC5) — detected from the durable
   *  `escalated` frontmatter flag or the {@link ESCALATION_MARKER} on the body. Their units are blocked
   *  at seed time so `readyFrontier` never auto-re-dispatches them; only a human (clearing the marker)
   *  re-opens the loop. Loaded once per dispatchSpec. */
  private escalatedSlices: Set<string> = new Set();
  /** Live workers' abort controllers, keyed by unit id — a HALT aborts them all immediately
   *  (fast abort, 2026-07-08) instead of draining a doomed run at full token burn. */
  private liveAborts = new Map<string, AbortController>();

  /**
   * Fetch the parent spec doc + each slice body from the thinking space, to embed in worker prompts.
   *
   * **Intent view, exam held out (SP-6 AC1) — with the SP-6/7 role branch.** We store the **raw**
   * spec/slice bodies (ACs included) and let {@link buildWorkerPrompt} decide per unit: a `code` unit
   * gets the intent view (the `## Acceptance Criteria` block + `satisfies` ordinals stripped via the
   * core's pure {@link stripAcceptanceCriteria} / {@link stripSatisfies}) so it never reads the rubric
   * it is graded on; a `test` unit — the held-out verifier (SP-6/7 AC1) — KEEPS the ACs so its probe can
   * grade the exact criteria. Because the strip decision is role-dependent, it MUST live in the single
   * per-unit authority ({@link buildWorkerPrompt}); pre-stripping here would blind a test unit to the
   * ACs it must implement. (The slice still keeps `satisfies` orchestrator-internally — read from
   * frontmatter in `buildSlices`, never from this prose embedding — so the grader ticks the right
   * ordinals regardless.)
   */
  private async loadPromptContext(specNumber: string): Promise<void> {
    const { store } = this.deps;
    const sliceBodies = new Map<string, string>();
    let specBody = "";
    try {
      const specDoc = await store.getFile(store.pathForSpecDoc(specNumber));
      // Store the RAW body — `buildWorkerPrompt` applies the role-aware strip (code strips the ACs,
      // test keeps them). Pre-stripping here would deny a test unit the criteria it must grade.
      specBody = specDoc?.body ?? "";
      for (const rel of await store.listSlices(specNumber)) {
        const m = SLICE_REL_RE.exec(rel);
        if (!m) continue;
        const parsed = await store.getFile(rel);
        if (parsed?.body)
          sliceBodies.set(
            store.sliceHandle(specNumber, Number(m[2])),
            parsed.body,
          );
      }
    } catch {
      /* best-effort — a worker just falls back to its unit note without the embedded context */
    }
    this.promptCtx = { specBody, sliceBodies };
  }

  /** Read the Spec's slices into the DAG-builder input (frontmatter → SliceForDag). */
  private async buildSlices(specNumber: string): Promise<SliceForDag[]> {
    const { store } = this.deps;
    const slices: SliceForDag[] = [];
    this.sliceResumeState = new Map();
    this.reworkAttempts = new Map();
    this.priorEvidenceHash = new Map();
    this.escalatedSlices = new Set();
    for (const rel of await store.listSlices(specNumber)) {
      const m = SLICE_REL_RE.exec(rel);
      if (!m) continue;
      const parsed = await store.getFile(rel);
      const fm = parsed?.frontmatter;
      const handle = store.sliceHandle(specNumber, Number(m[3]));
      // Bounded rework loop (SP-6/6 AC5): re-seed the per-slice attempt counter + escalation state from
      // the durable frontmatter/body so a re-run continues the SAME bounded loop rather than restarting
      // it. `rework_attempts` carries the threaded count; `escalated` / the body marker mean the loop
      // already gave up — those units stay blocked (never auto-re-dispatched) until a human clears it.
      const priorAttempts = Number(fm?.rework_attempts);
      this.reworkAttempts.set(
        handle,
        Number.isFinite(priorAttempts) && priorAttempts > 0
          ? Math.floor(priorAttempts)
          : 0,
      );
      // Identical-failure circuit breaker (2026-07-11): re-seed the prior
      // failing-evidence hash so a re-run can detect "same failure, unchanged
      // inputs" and stop instead of burning the remaining attempts.
      if (typeof fm?.last_evidence_hash === "string" && fm.last_evidence_hash)
        this.priorEvidenceHash.set(handle, fm.last_evidence_hash);
      if (fm?.escalated === true || hasEscalationMarker(parsed?.body ?? ""))
        this.escalatedSlices.add(handle);
      // Resume markers: a prior run that landed the units but couldn't commit
      // stamps `units_landed: true` without a `commit_sha`; `resumeDecision` then COMMITS rather
      // than re-authoring it on the next run. `committed`/`commit_sha` mark an already-landed slice.
      this.sliceResumeState.set(handle, {
        unitsLanded: fm?.units_landed === true,
        committed:
          fm?.committed === true ||
          (typeof fm?.commit_sha === "string" && !!fm.commit_sha),
        unitsDone: Array.isArray(fm?.units_done)
          ? (fm.units_done as unknown[]).filter(
              (u): u is string => typeof u === "string",
            )
          : [],
        lastFault:
          typeof fm?.last_fault === "string" ? fm.last_fault : undefined,
      });
      slices.push({
        handle,
        status: String(fm?.status ?? "ready"),
        requires: Array.isArray(fm?.depends_on)
          ? (fm!.depends_on as string[])
          : [],
        files: Array.isArray(fm?.files) ? (fm!.files as string[]) : [],
        workUnits: Array.isArray(fm?.work_units)
          ? (fm!.work_units as (WorkUnit & { note?: string })[])
          : [],
        satisfies: Array.isArray(fm?.satisfies)
          ? (fm!.satisfies as number[]).filter(
              (n) => Number.isInteger(n) && n > 0,
            )
          : [],
        // SP-6/3: carry the slice's design-time contract so buildUnitDag stamps it onto every
        // SchedUnit and buildWorkerPrompt injects it into each worker (code + held-out test).
        contract: typeof fm?.contract === "string" ? fm.contract : undefined,
      });
    }
    return slices;
  }

  /**
   * Run the makespan scheduler over `specNumber`'s work-unit DAG: validate the DAG, then keep up
   * to `cap` workers saturated dispatching the ready, footprint-disjoint, critical-path frontier
   * (units pooled across slices). A failed unit or a needs-input worker flags its slice
   * `requires-attention`/`needs-input` during the run. When every slice's units have **landed**
   * (Spec quiescence) the **closing AI-verification gate** runs: the Spec's declared
   * per-AC verifications run as a full plan; a slice reaches Done only when the ACs it `satisfies`
   * all ran green (then those AC ordinals are ticked on the Spec); any red / un-runnable check
   * leaves its slice `requires-attention` (no skip). When the whole Spec is green it commits
   * **once**; the auditable per-AC report is written on every completion (pass or fail).
   *
   * **Run-halt policy (SP-2/TEP-6 AC5):** a systemic failure must not burn a whole doomed run.
   * A footprint VIOLATION (a containment hard-stop, threaded as `containment: true`, NOT a
   * reason-string match) halts on the FIRST one; an ordinary failure accrues a count and halts once
   * it reaches `failThreshold` (the `failThreshold` arg, else the injected dep, else
   * {@link DEFAULT_FAIL_THRESHOLD}). When halted, `fill()` stops pulling the ready frontier — NO new
   * units dispatch — and the loop drains the already-running units, then finalizes (report written,
   * Done slices committed/untouched) and returns. In-flight units are NOT killed; not-yet-dispatched
   * units are simply left ready for a later re-orchestrate (which re-dispatches requires-attention +
   * ready, skips Done).
   */
  async dispatchSpec(
    specNumber: string,
    cap: number,
    failThreshold?: number,
  ): Promise<SpecRunResult> {
    const { output } = this.deps;
    const result: SpecRunResult = {
      specNumber,
      ok: true,
      dispatched: 0,
      results: [],
      advanced: [],
      attention: [],
      escalated: [],
      needsInput: [],
      rolledBack: [],
      committed: false,
      acResults: [],
      verificationTrace: [],
      diagnosis: [],
      discoveries: [],
    };

    // RTK loud guard (SP-17/2): ALWAYS check the binary before any store slice listing or
    // buildSlices. RTK compression is mandatory — no setting gates it. Explicit and loud:
    // an absent binary refuses up front, never silently degrading to uncompressed output.
    {
      const binaryPresent =
        this.deps.rtkBinaryPresent ?? defaultRtkBinaryPresent;
      if (!(await binaryPresent())) {
        const reason =
          `rtk binary not found on PATH. RTK command-output compression is mandatory ` +
          `and the rtk binary must be installed as a provisioning precondition before ` +
          `orchestrating (see SP-3). Install the rtk binary, then re-run.`;
        output.appendLine(`✗ ${reason}`);
        return { ...result, ok: false, reason };
      }
    }

    // Superseded gate (SP-6/14, completing "a superseded Spec is not advanceable"):
    // orchestration is an advance path just like `create_slice`, so a non-empty
    // `superseded:` stamp refuses here — guarding the ACTION covers every entry point
    // (dashboard button, tree nav, command palette) at once. Reversible via
    // `unsupersede_spec`. Checked before any slice is built or worker dispatched.
    const specDoc = await this.deps.store.getFile(
      this.deps.store.pathForSpecDoc(specNumber),
    );
    const supersededStamp = specDoc?.frontmatter?.superseded;
    if (
      typeof supersededStamp === "string" &&
      supersededStamp.trim().length > 0
    ) {
      const reason =
        `SP-${specNumber} is superseded (${supersededStamp}) and cannot be orchestrated. ` +
        `Run unsupersede_spec ${specNumber} first if you mean to build it.`;
      output.appendLine(`✗ ${reason}`);
      return { ...result, ok: false, reason };
    }

    const slices = await this.buildSlices(specNumber);
    await this.loadPromptContext(specNumber);
    const dag = buildUnitDag(slices);

    // Deterministic gate: reject a malformed DAG before any worker runs.
    const v = validateDag(dag.map((u) => ({ id: u.id, requires: u.requires })));
    if (!v.ok) {
      output.appendLine(
        `✗ SP-${specNumber}: malformed DAG — not dispatched.\n${v.reason}`,
      );
      return { ...result, ok: false, reason: v.reason };
    }

    // Seed scheduler state from thinking space statuses.
    const unitsBySlice = new Map<string, SchedUnit[]>();
    for (const u of dag) {
      const arr = unitsBySlice.get(u.slice) ?? [];
      arr.push(u);
      unitsBySlice.set(u.slice, arr);
    }
    // AC5: the per-slice failed-attempt counter, threaded onto the scheduler so `readyFrontier` drops
    // every unit of a slice that has reached the rework bound. Cloned to a MUTABLE map (the readonly
    // `state.attempts` view is the same object) so `blockSlice` can bump a slice's count live and the
    // frontier sees the escalation take effect within the run, not only on the next reload.
    const attemptsMap = new Map<string, number>(this.reworkAttempts);
    const state: SchedulerState = {
      done: new Set(),
      running: new Set(),
      blocked: new Set(),
      attempts: attemptsMap,
      attemptBound: this.deps.attemptBound,
    };
    // Slices already Done on the thinking space (or advanced by this run's closing gate) — the **commit
    // gate** is "every slice Done". `landed` (below) tracks slices whose units all landed THIS
    // run; they only become Done once the closing AC-verification gate passes for their ACs.
    const doneSlices = new Set<string>();
    // Slices whose every unit landed this run — the candidates the closing gate verifies.
    const landed = new Set<string>();
    // Slices RESUMED this run: their units already landed in a prior run but were
    // never committed, so `resumeDecision` says COMMIT (not author). Their units are seeded done so
    // the frontier never re-dispatches a worker for them — the resume commits the present work.
    const resumeCommit = new Set<string>();
    for (const s of slices) {
      const st = s.status.toLowerCase();
      const ids = (unitsBySlice.get(s.handle) ?? []).map((u) => u.id);
      if (this.escalatedSlices.has(s.handle)) {
        // AC5: a slice the bounded loop already ESCALATED on a prior run stays requires-attention —
        // never auto-re-dispatched. Block its units so it's absent from the ready frontier (which also
        // drops it via `state.attempts` ≥ bound), leaving the human-cleared marker the only way back in.
        ids.forEach((id) => state.blocked.add(id));
        if (!result.escalated.includes(s.handle))
          result.escalated.push(s.handle);
        continue;
      }
      const rs = this.sliceResumeState.get(s.handle) ?? {
        unitsLanded: false,
        committed: false,
        unitsDone: [] as string[],
      };
      const decision = resumeDecision({
        status: s.status,
        unitsLanded: rs.unitsLanded,
        committed: rs.committed,
      });
      if (decision === "skip" || st === "done" || st === "archived") {
        // Already committed / Done / archived — nothing to do; mark done so dependents unblock.
        state.done.add(s.handle);
        doneSlices.add(s.handle);
        ids.forEach((id) => state.done.add(id));
      } else if (decision === "commit") {
        // Complete-but-uncommitted — RESUME: commit the already-present work WITHOUT re-authoring.
        // Seed its units done (so the frontier never re-dispatches them) and record it as a landed
        // candidate the closing gate verifies + the per-slice commit then lands.
        state.done.add(s.handle);
        ids.forEach((id) => state.done.add(id));
        landed.add(s.handle);
        resumeCommit.add(s.handle);
      } else if (st !== "ready" && st !== "requires-attention") {
        // `doing` (in-flight elsewhere) — not dispatchable, not done (deps wait). A
        // `requires-attention` slice IS re-dispatchable: clicking ▶ again retries it (the
        // human's re-run after looking), so it falls through into the ready frontier.
        ids.forEach((id) => state.blocked.add(id));
      } else if (rs.unitsDone.length) {
        // Checkpoint seeding (2026-07-11): units already checkpoint-committed
        // to the branch are DONE — the reset returns to their work, so a
        // re-dispatch never re-authors them from zero. Exception: units whose
        // role matches the judged `last_fault` of a requires-attention slice
        // re-run (FROM their checkpoint — the worktree keeps their files).
        const checkpointed = new Set(rs.unitsDone);
        const us = unitsBySlice.get(s.handle) ?? [];
        let allDone = us.length > 0;
        for (const u of us) {
          const implicated =
            st === "requires-attention" &&
            !!rs.lastFault &&
            (rs.lastFault === "code" || rs.lastFault === "test") &&
            (u.role ?? "code") === rs.lastFault;
          if (checkpointed.has(u.id) && !implicated) state.done.add(u.id);
          else allDone = false;
        }
        if (allDone) {
          // Verify-before-rework: every unit's work is already on the branch
          // (an attend/auto-attend fix, or a fault the judge didn't attribute
          // to any unit's role). Grade the CURRENT state with ZERO workers —
          // the closing gate decides; only a red re-enters rework.
          state.done.add(s.handle);
          landed.add(s.handle);
          output.appendLine(
            `▸ ${s.handle}: all units checkpointed → verify-before-rework (graded as-is, no workers spawned).`,
          );
        }
      }
    }
    const remaining = new Map<string, number>();
    for (const [slice, us] of unitsBySlice) {
      if (state.done.has(slice)) continue;
      const rem = us.filter(
        (u) => !state.done.has(u.id) && !state.blocked.has(u.id),
      ).length;
      if (rem > 0) remaining.set(slice, rem);
    }
    if (readyFrontier(dag, state).length === 0 && resumeCommit.size === 0) {
      output.appendLine(`▸ SP-${specNumber}: nothing ready to dispatch.`);
      return result;
    }

    const worktreePath = await this.deps.worktrees.create(
      this.deps.canonicalRepo,
      specNumber,
      this.deps.baseDir,
      this.deps.thinkingSpaceRoot,
      undefined, // approvalDir — self-located by the server (SP-6/17), not injected
      (l) => this.deps.output.appendLine(l), // SP-17/1: surface a stale-base refresh / halt
    );
    // Worktree lifecycle (SP-6/7): a (re)dispatched Spec starts from a CLEAN tree — uncommitted
    // leftovers of a prior run (a stale impl authored under an old contract, half-landed units)
    // must never be graded as this run's work. Committed slices live on the branch and survive
    // the reset. Guarded: skip when a session for this Spec is still live (a resident parked
    // worker's in-flight edits) or a slice claims resume-commit (its uncommitted work is about
    // to be landed, not re-authored).
    const [wtTep, wtSp] = specNumber.split("/");
    const specUnitPrefix = wtSp
      ? `TEP-${wtTep}_SP-${wtSp}_`
      : `SP-${specNumber}_`;
    const specInFlight = runningSessions().some((id) =>
      id.startsWith(specUnitPrefix),
    );
    if (!specInFlight && resumeCommit.size === 0) {
      try {
        await this.deps.worktrees.reset?.(
          worktreePath,
          this.deps.thinkingSpaceRoot,
        );
        output.appendLine(
          `▸ SP-${specNumber}: worktree reset to the branch's committed state (fresh run).`,
        );
      } catch (err) {
        output.appendLine(
          `▸ SP-${specNumber}: worktree reset skipped (${(err as Error).message}).`,
        );
      }
    }
    // Structural independence (SP-6/7): `role: test` units run in the Spec's TESTER worktree — a
    // detached snapshot at the branch's committed HEAD, where the code workers' in-progress
    // modifications simply do not exist. Created/re-snapshotted per run; the finished probes are
    // copied into the code worktree before the closing gate runs them.
    let testerPath: string | undefined;
    if (dag.some((u) => (u.role ?? "code") === "test")) {
      try {
        testerPath = await this.deps.worktrees.createTester?.(
          this.deps.canonicalRepo,
          specNumber,
          this.deps.baseDir,
        );
      } catch (err) {
        output.appendLine(
          `▸ SP-${specNumber}: tester worktree unavailable (${(err as Error).message}) — test units will run in the code worktree.`,
        );
      }
      if (testerPath)
        output.appendLine(
          `▸ SP-${specNumber}: tester snapshot at ${testerPath} (base commit; implementation-in-progress absent by construction).`,
        );
    }

    // ── The black-box verify oracle (tests-first repair, 2026-07-08) ─────────
    // A slice's coder verifies exclusively through an orchestrator-mediated `verify` tool:
    // its current worktree delta + the tester-owned probes are compiled together in an
    // ISOLATED runner (a second detached snapshot, provisioned with the canonical repo's
    // node_modules) and the structured results come back — never the probe source. Built
    // lazily per slice, and FAIL-SOFT: when anything it needs is missing (no tester, no
    // recipe, no runnable verifications, no probe files) the coder simply runs without the
    // tool, exactly as before.
    const specVerifs = parseAcVerifications(
      specDoc?.frontmatter?.ac_verifications,
    );
    const oracleCache = new Map<string, Promise<VerifyOracle | undefined>>();
    const oracleFor = (
      sliceHandle: string,
    ): Promise<VerifyOracle | undefined> => {
      let p = oracleCache.get(sliceHandle);
      if (!p) {
        p = this.buildSliceOracle({
          sliceHandle,
          specNumber,
          worktreePath,
          testerPath,
          slices,
          unitsBySlice,
          verifs: specVerifs,
          log: (l) => output.appendLine(l),
        });
        oracleCache.set(sliceHandle, p);
      }
      return p;
    };

    const limit = Math.max(1, Math.floor(cap));
    output.appendLine(
      `▸ SP-${specNumber}: scheduling ${dag.length} unit(s) over cap ${limit} in ${worktreePath}`,
    );

    const footprintsOf = new Map<string, string[]>(
      dag.map((u) => [u.id, u.footprint]),
    );
    // AC4 (SP-2/TEP-6): the run's containment territory is the UNION of every dispatched unit's
    // declared footprint — computed once for the whole run (static, deterministic). The post-tool
    // whole-tree backstop in `runViaSdk` cannot attribute a shared-tree change to a unit, so it
    // refuses ONLY a change outside this union. A sibling's in-footprint change is in the union
    // whether that sibling is still running OR has already finished — which fixes the SP-6 failure
    // where a FINISHED sibling's legitimate change was misattributed to a running unit and reverted.
    // SP-6/7: role-resolve each unit's footprint into the union — a `code` unit contributes NO
    // acceptance path (resolveRoleFootprint strips it), a `test` unit contributes its held-out probe.
    // So the union's acceptance paths come ONLY from their real role:test owners: sibling probes stay
    // exempt (concurrent held-out authors don't revert each other) while a code-author's acceptance
    // write — even one it brazenly declared in footprint — is NOT in the union and is caught.
    const unionFootprint = [
      ...new Set(dag.flatMap((u) => resolveRoleFootprint(u.role, u.footprint))),
    ];
    const running = new Map<string, Promise<UnitDone>>();
    const parked = new Set<string>(); // dispatched but suspended awaiting an answer (off the cap)
    let wake: () => void = () => {};
    let wakeSignal = new Promise<void>((r) => (wake = r));
    const activeCount = () => running.size - parked.size;

    // Run-halt policy (SP-2/TEP-6 AC5): a footprint VIOLATION halts on the first one; ordinary
    // failures accrue and halt once they reach `threshold`. Once `halt` is set, `fill()` stops
    // pulling the ready frontier (no new dispatch) — the loop only drains the in-flight units.
    const threshold = Math.max(
      1,
      Math.floor(
        failThreshold ?? this.deps.failThreshold ?? DEFAULT_FAIL_THRESHOLD,
      ),
    );
    let failCount = 0;
    let halt = false;

    // Resident needs-input park (SL-3): free the worker's slot + register its LIVE session so
    // `/attend` can push the answer in, but keep it alive (its promise resolves on the answered
    // continuation). Distinct from the exit-model `needs-input` outcome (a runUnit that RETURNS it)
    // handled in the loop below; here the worker never resolved — it's suspended mid-stream.
    const onPark: OnPark = (u, question, answer) => {
      (footprintsOf.get(u.id) ?? []).forEach((f) => state.running.delete(f));
      parked.add(u.id);
      parkWorker(u.id, u.slice, question, answer);
      if (!result.needsInput.includes(u.slice)) result.needsInput.push(u.slice);
      void this.flagNeedsInput(u.slice, question, undefined, u.id);
      output.appendLine(
        `❓ ${u.slice}: ${u.id} asked a question → parked resident (slot freed, awaiting /attend).`,
      );
      wake();
    };

    const fill = () => {
      // Run halted (SP-2/TEP-6 AC5): stop pulling the ready frontier — dispatch NO new units. The
      // already-running units drain in the loop below; the not-yet-dispatched ones stay ready for a
      // later re-orchestrate. We never kill an in-flight unit.
      if (halt) return;
      for (const u of readyFrontier(dag, state)) {
        if (activeCount() >= limit) break;
        if (running.has(u.id)) continue;
        // `state.running` (the live footprints of running units) still drives the scheduler's
        // footprint-disjoint frontier selection in `readyFrontier`; the post-tool containment
        // backstop no longer reads it — it screens against the run-level `unionFootprint` instead.
        u.footprint.forEach((f) => state.running.add(f));
        running.set(
          u.id,
          // AC4: thread the run-level UNION of every dispatched unit's footprint (computed once
          // above). The post-tool whole-tree backstop refuses only a change OUTSIDE this union —
          // a sibling's in-footprint change (running OR finished) is always in the union, so it is
          // never misattributed to this unit and reverted (the SP-6 mutual-destruction fix).
          // SP-6/7 structural independence: a `role: test` unit's cwd is the TESTER snapshot —
          // the in-progress implementation is not in its tree, by construction.
          this.dispatchUnit(
            u,
            specNumber,
            (u.role ?? "code") === "test" && testerPath
              ? testerPath
              : worktreePath,
            onPark,
            unionFootprint,
            oracleFor,
          ),
        );
        result.dispatched++;
        output.appendLine(
          `▸ ${u.id} [${u.shape}] dispatched (${activeCount()}/${limit})`,
        );
      }
    };

    // AC5: a slice is counted at most ONCE per run — a run is one rework attempt — so a second
    // requires-attention path on the same slice (e.g. closing gate then finalization wedge) never
    // double-bumps the bounded counter.
    const countedThisRun = new Set<string>();
    // Auto-attend inputs (2026-07-11): each blocked slice's full diagnosis, so
    // the one-shot fixer gets the judged fault + evidence verbatim.
    const sliceDiagnoses = new Map<string, string>();
    const blockSlice = async (
      slice: string,
      diagnosis: string,
      fault?: Fault,
      // Raw failing evidence for the identical-failure circuit breaker
      // (2026-07-11). Hashed NORMALIZED (volatile fragments stripped) and
      // compared against the prior attempt's persisted hash: identical ⇒ a
      // re-dispatch would re-run unchanged inputs, so escalate immediately.
      // Deliberately the raw evidence, not the diagnosis — the judge's
      // rationale varies between runs and would defeat the comparison.
      evidenceForHash?: string,
    ) => {
      if (countedThisRun.has(slice)) return;
      countedThisRun.add(slice);
      sliceDiagnoses.set(slice, diagnosis);
      // Bounded re-dispatch (SP-6/6 AC5) + code-vs-test routing (SP-6/7 AC4): this requires-attention is
      // one failed acceptance/rework attempt. The PURE, no-LLM decision increments the per-slice counter
      // and, given the judged `fault` (from the injectable `judgeFailure`, when the caller supplied one),
      // decides re-dispatch-vs-escalate AND the re-dispatch ROUTE: the code-author unit for a `code`
      // fault, the test-author unit for a `test` fault, or ESCALATE on `both`/at the bound. On escalate
      // the slice stays requires-attention with the durable ESCALATION_MARKER and `readyFrontier` (now
      // reading the bumped `attemptsMap`) stops auto-re-dispatching it — a human must decide. The counter
      // is persisted to frontmatter so the loop carries across runs.
      const evidenceHash = evidenceForHash?.trim()
        ? normalizeEvidenceHash(evidenceForHash)
        : undefined;
      const verdict = reDispatchDecision(
        attemptsMap.get(slice) ?? 0,
        state.attemptBound,
        fault,
        {
          hash: evidenceHash,
          priorHash: this.priorEvidenceHash.get(slice),
        },
      );
      attemptsMap.set(slice, verdict.attempts);
      if (evidenceHash) this.priorEvidenceHash.set(slice, evidenceHash);
      const escalate = verdict.action === "escalate";
      await this.flagAttention(
        slice,
        verdict.deterministic
          ? `${DETERMINISTIC_FAILURE_MARKER}\n${diagnosis}`
          : diagnosis,
        {
          attempts: verdict.attempts,
          escalated: escalate,
          evidenceHash,
          fault,
        },
      );
      // Route the re-dispatch (AC4): on escalate or an unrouted failure, block EVERY unit of the slice.
      // On a routed re-dispatch, block only the SIBLING role's units so the frontier re-authors just the
      // faulting role — the code-author for a `code` route, the test-author for a `test` route.
      const units = unitsBySlice.get(slice) ?? [];
      const route = verdict.route;
      if (escalate || !route) {
        units.forEach((u) => state.blocked.add(u.id));
      } else {
        units
          .filter((u) => (u.role ?? "code") !== route)
          .forEach((u) => state.blocked.add(u.id));
        output.appendLine(
          `↻ ${slice}: fault routed to the ${route}-author — re-dispatching its unit(s), holding the ${route === "code" ? "test" : "code"}-author.`,
        );
      }
      remaining.delete(slice);
      result.attention.push(slice);
      if (escalate) {
        this.escalatedSlices.add(slice);
        if (!result.escalated.includes(slice)) result.escalated.push(slice);
        // SP-6/9: a `contract` escalation is a DESIGN defect (the contract is incomplete), not exhausted
        // attempts — its own human-facing line so the operator routes it to a contract re-cut, not a
        // re-run. No attempt was burned (verdict.attempts is unchanged), so it names the seam instead.
        output.appendLine(
          fault === "contract"
            ? `⛔ ${slice}: contract defect — both hands conform yet disagree on an undefined seam → held for a contract re-cut (no rework attempt burned), awaiting the slicer.`
            : fault === "gate"
              ? `⛔ ${slice}: gate defect — the verification probe cannot run and re-authoring did not heal it → escalated (no rework attempt burned); fix the probe/environment, not the slice.`
              : verdict.deterministic
                ? `⛔ ${slice}: deterministic failure — identical evidence to the prior attempt (inputs unchanged) → escalated at attempt ${verdict.attempts} without burning the rest of the bound.`
                : `⛔ ${slice}: bounded rework attempts exhausted (${verdict.attempts})${fault === "both" ? " / fault ambiguous (both code and test)" : ""} → escalated, awaiting a human decision.`,
        );
      }
    };

    fill();
    while (running.size > 0) {
      // Race worker completions against a park-wake (a freed slot with no completion, so we
      // re-fill). If only parked workers remain, the loop waits here for `/attend` to answer them.
      const winner = await Promise.race<
        { kind: "done"; d: UnitDone } | { kind: "wake" }
      >([
        ...[...running.values()].map((p) =>
          p.then((d) => ({ kind: "done" as const, d })),
        ),
        wakeSignal.then(() => ({ kind: "wake" as const })),
      ]);
      if (winner.kind === "wake") {
        wakeSignal = new Promise<void>((r) => (wake = r));
        fill();
        continue;
      }
      const d = winner.d;
      running.delete(d.id);
      parked.delete(d.id);
      unparkWorker(d.id);
      (footprintsOf.get(d.id) ?? []).forEach((f) => state.running.delete(f));
      result.results.push({ id: d.id, slice: d.slice, outcome: d.outcome });

      // SP-11/3: collect this unit's out-of-scope findings — the list items under a trailing
      // `## Discoveries` heading in its final output — verbatim, pairing each with the unit id (the
      // declared discovery channel; no model-side summarizing between worker and report). Independent
      // of outcome: a unit that failed may still have surfaced a real finding worth reporting.
      if (d.finalOutput)
        for (const text of extractDiscoveries(d.finalOutput))
          result.discoveries.push({ unit: d.id, text });

      if (d.outcome === "needs-input") {
        // Non-resident needs-input: a worker that RETURNED a question instead of parking its live
        // session. runViaSdk parks resident via onPark and never returns this; this branch covers a
        // runUnit seam (tests) / a future exit-model runner. No live session to feed → flag via the
        // thinking space for resume-by-session-id (/attend fallback).
        await this.flagNeedsInput(
          d.slice,
          d.question ?? "(no question text)",
          d.sessionId,
          d.id,
        );
        (unitsBySlice.get(d.slice) ?? []).forEach((u) =>
          state.blocked.add(u.id),
        );
        remaining.delete(d.slice);
        if (!result.needsInput.includes(d.slice))
          result.needsInput.push(d.slice);
        output.appendLine(
          `❓ ${d.slice}: ${d.id} asked a question → needs-input (slot freed).`,
        );
      } else if (d.outcome === "failed") {
        // A footprint-containment hard-stop (SP-6/2 AC3) carries its own diagnosis naming the
        // offending out-of-footprint path; otherwise fall back to the generic exit message.
        await blockSlice(
          d.slice,
          d.attention ??
            `Worker for ${d.id} exited without success — see the session JSON-log.`,
        );
        output.appendLine(`⚑ ${d.slice}: ${d.id} failed → requires-attention.`);
        // Run-halt policy (SP-2/TEP-6 AC5). A footprint VIOLATION (the containment hard-stop, flagged
        // by the clean `containment` boolean — NOT a reason-string match) halts on the FIRST one: a
        // breach is systemic, not isolated. An ordinary failure accrues a count and halts once it
        // reaches the threshold N. Once halted, `fill()` (below) stops dispatching new units; the loop
        // drains the in-flight ones, then finalizes + returns. In-flight units are never killed.
        if (!halt) {
          // Fast abort (2026-07-08): on halt, ABORT every in-flight worker's SDK query
          // immediately — a doomed run must not keep burning tokens while it "drains".
          // The aborted workers surface as non-success and the loop still collects them.
          const abortInFlight = () => {
            for (const [id, ac] of this.liveAborts) {
              ac.abort();
              output.appendLine(`■ aborting in-flight ${id}`);
            }
          };
          if (d.containment) {
            halt = true;
            output.appendLine(
              `■ SP-${specNumber}: footprint violation in ${d.id} → run halted (no new units dispatched; aborting ${activeCount()} in-flight).`,
            );
            abortInFlight();
          } else if (++failCount >= threshold) {
            halt = true;
            output.appendLine(
              `■ SP-${specNumber}: ${failCount} unit failure(s) reached the halt threshold (${threshold}) → run halted (no new units dispatched; aborting ${activeCount()} in-flight).`,
            );
            abortInFlight();
          }
        }
      } else {
        state.done.add(d.id);
        markUnitDone(d.id); // graph: show this worker's node done (lime) until re-dispatch
        // Checkpoint (2026-07-11): commit the landed unit's footprint NOW so a
        // later reset returns TO this work instead of deleting it — completed
        // units survive every re-dispatch; only unfinished/implicated units
        // re-run (and rework starts from the checkpoint, not from zero).
        await this.checkpointUnit(
          worktreePath,
          d.slice,
          d.id,
          (unitsBySlice.get(d.slice) ?? []).find((u) => u.id === d.id)
            ?.footprint ?? [],
        );
        const rem = (remaining.get(d.slice) ?? 1) - 1;
        remaining.set(d.slice, rem);
        if (rem <= 0) {
          // Slice's units all LANDED. No per-slice verify any more — verification is the Spec's
          // declared per-AC plan, run once at quiescence (the closing gate below). Mark the slice
          // done for SCHEDULING (so dependents unblock) and record it as a gate candidate; it only
          // becomes Done-on-the-thinking space when the closing gate passes for the ACs it satisfies.
          state.done.add(d.slice);
          landed.add(d.slice);
          remaining.delete(d.slice);
          output.appendLine(
            `✓ ${d.slice}: all units landed (verification deferred to the closing gate).`,
          );
        }
      }
      fill();
    }

    // ── Closing AI-verification gate ──────────────
    // At Spec quiescence — every slice's units landed (none failed / parked / blocked) — run the
    // Spec's DECLARED per-AC verifications as one full plan. The gate returns the landed slices that
    // are AC-green (→ their satisfied ordinals); a red / un-runnable slice is flagged
    // requires-attention in place. The green slices are the input to the per-slice commit below.
    const everyLanded = slices.every(
      (s) => doneSlices.has(s.handle) || landed.has(s.handle),
    );
    const greenByGate = new Map<string, number[]>();
    if (everyLanded && landed.size > 0) {
      const green = await this.runClosingGate(
        specNumber,
        worktreePath,
        slices,
        landed,
        unitsBySlice,
        state,
        blockSlice,
        result,
        testerPath,
      );
      for (const [h, ords] of green) greenByGate.set(h, ords);

      // ── Auto-attend (2026-07-11): fix first, ask a human second ──────────
      // A slice the gate just ESCALATED gets ONE automated fix attempt before
      // any human sees requires-attention: a headless fixer session in the
      // worktree, primed with the slice's intent + the judged fault and
      // verbatim evidence (no blindfolds — grading independence lives in the
      // assessor/judge, never in hiding the failure from the fixer). It
      // commits `fix(auto-attend): …` to the spec branch; the gate then
      // re-runs ONCE to grade the fix (countedThisRun prevents any double
      // attempt-burn on a still-red slice). Only a still-red slice stays
      // escalated for the human. Gate defects that self-healing couldn't fix
      // are exempt — a probe/environment defect is not fixable from the code
      // worktree, so the fixer isn't burned on it.
      const toAutoAttend = result.escalated.filter(
        (h) => !sliceDiagnoses.get(h)?.startsWith(GATE_DEFECT_MARKER),
      );
      if (toAutoAttend.length > 0) {
        const fixer =
          this.deps.autoAttend ??
          createSdkAutoAttend({
            cwd: worktreePath,
            model: resolveWorkerModel(this.deps.workerModel, "attend"),
            log: (l) => output.appendLine(l),
          });
        let fixedAny = false;
        for (const h of toAutoAttend) {
          output.appendLine(
            `▸ ${h}: auto-attend — one automated fix attempt before asking a human.`,
          );
          try {
            const ok = await fixer(
              h,
              this.promptCtx.sliceBodies.get(h) ?? "",
              sliceDiagnoses.get(h) ?? "(no diagnosis recorded)",
            );
            if (ok) fixedAny = true;
            else
              output.appendLine(
                `⚑ ${h}: auto-attend session did not complete — left for a human.`,
              );
          } catch (err) {
            output.appendLine(
              `⚑ ${h}: auto-attend failed (${(err as Error).message}) — left for a human.`,
            );
          }
        }
        if (fixedAny) {
          output.appendLine(
            `▸ SP-${specNumber}: re-running the closing gate to grade the auto-attend fix(es).`,
          );
          const regraded = await this.runClosingGate(
            specNumber,
            worktreePath,
            slices,
            landed,
            unitsBySlice,
            state,
            blockSlice,
            result,
            testerPath,
          );
          for (const [h, ords] of regraded) {
            greenByGate.set(h, ords);
            // The fix landed green: the slice leaves the escalated state it
            // entered minutes ago — no human attention needed after all.
            this.escalatedSlices.delete(h);
            result.escalated = result.escalated.filter((x) => x !== h);
            result.attention = result.attention.filter((x) => x !== h);
            output.appendLine(`✓ ${h}: auto-attend fix graded green.`);
          }
        }
      }
    } else if (landed.size > 0) {
      output.appendLine(
        `▸ SP-${specNumber}: paused — ${result.attention.length} need attention / ${result.needsInput.length} need input; closing gate not run, nothing committed.`,
      );
    }

    // ── Per-slice commit-before-Done ──────
    // No more all-or-nothing commit. `commitPlan` is the per-slice decision: only landed ∧ gate-green
    // slices are eligible to commit-then-Done. We commit each slice BEFORE marking it Done; a slice
    // whose git commit FAILS rolls back to `ready` (the commit-failure protocol) and is NOT advanced —
    // so no slice ever ends Done with uncommitted work. A partial-gate / partial-commit failure thus
    // commits the slices that passed and rolls the rest back, rather than freezing them Done.
    const outcomes: SliceOutcome[] = slices
      .filter((s) => greenByGate.has(s.handle))
      .map((s) => ({ handle: s.handle, unitsLanded: true, gatePassed: true }));
    const plan = commitPlan(outcomes);
    const checkedOrdinals: number[] = [];
    for (const handle of plan.commit) {
      try {
        // commit-before-Done: the commit must succeed before the slice can be advanced.
        await this.commit(handle, specNumber, worktreePath);
      } catch (err) {
        // Commit-failure protocol: roll this slice back to `ready` (NOT Done) so a later run
        // re-attempts (or resumes) it; block its units this run so nothing else lands on it.
        await this.rollbackToReady(handle);
        result.rolledBack.push(handle);
        (unitsBySlice.get(handle) ?? []).forEach((u) =>
          state.blocked.add(u.id),
        );
        output.appendLine(
          `⚑ ${handle}: commit failed → rolled back to ready (not Done) — ${(err as Error).message}`,
        );
        continue;
      }
      doneSlices.add(handle);
      await this.advance(handle);
      result.advanced.push(handle);
      checkedOrdinals.push(...(greenByGate.get(handle) ?? []));
      output.appendLine(`✓ ${handle}: committed → Done.`);
    }

    // Tick exactly the satisfied AC ordinals of the COMMITTED slices on the Spec (so the accept gate
    // — every AC checked — can pass). One write with the union; out-of-range/checked are no-ops.
    const ordinals = [...new Set(checkedOrdinals)].sort((a, b) => a - b);
    if (ordinals.length) {
      await this.checkAcs(specNumber, ordinals);
      output.appendLine(
        `▸ SP-${specNumber}: checked AC ${ordinals.map((n) => `#${n}`).join(", ")} on the Spec.`,
      );
    }

    // The whole Spec is committed iff every slice ended Done (each via its own successful commit).
    const allDone = slices.every((s) => doneSlices.has(s.handle));
    result.committed = allDone && landed.size > 0;
    if (result.committed) {
      output.appendLine(`✓ SP-${specNumber}: every slice committed → Done.`);
    } else if (landed.size > 0) {
      output.appendLine(
        `⚑ SP-${specNumber}: Spec not fully committed — ${result.attention.length} requires-attention, ${result.rolledBack.length} rolled back.`,
      );
    }

    // Write the delivery report whenever any unit landed OR the run was HALTED (SP-2/TEP-6 AC5):
    // a halt must still leave the audit trail (the caught failures + the in-flight units it drained)
    // even when nothing landed, so the human re-orchestrating sees why the run stopped.
    if (landed.size > 0 || halt) {
      result.deliveryDoc = await this.writeDeliverySummary(
        specNumber,
        worktreePath,
        result,
        dag,
      );
    }

    // ── Finalization watchdog ────────────
    // A run can land every unit and then silently wedge: the finalize tail above (commit, write
    // DELIVERY.md, advance the slice off `ready`) believed it ran, but a marker is actually absent
    // — no real commit SHA, no report on disk — so the work sits done-but-uncommitted and the loop
    // would otherwise stall without surfacing anything. We consult the pure `finalizationVerdict`
    // ONLY at a clean quiescence (no slice flagged attention / needs-input / rolled back this run):
    // there the run BELIEVED it finalized, so any missing marker is a genuine wedge — not a normal
    // pause at the closing gate, and not an EXPLICIT per-slice commit rollback,
    // which is a handled outcome the slice already moved back to `ready` for, not a silent wedge.
    // A `{ wedged }` verdict surfaces the affected slices Requires-attention with the exported
    // diagnosis so a human (or a re-run) picks it up instead of a silent loop.
    let wedged = false;
    const cleanQuiescence =
      result.dispatched > 0 &&
      result.attention.length === 0 &&
      result.needsInput.length === 0 &&
      result.rolledBack.length === 0;
    if (cleanQuiescence && everyLanded && landed.size > 0) {
      const finalizeState: FinalizationState = {
        unitsAllDone: true,
        committedSha: result.committed
          ? await this.gitShortSha(worktreePath)
          : "",
        deliveryWritten: !!result.deliveryDoc,
        slicesStillReady: slices
          .filter((s) => landed.has(s.handle) && !doneSlices.has(s.handle))
          .map((s) => s.handle),
      };
      const verdict = finalizationVerdict(finalizeState);
      if (typeof verdict !== "string") {
        wedged = true;
        // The run never truly finalized — don't let `committed` (set optimistically above) hide it.
        result.committed = false;
        output.appendLine(
          `⚑ SP-${specNumber}: finalization watchdog — ${FINALIZATION_WEDGED_DIAGNOSIS}. ${verdict.wedged}`,
        );
        for (const s of slices) {
          if (!landed.has(s.handle)) continue;
          await blockSlice(s.handle, verdict.wedged);
          output.appendLine(
            `⚑ ${s.handle}: units landed but the run never finalized → requires-attention.`,
          );
        }
      }
    }

    // Tear down only a fully-committed Spec (its branch persists for accept); a stalled or wedged
    // Spec keeps its worktree for the human's re-run / `/attend`. Always drop leftover parked agents.
    if (result.committed && !wedged) {
      for (const u of dag) unparkWorker(u.id);
      try {
        await this.teardown(specNumber);
        output.appendLine(
          `▸ SP-${specNumber}: worktree closed (branch kept for accept).`,
        );
      } catch (err) {
        output.appendLine(
          `▸ SP-${specNumber}: worktree teardown skipped — ${(err as Error).message}`,
        );
      }
    }
    return result;
  }

  /**
   * The closing AI-verification gate: run the Spec's declared `ac_verifications` as a
   * full plan against the worktree, then classify each landed slice as **AC-green** iff the ACs it
   * `satisfies` all ran green. Returns a map of the green slices → the AC ordinals they satisfy (the
   * input to the per-slice commit-before-Done step, which commits then advances + ticks those
 * ordinals ). No skip: a Spec with no declaration (or a red / un-runnable check)
   * leaves the affected slices `requires-attention` in place (not green, never returned). The per-AC
   * results land on `result.acResults` (and the auditable report). Mutates `state` / `result`; does
   * NOT advance / commit / check ordinals — that is the caller's per-slice commit responsibility.
   */
  private async runClosingGate(
    specNumber: string,
    worktreePath: string,
    slices: SliceForDag[],
    landed: Set<string>,
    unitsBySlice: Map<string, SchedUnit[]>,
    state: SchedulerState,
    blockSlice: (
      slice: string,
      diagnosis: string,
      fault?: Fault,
      evidenceForHash?: string,
    ) => Promise<void>,
    result: SpecRunResult,
    testerPath?: string,
  ): Promise<Map<string, number[]>> {
    const { output, store } = this.deps;
    const green = new Map<string, number[]>();
    const specDoc = await store.getFile(store.pathForSpecDoc(specNumber));
    // `let`: the gate self-heal below may replace the plan with re-authored probes.
    let verifs = parseAcVerifications(specDoc?.frontmatter?.ac_verifications);

    // SP-6/7 structural independence: the held-out probes were authored in the TESTER snapshot —
    // merge them into the code worktree so the gate grades the real implementation with them.
    // Copy exactly the test units' declared footprints (nothing else can cross over).
    if (testerPath && testerPath !== worktreePath) {
      const probeFiles = [
        ...new Set(
          [...unitsBySlice.values()]
            .flat()
            .filter((u) => (u.role ?? "code") === "test")
            .flatMap((u) => u.footprint ?? [])
            .map(normalizeFilePath),
        ),
      ];
      let copied = 0;
      for (const rel of probeFiles) {
        try {
          const src = path.join(testerPath, rel);
          const dst = path.join(worktreePath, rel);
          await fs.promises.mkdir(path.dirname(dst), { recursive: true });
          await fs.promises.copyFile(src, dst);
          copied++;
        } catch {
          // Absent probe (its unit failed / not authored) — the gate's missing-AC path reports it.
        }
      }
      if (copied > 0)
        output.appendLine(
          `▸ SP-${specNumber}: merged ${copied} acceptance test(s) from the tester snapshot into the code worktree.`,
        );
    }

    // Build gate (SP-6/7): the repo's declared `acceptanceProbe.prepare` (conventions.json) runs
    // ONCE before the per-AC commands — e.g. compile the test tree so `node --test out-test/…`
    // has its input. A failure is a real red (the assembled slice does not build): every landed
    // slice goes requires-attention with the compiler output. Tech-agnostic: no `prepare`
    // declared ⇒ nothing runs.
    // The recipe is resolved against the CANONICAL repo first: the verification recipe is the
    // repo's CURRENT convention (orchestrator config), not spec-branch content — a spec branch
    // cut before a recipe evolution (e.g. `prepare` being added) must still be graded by today's
    // recipe, since that is what its merge target enforces. Without this, a stale branch recipe
    // skips the build and the gate grades whatever compiled output LINGERS in the gitignored
    // build dir (reset's `clean -fd` preserves it) — a stale-artifact green, the exact
    // self-deception the build gate exists to prevent.
    const recipe =
      (await defaultAcceptanceRecipeResolver(this.deps.canonicalRepo)) ??
      (await defaultAcceptanceRecipeResolver(worktreePath));
    if (recipe?.prepare) {
      output.appendLine(`▸ SP-${specNumber}: build gate — $ ${recipe.prepare}`);
      const prep = await this.runPrepare(recipe.prepare, worktreePath);
      if (!prep.ok) {
        const diagnosis =
          `The assembled change does not build: the repo's acceptance prepare step failed.\n` +
          `$ ${recipe.prepare}\n${prep.output.slice(-4000)}`;
        // Surface the cause in DELIVERY.md too (repair window, 2026-07-08): this single
        // failure blocks EVERY AC, so the report must lead with it instead of rendering a
        // blank "all ACs not run / no evidence".
        result.buildFailure = {
          command: recipe.prepare,
          output: prep.output.slice(-4000),
        };
        // Triangulate the fault (2026-07-08, live-run finding): when the compile errors are
        // located in the slice's check files, LOCATION IS NOT FAULT — the check may be wrong,
        // or the implementation may have drifted from the SPEC CONTRACT the check was written
        // to (the first live run shipped a coder that dropped a contract field, and the probe
        // that faithfully used it "failed"). Route through the SP-6/9 contract-aware judge so
        // the rework re-dispatches only the faulting role instead of blocking everything blind.
        const probeFootprints = [...unitsBySlice.values()]
          .flat()
          .filter((u) => (u.role ?? "code") === "test")
          .flatMap((u) => u.footprint);
        const cls = classifyPrepareFailure(prep.output, probeFootprints);
        for (const s of slices) {
          if (!landed.has(s.handle)) continue;
          let fault: Fault | undefined;
          if (cls.errorFiles.length > 0 && this.deps.judgeFailure) {
            try {
              const contract = (unitsBySlice.get(s.handle) ?? [])[0]?.contract;
              const j = await this.deps.judgeFailure(
                { id: `${s.handle}#build`, slice: s.handle, role: undefined },
                diagnosis,
                contract,
              );
              fault = j.fault;
              output.appendLine(
                `⚖ ${s.handle}: build-failure fault judged → ${j.fault} (${j.rationale.split("\n")[0]})`,
              );
            } catch {
              /* judge unavailable → unrouted block, as before */
            }
          }
          await blockSlice(s.handle, diagnosis, fault, prep.output.slice(-4000));
        }
        output.appendLine(
          `⚑ SP-${specNumber}: build gate FAILED → landed slices require attention (per-AC runs skipped).`,
        );
        return green;
      }
    }

    if (verifs.length === 0) {
      // No declaration ⇒ the closing gate cannot run. NO SKIP: every landed slice →
      // requires-attention; nothing advances, nothing commits ( reverses the old pass).
      const diagnosis =
        "Closing AI-verification gate could not run: the Spec declares no `ac_verifications`. " +
        "Declare a per-AC verification map on the Spec (AC ordinal → { run, env }), then re-run.";
      for (const s of slices)
        if (landed.has(s.handle)) await blockSlice(s.handle, diagnosis);
      output.appendLine(
        `⚑ SP-${specNumber}: no ac_verifications declared — closing gate un-runnable → requires-attention (no skip).`,
      );
      return green;
    }

    output.appendLine(
      `▸ SP-${specNumber}: closing gate — running ${verifs.length} declared AC verification(s).`,
    );
    // SP-6/7 AC3: an `env: "assessment"` AC is graded by a fresh INDEPENDENT assessor session — never
    // the implementing worker. Wire the injectable (default: a headless SDK session in the worktree)
    // plus the per-AC intent (the criterion text) and a description of the delivered artifact.
    const assessAc =
      this.deps.assessAc ??
      createSdkAssessor({
        cwd: worktreePath,
        // SP-17/1: the independent assessor runs on the pinned worker model (role "assessor" may raise it).
        model: resolveWorkerModel(this.deps.workerModel, "assessor"),
        log: (l) => output.appendLine(l),
      });
    const acText = acTextByOrdinal(specDoc?.body ?? "");
    const artifactFiles = [...unitsBySlice.values()]
      .flat()
      .flatMap((u) => u.footprint ?? []);
    const assess: AssessContext = {
      assessAc,
      intentFor: (ac) => acText.get(ac) ?? "",
      artifact: `The delivered change lives in this worktree. Declared footprint: ${
        artifactFiles.length ? artifactFiles.join(", ") : "(none)"
      }`,
    };
    const runPlan = (vs: AcVerification[]) =>
      (
        this.deps.runAcVerifications ??
        ((v: AcVerification[], cwd: string) =>
          runAcVerifications(v, cwd, undefined, assess))
      )(vs, worktreePath);
    let acResults = await runPlan(verifs);
    // Gate self-heal (2026-07-11): an UNRUNNABLE probe (shell exit 126/127 or
    // spawn error) is a defect in the gate's own machinery — the probe command
    // or its environment — never in the slice (a signed bare `tsc` burned 3
    // rework attempts as a phantom "code failure"). When available, re-author
    // + re-sign `ac_verifications` via the auditor (the write_spec certify-only
    // path) and retry the whole plan ONCE. No rework attempt is burned by any
    // of this.
    if (acResults.some((r) => r.unrunnable) && this.deps.reauthorGate) {
      output.appendLine(
        `⚑ SP-${specNumber}: unrunnable verification probe — a GATE defect, not a code failure. ` +
          `Re-authoring ac_verifications via the auditor and retrying the gate once (no rework attempt burned).`,
      );
      let reauthored = false;
      try {
        reauthored = await this.deps.reauthorGate(specNumber, worktreePath);
      } catch (err) {
        output.appendLine(
          `⚠ SP-${specNumber}: gate re-author failed: ${(err as Error).message}`,
        );
      }
      if (reauthored) {
        const freshDoc = await store.getFile(store.pathForSpecDoc(specNumber));
        const fresh = parseAcVerifications(
          freshDoc?.frontmatter?.ac_verifications,
        );
        if (fresh.length) {
          verifs = fresh;
          acResults = await runPlan(fresh);
          output.appendLine(
            `▸ SP-${specNumber}: closing gate retried with re-authored probes.`,
          );
        }
      }
    }
    // The full per-AC run lands on the auditable report regardless of who could
    // have authored it — but the GRADE is derived only from the independently-authored
    // subset below (so a self-tick still leaves an audit trail of why it didn't count).
    result.acResults = acResults;

    // AC4 (SP-6/6): the grade derives ONLY from independently-authored evidence.
    // Build the run-level set of worker-owned paths — every dispatched unit's
    // footprint, with any held-out acceptance evidence stripped by `resolveFootprint`
    // (it is never-in-footprint) — and DROP from the grade any verification that
    // EXECUTES a file in it. A worker-authored test can never tick an AC green: the
    // dropped AC is treated as un-graded, so the slice that satisfies it falls into
    // the `missing` path below and goes requires-attention, exactly as if no
    // verification had run. There is no worker-facing path to mark its own AC green.
    // A signed probe that merely READS worker files (grep/`[ -e … ]` over the
    // deliverable — unavoidable for a docs Spec) stays in the grade, with a log note.
    const workerOwned = new Set(
      resolveFootprint(
        [...unitsBySlice.values()].flat().flatMap((u) => u.footprint ?? []),
      ).map(normalizeFilePath),
    );
    const verifByAc = new Map<number, AcVerification>(
      verifs.map((v) => [v.ac, v]),
    );
    const graded = acResults.filter((r) => {
      const v = verifByAc.get(r.ac);
      const selfTick = v
        ? verificationExecutesWorkerAuthored(v.run, workerOwned)
        : false;
      if (selfTick)
        output.appendLine(
          `⚑ SP-${specNumber}: AC #${r.ac} verification EXECUTES a worker-owned file — ` +
            `self-tick excluded from the grade (independent evidence only).`,
        );
      else if (v && verificationIsWorkerAuthored(v.run, workerOwned))
        // Reading the deliverable is not self-grading: the probe text is server-authored and
        // provenance-signed at → Ready, and a docs/config Spec's deliverable IS the files its
        // probes inspect (dropping reads deadlocked TEP-13_SP-1 on a fully green run). Only
        // executing a worker-owned file hands the verdict to the worker.
        output.appendLine(
          `⚠ SP-${specNumber}: AC #${r.ac} verification reads worker-owned files (the deliverable) — ` +
            `kept in the grade: the signed probe inspects them but executes nothing the workers authored.`,
        );
      else if (v && verificationIsWholeSuite(v.run))
        // Kept in the grade (bootstrapping: Specs verified by `npm test` until ACs migrate to
        // held-out probes), but flagged so a self-graded green is never silently read as an
        // independent intent-check.
        output.appendLine(
          `⚠ SP-${specNumber}: AC #${r.ac} is graded by a whole-suite command (\`${v.run}\`) — ` +
            `SELF-GRADED, not independent evidence (its green includes the worker's own tests). ` +
            `Point this AC at a held-out acceptance probe for a trustworthy intent-check.`,
        );
      return !selfTick;
    });

    const pass = new Map<number, boolean>(graded.map((r) => [r.ac, r.pass]));
    const allGreen = graded.length > 0 && graded.every((r) => r.pass);

    // SP-6/7 AC4: the code-vs-test judge — the same independent-judgment seam as the assessor (a fresh
    // session, never the implementing worker). Wire the injectable (default: a headless read-only SDK
    // session in the worktree) and collect, per red AC, the judged route so the verification trace and
    // the re-dispatch both record it.
    const judge =
      this.deps.judgeFailure ??
      createSdkJudge({
        cwd: worktreePath,
        // SP-17/1: the independent code-vs-test judge runs on the pinned worker model (role "judge").
        model: resolveWorkerModel(this.deps.workerModel, "judge"),
        log: (l) => output.appendLine(l),
      });
    const routes = new Map<number, Fault>();

    // Per slice: green iff every AC it satisfies ran green. A slice with no `satisfies` rides on the
    // whole-plan verdict (all declared checks green) — a legacy slice can't be stranded by having no
    // ordinals, but it still can't reach Done on a red plan. Red/un-runnable → requires-attention here;
    // green slices are returned for the caller to commit-before-Done (never advanced in this method).
    for (const s of slices) {
      if (!landed.has(s.handle)) continue;
      const sat = s.satisfies ?? [];
      const missing = sat.filter((n) => !pass.has(n));
      const red = sat.filter((n) => pass.get(n) === false);
      const isGreen =
        sat.length > 0 ? missing.length === 0 && red.length === 0 : allGreen;
      if (isGreen) {
        green.set(s.handle, [...sat]);
        output.appendLine(
          `✓ ${s.handle}: AC ${sat.length ? sat.map((n) => `#${n}`).join(", ") : "(plan)"} green → eligible to commit.`,
        );
      } else {
        const why = sat.length
          ? `AC ${[...missing.map((n) => `#${n} (no verification ran)`), ...red.map((n) => `#${n} (verification red)`)].join(", ")} did not pass`
          : "the declared AC verification plan was not all-green";
        // AC4: judge the fault (code vs test vs both) on ONE independent session per red slice, then
        // route the re-dispatch. The judge reads the worktree (both the code and the held-out probe);
        // its verdict + rationale steer `blockSlice` (which role to re-author, or escalate on `both`)
        // and are recorded in the verification trace against the slice's red ACs.
        const units = unitsBySlice.get(s.handle) ?? [];
        const failedAcs = sat.length ? [...missing, ...red] : [];
        const failEvidence = acResults
          .filter((r) => (failedAcs.length ? failedAcs : [r.ac]).includes(r.ac))
          .filter((r) => !r.pass)
          .map((r) => `AC #${r.ac}: ${r.evidence}`)
          .join("\n\n");
        // Gate-defect short-circuit (2026-07-11): when EVERY failing result for
        // this slice is an unrunnable probe (exit 126/127 / spawn error), the
        // verdict is control-plane — the gate's machinery is broken, no model
        // judgment needed, no role to blame, no attempt to burn. (The self-heal
        // retry above already ran and did not produce a runnable probe.)
        const redResults = acResults.filter(
          (r) => !r.pass && (failedAcs.length ? failedAcs.includes(r.ac) : true),
        );
        const gateDefect =
          redResults.length > 0 &&
          redResults.every((r) => r.unrunnable) &&
          missing.length === 0;
        let fault: Fault = "both";
        let rationale = "";
        if (gateDefect) {
          fault = "gate";
          rationale =
            "the verification probe(s) cannot execute in the worktree (command not found / not executable) — " +
            "a defect in the gate's own machinery; no slice role can fix it";
          output.appendLine(
            `⚖ ${s.handle}: gate defect (probe unrunnable) — control-plane verdict, judge skipped; no rework attempt burned.`,
          );
        } else {
          try {
            const judgment = await judge(
              {
                id: units[0]?.id ?? s.handle,
                slice: s.handle,
                role: units[0]?.role,
              },
              `${why}\n\n${failEvidence}`,
              // SP-6/9: thread the slice's CONTRACT so the judge triangulates the red against it (the
              // neutral arbiter) rather than comparing the two hands — the only way to reach `contract`.
              s.contract,
            );
            fault = judgment.fault;
            rationale = (judgment.rationale ?? "").trim();
            output.appendLine(
              `⚖ ${s.handle}: judged fault = ${judgment.fault} — ${judgment.rationale}`,
            );
          } catch (err) {
            // Fail-safe: a judge error escalates (fault `both`) rather than mis-routing.
            output.appendLine(
              `⚖ ${s.handle}: judge failed (${(err as Error).message}) → fault ambiguous (both).`,
            );
          }
        }
        for (const n of failedAcs) routes.set(n, fault);
        // SP-11/3: keep the judge's UNCLIPPED per-AC rationale on the run result so the delivery
        // report's "What happened" renders it verbatim — instead of it dying after the trace-table
        // clip (`buildVerificationTrace` truncates it for the audit row; here it stays whole).
        for (const n of failedAcs)
          result.diagnosis.push({ ac: n, text: rationale || why });
        // The diagnosis lands on the slice and is INJECTED INTO THE REWORK ROUND's worker prompt
        // (the slice body travels there) — so it must carry what actually failed: the judge's
        // rationale and the failing evidence. Without them the re-author starts from zero and the
        // rework round is the same experiment re-rolled ("see DELIVERY.md" is a dead pointer for
        // a worker — DELIVERY lives in the thinking space, outside its worktree).
        const baseDiagnosis =
          `Closing gate: ${why}. Judged fault: ${fault}${rationale ? ` — ${rationale}` : ""}.` +
          (failEvidence
            ? `\n\nFailing evidence:\n${failEvidence.slice(0, 2000)}`
            : "");
        // SP-6/9: a `contract` route is NOT a role-rework — the contract itself is the defect. Lead the
        // diagnosis with CONTRACT_DEFECT_MARKER naming the undefined seam and directing to a contract
        // re-cut via /slice (update_slice contract), then re-orchestrate. Do NOT auto-rewrite the
        // contract (design work owned by the slicer/human) and — via `reDispatchDecision`'s contract
        // arm inside `blockSlice` — no rework attempt is burned (the slice was never the problem).
        const diagnosis =
          fault === "contract"
            ? `${CONTRACT_DEFECT_MARKER}\n` +
              `The contract is incomplete: ${rationale || "an undefined seam each hand filled differently"}. ` +
              `Re-cut the contract via /slice (update_slice contract) to define this seam, then re-orchestrate — ` +
              `do NOT re-author the code or the test (both conform to the contract as written), do NOT auto-rewrite ` +
              `the contract here, and no rework attempt was burned.\n\n${baseDiagnosis}`
            : fault === "gate"
              ? `${GATE_DEFECT_MARKER}\n` +
                `The verification probe(s) for this slice cannot execute (command not found / not executable). ` +
                `${this.deps.reauthorGate ? "The auditor already re-authored the probes once this run and they still cannot execute" : "No auditor was available to re-author them this run"}. ` +
                `Fix the probe command or its environment (invoke repo-local tools via their runner — npx / uv run / poetry run — and declare worktree setup), ` +
                `then re-orchestrate. The slice's code was never judged and no rework attempt was burned.\n\n${baseDiagnosis}`
              : baseDiagnosis;
        await blockSlice(s.handle, diagnosis, fault, failEvidence);
        output.appendLine(
          `⚑ ${s.handle}: closing gate red → requires-attention.`,
        );
      }
    }

    // NOTE: the full-suite regression backstop (SP-6/18) was REMOVED (2026-07-08). It was the
    // one gate with no owner — a cross-slice behavioural break it caught was outside every
    // worker's footprint, so no re-dispatch could fix it; the slice just waited for a human.
    // Type regressions are already caught by the oracle's whole-tree compile during the coder's
    // loop; a behavioural cross-slice regression is caught by whoever runs the suite next (the
    // human at Accept, the merge target's CI) — not by an ownerless mid-run gate. The per-AC
    // grade above stands as the commit set.

    // SP-6/7 AC5: build this run's slice of the durable, structured verification trace — per AC and per
    // rework round (the slice's current attempt), kind (probe/assessment), verdict, rationale, and the
    // judged code-vs-test route on a red AC. The caller persists it alongside DELIVERY.md + surfaces it.
    const roundForAc = (ac: number): number => {
      const owner = slices.find((s) => (s.satisfies ?? []).includes(ac));
      return (this.reworkAttempts.get(owner?.handle ?? "") ?? 0) + 1;
    };
    result.verificationTrace = buildVerificationTrace({
      round: roundForAc,
      declared: verifs,
      acResults,
      routes,
    });

    return green;
  }

  /** Claim the unit's footprint → run the worker (may park resident) → release. Resolves with its outcome.
   *  `unionFootprint` is the run-level UNION of every dispatched unit's declared footprint (AC4) — the
   *  post-tool whole-tree backstop refuses only a change outside it; the per-unit `baseline` (the paths
   *  already dirty when this unit started) is captured here, once, before the worker runs, to exempt
   *  pre-existing dirt outside the union from misattribution to this unit. */
  private async dispatchUnit(
    unit: SchedUnit,
    specNumber: string,
    worktreePath: string,
    onPark: OnPark,
    unionFootprint?: string[],
    oracleFor?: (slice: string) => Promise<VerifyOracle | undefined>,
  ): Promise<UnitDone> {
    const claim = await this.deps.arbiter.acquire(unit.id, unit.footprint);
    if (!claim.ok) {
      // The scheduler pre-selects a disjoint frontier, so this is rare (a stale cross-Spec
      // claim). Treat as failed so the slice surfaces for attention rather than silently dropping.
      this.deps.output.appendLine(
        `▸ ${unit.id}: ownership conflict — ${claim.conflicts
          .map((c) => `${c.file} (held by ${c.heldBy})`)
          .join(", ")}.`,
      );
      return { id: unit.id, slice: unit.slice, outcome: "failed" };
    }
    startSession(unit.id);
    // Per-unit baseline (AC4): the paths already dirty in the shared worktree at THIS unit's
    // start — earlier units' already-present changes. A change present in the baseline predates
    // this unit's run, so containment must never attribute it to this unit (and revert it).
    const baseline = await this.gitDirtyPaths(worktreePath);
    try {
      const wr = await this.runWorker(
        unit,
        specNumber,
        worktreePath,
        onPark,
        unionFootprint,
        baseline,
        oracleFor,
      );
      return {
        id: unit.id,
        slice: unit.slice,
        outcome: wr.outcome,
        question: wr.question,
        sessionId: wr.sessionId,
        attention: wr.attention,
        containment: wr.containment,
        finalOutput: wr.finalOutput,
      };
    } finally {
      this.liveAborts.delete(unit.id);
      endSession(unit.id);
      await this.deps.arbiter.release(unit.id);
    }
  }

  /**
   * Assemble the black-box verify oracle for ONE slice's coder (tests-first, 2026-07-08) —
   * or `undefined` when any ingredient is missing (fail-soft; the coder then runs without
   * the tool, exactly as before). The runner is a SECOND detached snapshot of the spec
   * branch (`createTester` with an `oracle/` baseDir so it never collides with the tester),
   * provisioned by symlinking the canonical repo's `node_modules`; each verify round
   * re-snapshots it, overlays the coder's dirty delta + the tester-owned probe sources,
   * builds (`recipe.prepare`) and runs the slice's runnable per-AC verifications.
   */
  private async buildSliceOracle(args: {
    sliceHandle: string;
    specNumber: string;
    worktreePath: string;
    testerPath?: string;
    slices: SliceForDag[];
    unitsBySlice: Map<string, SchedUnit[]>;
    verifs: AcVerification[];
    log: (line: string) => void;
  }): Promise<VerifyOracle | undefined> {
    const createTester = this.deps.worktrees.createTester?.bind(
      this.deps.worktrees,
    );
    if (!createTester || !args.testerPath) return undefined;
    const recipe =
      (await defaultAcceptanceRecipeResolver(this.deps.canonicalRepo)) ??
      (await defaultAcceptanceRecipeResolver(args.worktreePath));
    const satisfies =
      args.slices.find((s) => s.handle === args.sliceHandle)?.satisfies ?? [];
    const sliceVerifs = args.verifs.filter(
      (v) => satisfies.includes(v.ac) && v.env !== "assessment" && !!v.run,
    );
    const probeFiles = (args.unitsBySlice.get(args.sliceHandle) ?? [])
      .filter((u) => (u.role ?? "code") === "test")
      .flatMap((u) => u.footprint);
    if (!recipe?.prepare || sliceVerifs.length === 0 || probeFiles.length === 0)
      return undefined;
    // The runner: a detached snapshot of the same spec branch, in its own baseDir so its
    // path never collides with the real tester snapshot. `createTester` is idempotent and
    // re-snapshots (reset --hard + clean -fd, node_modules survives) on reuse — which is
    // exactly the per-round reset the oracle needs.
    const oracleBase = path.join(
      args.testerPath ? path.dirname(args.testerPath) : this.deps.canonicalRepo,
      "oracle-runners",
    );
    const runnerDir = await createTester(
      this.deps.canonicalRepo,
      args.specNumber,
      oracleBase,
    );
    // Provision the runner's toolchain: symlink the canonical repo's node_modules
    // (idempotent + self-link-guarded). A repo with no node_modules degrades to the
    // recipe's own behaviour (prepare will say what's missing, loudly).
    try {
      const { linkNodeModules } = await import("./WorktreeService");
      await linkNodeModules(
        path.join(this.deps.canonicalRepo, "node_modules"),
        runnerDir,
      );
    } catch {
      /* provisioning is best-effort; prepare reports the truth */
    }
    args.log(
      `▸ ${args.sliceHandle}: verify oracle armed (runner ${runnerDir}; ${sliceVerifs.length} check(s), ${probeFiles.length} probe file(s)).`,
    );
    const exec = (cmd: string, cwd: string) =>
      runBounded(cmd, cwd, { timeoutMs: 600_000, env: process.env });
    return createVerifyOracle({
      codeWorktree: args.worktreePath,
      testerWorktree: args.testerPath,
      runnerDir,
      probeFiles,
      prepare: recipe.prepare,
      verifications: sliceVerifs,
      exec,
      porcelain: (cwd) => this.gitPorcelain(cwd),
      resetRunner: async () => {
        await createTester(
          this.deps.canonicalRepo,
          args.specNumber,
          oracleBase,
        );
      },
      copyIn: async (fromRoot, rel) => {
        const dst = runnerPath(runnerDir, rel);
        await fs.promises.mkdir(path.dirname(dst), { recursive: true });
        await fs.promises.copyFile(runnerPath(fromRoot, rel), dst);
      },
      removeIn: async (rel) => {
        await fs.promises.rm(runnerPath(runnerDir, rel), { force: true });
      },
      log: args.log,
    });
  }

  /**
   * Run one execution unit. The sole substrate is the Agent SDK (`runViaSdk`); tests inject the
   * `runUnit` seam to return an outcome (success / needs-input / failed) without a live SDK call.
   */
  private runWorker(
    unit: SchedUnit,
    specNumber: string,
    cwd: string,
    onPark: OnPark,
    unionFootprint?: string[],
    baseline?: string[],
    oracleFor?: (slice: string) => Promise<VerifyOracle | undefined>,
  ): Promise<WorkerResult> {
    return this.deps.runUnit
      ? this.deps.runUnit(unit, specNumber, cwd, onPark)
      : this.runViaSdk(
          unit,
          specNumber,
          cwd,
          onPark,
          unionFootprint,
          baseline,
          oracleFor,
        );
  }

  /**
   * The Agent SDK worker: `query()` runs a headless `claude` subprocess in the
   * worktree under `bypassPermissions` (no prompts — the PreToolUse footprint hook from SL-6 is the
   * cheap early guardrail). Typed messages are persisted to the unit's `.jsonl` (for the graph
   * float-out) and summarized to the channel. The SDK is **lazy-imported** so it never loads at
   * activation, and a load/run failure degrades to a non-success (→ requires-attention) rather than
   * crashing the host.
   *
   * The **authority** over footprint is a post-tool working-tree check (SP-6/2 AC3 + SP-2/TEP-6 AC4):
   * a `PostToolUse` hook runs after EVERY tool call (Bash included — `rm`/`mv`/`sed -i`/redirect carry
   * no `file_path` the PreToolUse guard can pre-screen) and diffs the worktree against the **run-level
   * union of every dispatched unit's footprint** (NOT this unit's alone — the whole-tree diff cannot
   * attribute a change to a unit, so it refuses only a change outside ALL declared territory). Any
   * change outside that union is **terminal**: we abort the `query()` (the SDK `AbortController`),
   * revert ONLY the offending path(s) (`git restore`/`clean` — a sibling's work in the shared tree,
   * running or finished, is in the union and survives), and fail the unit with a diagnosis naming the
   * path so its slice is flagged requires-attention. This is NOT a recoverable deny the worker can
   * route around — it closes the stub-and-`rm` hole that the Edit/Write-only PreToolUse guard could
   * not see. Tight per-unit containment is the PreToolUse hook's job (it has the `file_path`).
   */
  private async runViaSdk(
    unit: SchedUnit,
    specNumber: string,
    cwd: string,
    onPark: OnPark,
    unionFootprint?: string[],
    baseline?: string[],
    oracleFor?: (slice: string) => Promise<VerifyOracle | undefined>,
  ): Promise<WorkerResult> {
    const isTest = (unit.role ?? "code") === "test";
    // Tests-first (2026-07-08): a CODE unit gets the black-box verify oracle when the run
    // could assemble one (fail-soft otherwise). With the oracle wired, the coder's ONLY
    // feedback channel is the `verify` tool — selfVerify is not injected and the Bash
    // toolchain fence arms.
    let oracle: VerifyOracle | undefined;
    if (!isTest && oracleFor) {
      try {
        oracle = await oracleFor(unit.slice);
      } catch (err) {
        // LOUD, never silent (2026-07-08): the coder's feedback channel could not be
        // built — fail the unit with the real reason instead of quietly degrading to a
        // self-run toolchain the fences would then fight.
        const reason = `verify oracle could not be built for ${unit.slice}: ${(err as Error).message}`;
        this.deps.output.appendLine(`⛔ [${unit.id}] ${reason}`);
        return { outcome: "failed", finalOutput: reason };
      }
    }
    // SP-6/7 structural independence: for a `role: test` unit, `cwd` IS the tester snapshot (a
    // detached base-commit worktree) — one directory to read AND write, with the in-progress
    // implementation absent by construction. No read fence, no base-dir split. It has no Bash to
    // poke the toolchain, so inject the repo's test-framework convention into its prompt.
    const testConvention = isTest
      ? await this.resolveTestConvention(cwd)
      : undefined;
    // SP-12: sibling to the test-convention wiring — a CODE worker gets the repo's sanctioned,
    // non-mutating self-verify command (top-level `selfVerify` in `.tandem/conventions.json`) so it
    // never has to improvise into shared build config to run tests. Undefined for a test unit (which
    // renders none of the SP-12 blocks), a repo that declares no command, or an oracle-armed coder
    // (the oracle replaces the self-run command entirely).
    // In an orchestrated run (oracleFor supplied) selfVerify is NEVER injected — the
    // oracle is the feedback channel, and a slice with nothing runnable to verify gets no
    // self-run crutch either (loud absence, not a silent substitute). The legacy selfVerify
    // path remains only for direct runViaSdk callers that supply no oracle factory.
    const selfVerifyCommand =
      isTest || oracleFor
        ? undefined
        : (await defaultAcceptanceRecipeResolver(cwd))?.selfVerify;
    // SP-16: sibling to the test-convention wiring — a held-out `role: test` worker gets the repo's
    // canonical EXAMPLE TEST content (top-level `testExample` path in `.tandem/conventions.json`, read
    // by the resolver so no `fs` lives in the shell) so it authors its probe from prompt + contract
    // instead of independently rediscovering the repo's test idiom. Undefined for a code unit or a repo
    // that declares/reads no example.
    const exampleTest = isTest
      ? (await defaultAcceptanceRecipeResolver(cwd))?.testExample
      : undefined;
    const prompt = buildWorkerPrompt(unit, specNumber, {
      specBody: this.promptCtx.specBody,
      sliceBody: this.promptCtx.sliceBodies.get(unit.slice),
      testConvention,
      exampleTest,
      selfVerifyCommand,
      oracleAvailable: !!oracle,
    });
    // SP-11/3 fault-test rework routing: on a rework round the slice body carries the judge's
    // diagnosis under `## ⚑ Requires attention`. The `role: test` re-author OWNS the check, so it
    // gets that judged mechanism verbatim in its prompt (`buildTestReworkContext` returns it ONLY for
    // route "test"); a `code` author's route yields undefined, so this appends nothing and the code
    // prompt is untouched (the SP-6/9 redaction boundary is kept for them). A first (non-rework) run
    // has no `## ⚑ Requires attention` block, so `extractDiagnosis` is undefined and nothing is added.
    const priorDiagnosis = extractDiagnosis(
      this.promptCtx.sliceBodies.get(unit.slice) ?? "",
    );
    const reworkContext = priorDiagnosis
      ? buildTestReworkContext(priorDiagnosis, unit.role)
      : undefined;
    const workerPrompt = reworkContext
      ? `${prompt}\n\n${reworkContext}`
      : prompt;
    let success = false;
    // SP-11/3: the worker's final output text (last `result` message), mined below for a trailing
    // `## Discoveries` block so `dispatchSpec` can surface out-of-scope findings in the report.
    let finalOutput = "";
    let sessionId: string | undefined;
    let turnText = "";
    let parkedOnce = false;
    // Set by the post-tool containment hard-stop (AC3) when a tool call left an out-of-footprint
    // change: its diagnosis names the offending path and makes the unit fail → requires-attention.
    // Once set, the run is terminal — it takes precedence over any later `success`.
    let containmentReason: string | undefined;
    // Aborts the live `query()` the instant containment fires (SDK `Options.abortController`) —
    // and registered run-wide so a HALT aborts every in-flight worker immediately (fast abort,
    // 2026-07-08) instead of letting a doomed run drain at full token burn.
    const abort = new AbortController();
    this.liveAborts.set(unit.id, abort);

    // Streaming-input session (SL-3 resident standby): yield the task; when the agent ends a turn
    // with a `⟦NEEDS-INPUT⟧` question, the session stays alive (suspended at `await nextInput`) and
    // we `onPark` it off the active cap. `/attend` resolves `nextInput` with the answer → the agent
    // continues in place. No process restart, no context re-read while within the cache TTL.
    let resolveNext: (v: string | null) => void = () => {};
    const nextInput = new Promise<string | null>((r) => (resolveNext = r));
    const userMsg = (content: string) => ({
      type: "user" as const,
      message: { role: "user" as const, content },
      parent_tool_use_id: null,
    });
    const input = (async function* () {
      yield userMsg(workerPrompt);
      const a = await nextInput;
      if (a != null) yield userMsg(a);
    })();

    try {
      // SP-17/1: the code/test-author worker runs on the pinned worker model resolved from the unit's
      // role — never the session/env model. The query() call is the exported createSdkWorker seam below.
      const model = resolveWorkerModel(this.deps.workerModel, unit.role);
      // Tests-first (2026-07-08): expose the black-box `verify` tool to an oracle-armed coder
      // as an in-process SDK MCP server. The handler runs in THIS process (the orchestrator):
      // it overlays the coder's delta + the tester-owned probes into the isolated runner,
      // builds, runs the slice's checks, and returns the structured verdict — never probe
      // source. Best-effort: if the SDK tool surface is unavailable the coder just runs
      // without the tool (its prompt then carries no VERIFY block either? no — the prompt is
      // already built; the fail path is logged and the worker falls back to intent-only work).
      let oracleServers: Record<string, McpServerConfig> | undefined;
      if (oracle) {
        try {
          const m = await import("@anthropic-ai/claude-agent-sdk");
          const verifyTool = m.tool(
            "verify",
            "Build the current state of your work together with this slice's acceptance checks in an isolated runner and return the results: compile errors, or per-check PASS/FAIL with the failing assertion. Call it after each meaningful edit and iterate until everything passes.",
            {},
            async () => ({
              content: [
                {
                  type: "text" as const,
                  text: formatVerifyReply(await oracle.verify()),
                },
              ],
            }),
          );
          oracleServers = {
            oracle: m.createSdkMcpServer({
              name: "oracle",
              version: "1.0.0",
              tools: [verifyTool],
            }),
          };
        } catch (err) {
          this.deps.output.appendLine(
            `  [${unit.id}] verify tool unavailable (${(err as Error).message}) — coder runs without it.`,
          );
        }
      }
      const runWorker = createSdkWorker({
        cwd,
        model,
        // Inject a test's fake query when supplied; else createSdkWorker lazy-imports the real SDK.
        loadQuery: this.deps.sdkQuery
          ? async () => this.deps.sdkQuery as unknown as AssessorSdkQuery
          : undefined,
        // Tests-first: the in-process oracle server carrying the `verify` tool (code units only).
        mcpServers: oracleServers,
        // SP-6/7: scope the worker's tools by role. A held-out `role: test` worker loses
        // Bash/Grep/Glob/Read/web/Task — it cannot see the implementation, other workers' session
        // transcripts, or the fence source, and cannot route a write through Bash. The restriction
        // is structural and never announced (the worker stays unaware of the independence boundary).
        disallowedTools: disallowedToolsForRole(unit.role),
        // Aborting this stops the query the moment the post-tool containment check fires (AC3).
        abortController: abort,
        hooks: {
          // The cheap early guardrail (SL-6): a PreToolUse hook runs FIRST and denies any Edit/Write
          // outside this unit's footprint — silently, no prompt. Must be a hook, not
          // `canUseTool`, which bypassPermissions/acceptEdits skip for edits.
          PreToolUse: [
            {
              hooks: [
                async (input: unknown) => {
                  const inp = input as {
                    tool_name?: string;
                    tool_input?: unknown;
                  };
                  // Screen an Edit/Write against the unit's ROLE-effective footprint (SP-6/7): a
                  // `test` unit may only touch its held-out `acceptance/` probe; a `code` unit can
                  // never touch `acceptance/` — so the two hands can't reach into each other's work.
                  const d = footprintGuard(
                    inp.tool_name ?? "",
                    inp.tool_input,
                    resolveRoleFootprint(unit.role, unit.footprint),
                    cwd,
                  );
                  // SP-6/7 reverse-leak closure: a `role: code` worker must not read the grading
                  // probes once they've been copied into the code worktree (rework rounds) — deny
                  // a Read of an acceptance-evidence path, tersely. A test unit needs no read
                  // fence at all: its cwd is the tester snapshot (nothing to hide in its tree).
                  const r = !isTest
                    ? codeReadFence(inp.tool_name ?? "", inp.tool_input, cwd)
                    : ({ allow: true } as const);
                  // SP-16: `Grep` is no longer denied to a `role: test` worker (dropped from
                  // `disallowedToolsForRole`) — instead it is scoped to the worker's own cwd
                  // snapshot. Purely lexically deny a Grep whose `path` is absolute or `..`-escapes
                  // cwd (an omitted/in-tree path is fair use); confines search to the tester
                  // snapshot so it cannot reach the sibling code worktree. Code units are unaffected.
                  const g = isTest
                    ? grepWithinCwd(inp.tool_name ?? "", inp.tool_input, cwd)
                    : ({ allow: true } as const);
                  // Tests-first belt (2026-07-08): a CODE worker never touches tests — any
                  // write to a `*.test.*` / `acceptance/` path is denied regardless of
                  // footprint, and (when the oracle is armed) so is any Bash command that
                  // reaches for test files, the tester snapshot, or the build/test toolchain.
                  const t = !isTest
                    ? codeTestFence(
                        inp.tool_name ?? "",
                        inp.tool_input,
                        !!oracle,
                      )
                    : ({ allow: true } as const);
                  if (d.allow && r.allow && g.allow && t.allow) {
                    // SP-17/2: RTK rewrite on fence-ALLOWED Bash calls — UNCONDITIONAL.
                    // The fences always screen the ORIGINAL command; a denied call never
                    // reaches this branch. No rtkEnabled check — the rewrite is mandatory.
                    if (inp.tool_name === "Bash") {
                      const ti = inp.tool_input as
                        Record<string, unknown> | undefined;
                      const cmd =
                        typeof ti?.command === "string"
                          ? ti.command
                          : undefined;
                      if (cmd !== undefined) {
                        const rewritten = rtkRewrite(cmd);
                        if (rewritten !== undefined) {
                          return {
                            hookSpecificOutput: {
                              hookEventName: "PreToolUse" as const,
                              updatedInput: {
                                ...(ti ?? {}),
                                command: rewritten,
                              },
                            },
                          };
                        }
                      }
                    }
                    return {};
                  }
                  const deny = !d.allow ? d : !r.allow ? r : !g.allow ? g : t;
                  if (deny.allow) return {};
                  this.deps.output.appendLine(
                    `  ⛔ [${unit.id}] denied: ${deny.reason.split("\n")[0]}`,
                  );
                  return {
                    hookSpecificOutput: {
                      hookEventName: "PreToolUse" as const,
                      permissionDecision: "deny" as const,
                      permissionDecisionReason: deny.reason,
                    },
                  };
                },
              ],
            },
          ],
          // The authority (AC3): after EVERY tool call — Bash included — diff the worktree vs the
          // footprint and hard-stop on any out-of-footprint change. This is terminal (abort +
          // revert-only-the-offending-path → requires-attention), NOT a recoverable deny: a Bash
          // `rm`/`mv`/`sed -i`/redirect carries no `file_path` for the PreToolUse guard to screen,
          // so the post-tool diff is what closes the stub-and-`rm` hole.
          PostToolUse: [
            {
              hooks: [
                async () => {
                  // Already tripped (a prior tool in the same batch) — don't re-diff/re-revert.
                  if (containmentReason) return {};
                  // AC4: diff the whole tree against the run-level UNION of every dispatched unit's
                  // footprint (NOT this unit's alone). The backstop cannot attribute a shared-tree
                  // change to a unit, so a change is a violation only when it falls outside ALL
                  // declared territory. A sibling's in-footprint change — running OR finished — is in
                  // the union and exempt; `baseline` additionally exempts pre-existing dirt.
                  // SP-6/7: pass THIS unit's own role-effective footprint as its territory, and the
                  // run-level union as `running`. A non-acceptance sibling change stays exempt (union);
                  // a held-out acceptance probe is exempt ONLY for the unit that owns it — so a
                  // code-author can't slip its own grader in through the shared-tree union.
                  const verdict = await this.containmentCheck(
                    cwd,
                    resolveRoleFootprint(unit.role, unit.footprint),
                    {
                      running: unionFootprint ?? unit.footprint,
                      baseline: baseline ?? [],
                    },
                  );
                  if (verdict.ok) return {};
                  containmentReason = verdict.reason;
                  this.deps.output.appendLine(
                    `  ⛔ [${unit.id}] footprint breach — aborting + reverting ${verdict.violations
                      .map((v) => `${v.change} ${v.file}`)
                      .join(", ")}.`,
                  );
                  // Settle the streaming-input generator and tear down the live query.
                  resolveNext(null);
                  abort.abort();
                  return {};
                },
              ],
            },
          ],
        },
      });
      for await (const msg of runWorker(input)) {
        const rec = msg as unknown as Record<string, unknown>;
        appendSession(unit.id, JSON.stringify(rec) + "\n");
        sessionId = sessionId ?? sessionIdOf(rec);
        const line = summarizeEvent(rec);
        if (line) {
          this.deps.output.appendLine(`  [${unit.id}] ${line}`);
          turnText += line + "\n";
        }
        if (isResultSuccess(rec)) success = true;
        if (rec.type === "result" && typeof rec.result === "string")
          finalOutput = rec.result;
        if (rec.type === "result") {
          // A turn ended. Finish on success; otherwise park once on a question; otherwise stop.
          if (success) {
            resolveNext(null);
          } else if (!parkedOnce) {
            const q = extractNeedsInput(turnText);
            if (q) {
              parkedOnce = true;
              turnText = "";
              onPark(unit, q, (ans) => resolveNext(ans));
            } else {
              resolveNext(null);
            }
          } else {
            resolveNext(null);
          }
        }
      }
    } catch (err) {
      resolveNext(null);
      // A containment hard-stop aborts the query, which surfaces here as an abort error — that is
      // the EXPECTED terminal path, not an SDK failure: fail the unit with the offending-path
      // diagnosis so its slice is flagged requires-attention naming the breach.
      if (containmentReason)
        return {
          outcome: "failed",
          sessionId,
          attention: containmentReason,
          containment: true,
        };
      this.deps.output.appendLine(
        `  ✗ ${unit.id} SDK worker error: ${(err as Error).message}`,
      );
      return { outcome: "failed", sessionId };
    }
    // A containment breach is terminal even if the abort raced a `result: success`.
    if (containmentReason)
      return {
        outcome: "failed",
        sessionId,
        attention: containmentReason,
        containment: true,
      };
    // MANDATORY VERIFY (2026-07-08): a code unit's self-reported success counts for NOTHING —
    // its outcome IS the oracle's verdict. `confirmGreen` reuses the last green round when the
    // worktree state is byte-identical, else runs a fresh round; green ⇒ success, anything else
    // ⇒ failed with the oracle's reply as the diagnosis. This closes the "worker says done but
    // isn't" hole (the coder need never even have called verify voluntarily — the loop is
    // structural now). Fail-soft: no oracle for this slice ⇒ fall back to the self-report.
    if (!isTest && oracle) {
      const g = await oracle.confirmGreen();
      if (g.green) return { outcome: "success", sessionId, finalOutput };
      const diagnosis = formatVerifyReply(g.result);
      this.deps.output.appendLine(
        `⚑ ${unit.id}: verify is not green at completion → failed (the unit's outcome is the oracle's verdict, not its self-report).`,
      );
      return {
        outcome: "failed",
        sessionId,
        finalOutput: `${finalOutput}\n\n${diagnosis}`.trim(),
        attention: diagnosis,
      };
    }
    return success
      ? { outcome: "success", sessionId, finalOutput }
      : { outcome: "failed", sessionId, finalOutput };
  }

  /** Post-tool footprint containment (SP-6/2 AC3): diff the worktree against `footprint` and revert
   *  only the out-of-footprint changes, returning the verdict. Routes through the injectable seam
   *  (tests) or the real git-based default. */
  private containmentCheck(
    cwd: string,
    footprint: string[],
    ctx?: { baseline?: string[]; running?: string[] },
  ): Promise<ContainmentResult> {
    return (
      this.deps.containmentCheck ??
      ((c, f, x) => this.defaultContainmentCheck(c, f, x))
    )(cwd, footprint, ctx);
  }

  /**
   * Default containment check (SP-6/2 AC3 + SP-2/TEP-6 AC4): `git status --porcelain` in the worktree
   * → the pure {@link footprintContainment} (which surfaces every create/modify/delete outside the
   * given footprint, Bash-made ones included) → on a violation, `git restore`/`clean` of ONLY the
   * offending paths, so a sibling unit's work in the shared tree is never reverted. Here `footprint`
   * is the run-level UNION of every dispatched unit's footprint, so a change is a violation only when
   * it lands outside ALL declared territory; the running-footprints exclusion is no longer passed.
   * Best-effort at the git layer; returns the verdict the caller acts on (abort the query + fail
   * requires-attention).
   */
  private async defaultContainmentCheck(
    cwd: string,
    footprint: string[],
    ctx?: { baseline?: string[]; running?: string[] },
  ): Promise<ContainmentResult> {
    const porcelainRaw = await this.gitPorcelain(cwd);
    // Atomic-write scaffolding (`<file>.tmp.<pid>.<hash>`) is a transient artifact of editing an
    // in-footprint file — a post-tool diff can race it in the instant between the temp's create
    // and its rename onto the target. It is never a real out-of-territory change, so drop those
    // lines before the union check (else a perfectly legal in-footprint edit aborts on a fluke).
    const porcelain = porcelainRaw
      .split("\n")
      .filter((line) => !/\.tmp\.\d+\.[0-9a-f]+$/.test(line))
      .join("\n");
    // SP-6/7: `footprint` is THIS unit's own (role-effective) territory; `running` is the run-level
    // UNION (every dispatched unit, finished or in-flight). A non-acceptance sibling change is
    // exempt via the union; a held-out `acceptance/` probe is exempt ONLY via `footprint` (its owner,
    // the role: test unit) — so a code-author can't author the grader through the shared tree.
    // `baseline` exempts pre-existing dirt. The revert below only touches a true out-of-bounds change.
    const verdict = footprintContainment(porcelain, footprint, {
      baseline: ctx?.baseline,
      running: ctx?.running,
    });
    if (!verdict.ok)
      await this.revertPaths(
        cwd,
        verdict.violations.map((v) => v.file),
      );
    return verdict;
  }

  /**
   * Run the repo's acceptance `prepare` step (conventions.json) once in the code worktree — the
   * build gate before the per-AC probe commands (SP-6/7). Bounded (10 min), non-interactive,
   * output captured for the requires-attention diagnosis on failure.
   */
  private runPrepare(
    command: string,
    cwd: string,
  ): Promise<{ ok: boolean; output: string }> {
    return new Promise((resolve) => {
      const proc = spawn("bash", ["-c", command], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      const cap = (d: Buffer) => (out += d.toString());
      proc.stdout?.on("data", cap);
      proc.stderr?.on("data", cap);
      const timer = setTimeout(() => proc.kill("SIGKILL"), 600_000);
      proc.on("error", (err) => {
        clearTimeout(timer);
        resolve({ ok: false, output: `${out}\n${err.message}` });
      });
      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve({ ok: code === 0, output: out });
      });
    });
  }

  /** The worktree diff as `git status --porcelain` text; "" on any git error (degrades to no diff).
   *  `--untracked-files=all` lists each NEW file individually — without it git collapses a brand-new
   *  untracked directory to just the dir (`?? src/acceptance/`), which the containment check can't
   *  match to a file footprint (`src/acceptance/AC-1.test.ts`), so it wrongly reverts the first file
   *  written into any new dir — e.g. every held-out `acceptance/` probe (SP-6/7). */
  private gitPorcelain(cwd: string): Promise<string> {
    return new Promise<string>((resolve) => {
      const proc = spawn(
        "git",
        ["status", "--porcelain", "--untracked-files=all"],
        { cwd },
      );
      let out = "";
      proc.stdout?.on("data", (d: Buffer) => (out += d.toString()));
      proc.on("error", () => resolve(""));
      proc.on("close", () => resolve(out));
    });
  }

  /**
   * The set of repo-relative paths already dirty in the worktree (the per-unit containment
   * baseline, AC4) — every endpoint `footprintContainment` would derive from the current
   * `git status --porcelain`, captured at a unit's START. A change present here predates the
   * unit's run, so its post-tool check must not attribute it to (and revert) this unit. Reuses
   * `footprintContainment` with an empty footprint so the porcelain parsing/quoting/rename-split
   * stays in one place; "" porcelain (clean tree or git error) yields an empty baseline.
   */
  private async gitDirtyPaths(cwd: string): Promise<string[]> {
    const porcelain = await this.gitPorcelain(cwd);
    const verdict = footprintContainment(porcelain, []);
    return verdict.ok ? [] : verdict.violations.map((v) => v.file);
  }

  /**
   * A concise test-framework hint for a held-out `role: test` worker — which has no Read/Bash to
   * discover the repo's conventions — derived from the repo's acceptance-probe recipe
   * (`.tandem/conventions.json`, via {@link defaultAcceptanceRecipeResolver}). Lets the worker author
   * a runnable test purely from its prompt. Undefined when the repo declares no recipe (best-effort).
   */
  private async resolveTestConvention(
    cwd: string,
  ): Promise<string | undefined> {
    try {
      const recipe = await defaultAcceptanceRecipeResolver(cwd);
      if (!recipe) return undefined;
      return (
        `author your test file to the \`${recipe.sourcePath}\` convention so this command runs it: ` +
        `\`${recipe.run}\` (its {spec}/{ac} slots are already filled for your unit's path). Use the ` +
        `test framework that command implies (e.g. \`node --test\` → node:test, \`pytest\` → pytest).`
      );
    } catch {
      return undefined;
    }
  }

  /**
   * Revert ONLY the given out-of-footprint paths (SP-6/2 AC3) — never the whole tree, so a sibling's
   * concurrent work survives. Per path, two best-effort git calls cover every change kind: `git
   * restore --source=HEAD --staged --worktree` undoes a tracked modify/delete back to HEAD (a no-op
   * error for an untracked path), and `git clean -fdq` removes an untracked create. Errors are
   * swallowed — the leftover (if any) re-surfaces on the next post-tool diff.
   */
  private async revertPaths(cwd: string, files: string[]): Promise<void> {
    for (const f of files) {
      await this.runGit(
        ["restore", "--source=HEAD", "--staged", "--worktree", "--", f],
        cwd,
      );
      await this.runGit(["clean", "-fdq", "--", f], cwd);
    }
  }

  /** Run `git <args>` in `cwd`, resolving regardless of exit code (best-effort revert). */
  private runGit(args: string[], cwd: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const proc = spawn("git", args, { cwd });
      proc.on("error", () => resolve());
      proc.on("close", () => resolve());
    });
  }

  private checkAcs(specNumber: string, ordinals: number[]): Promise<void> {
    return (this.deps.checkAcs ?? ((n, o) => this.defaultCheckAcs(n, o)))(
      specNumber,
      ordinals,
    );
  }

  /** Default AC-check: tick the given ordinals' boxes under the Spec body's `## Acceptance
   *  Criteria` and write the Spec doc back (frontmatter preserved). A no-op for empty ordinals. */
  private async defaultCheckAcs(
    specNumber: string,
    ordinals: number[],
  ): Promise<void> {
    if (!ordinals.length) return;
    const rel = this.deps.store.pathForSpecDoc(specNumber);
    const parsed = await this.deps.store.getFile(rel);
    if (!parsed) return;
    const body = checkAcOrdinals(parsed.body ?? "", ordinals);
    if (body !== parsed.body)
      await this.deps.store.writeFile(rel, parsed.frontmatter, body);
  }

  /** Short HEAD sha of the worktree (for the delivery summary); "" on any error. */
  private gitShortSha(cwd: string): Promise<string> {
    if (this.deps.gitShortSha) return this.deps.gitShortSha(cwd);
    return new Promise<string>((resolve) => {
      const proc = spawn("git", ["rev-parse", "--short", "HEAD"], { cwd });
      let out = "";
      proc.stdout?.on("data", (d: Buffer) => (out += d.toString()));
      proc.on("error", () => resolve(""));
      proc.on("close", () => resolve(out.trim()));
    });
  }

  /** Build the auditable delivery report: the per-AC pass/fail table + evidence, the
   *  per-unit outcomes, caught problems, and the commit. Delegates to the pure `buildDeliveryReport`. */
  private deliveryMarkdown(
    specNumber: string,
    sha: string,
    files: string[],
    result: SpecRunResult,
    verifs: AcVerification[],
    trace: VerificationTraceEntry[],
    acTexts?: string[],
  ): string {
    // Caught problems for the audit trail: each failed / parked unit, surfaced from the run.
    const problems = result.results
      .filter((r) => r.outcome !== "success")
      .map(
        (r) =>
          `\`${r.id}\` (${r.slice}) — ${r.outcome}${r.outcome === "needs-input" ? " (worker asked a question)" : ""}.`,
      );
    return buildDeliveryReport({
      specNumber,
      sha,
      files,
      units: result.results.map((r) => ({ id: r.id, outcome: r.outcome })),
      declared: verifs,
      acResults: result.acResults,
      problems,
      advanced: result.advanced,
      attention: result.attention,
      committed: result.committed,
      // SP-11/3: the judge's unclipped per-AC rationale (→ "What happened"), the Spec's criterion
      // lines (→ AC-row text; acTexts[k-1] ↔ AC k), and the workers' out-of-scope discoveries.
      diagnosis: result.diagnosis,
      acTexts,
      discoveries: result.discoveries,
      // Repair window (2026-07-08): the prepare failure that blocked every AC, first-class.
      buildFailure: result.buildFailure,
      // SP-6/7 AC5: the durable, accumulated verification trace — surfaced in the delivery report
      // (which the panel renders) so a completed / stalled Spec carries the per-AC, per-round record.
      trace,
    });
  }

  /** Write the delivery summary to `specs/SP-{n}/DELIVERY.md` (a separate doc, so it doesn't touch
   *  the spec body / trip the staleness hash). Returns the thinking space-relative path, or undefined. */
  private async writeDeliverySummary(
    specNumber: string,
    worktreePath: string,
    result: SpecRunResult,
    dag: SchedUnit[],
  ): Promise<string | undefined> {
    try {
      const sha = await this.gitShortSha(worktreePath);
      const files = [...new Set(dag.flatMap((u) => u.footprint))].sort();
      const specDoc = await this.deps.store.getFile(
        this.deps.store.pathForSpecDoc(specNumber),
      );
      const verifs = parseAcVerifications(
        specDoc?.frontmatter?.ac_verifications,
      );
      // SP-11/3: the Spec's acceptance-criterion lines, indexed so `acTexts[k-1]` is AC k's text — the
      // gate already holds the spec body, so the AC rows can carry the criterion prose rather than a
      // bare ordinal. Built dense up to the highest declared ordinal (gaps → ""); no `## Acceptance
      // Criteria` block ⇒ undefined, and the report keeps its ordinal-only table.
      const acTextMap = acTextByOrdinal(specDoc?.body ?? "");
      const maxAc = acTextMap.size ? Math.max(...acTextMap.keys()) : 0;
      const acTexts =
        maxAc > 0
          ? Array.from({ length: maxAc }, (_, i) => acTextMap.get(i + 1) ?? "")
          : undefined;
      // SP-6/7 AC5: persist the DURABLE, structured verification trace alongside DELIVERY.md, merging
      // this run's entries into the accumulated per-Spec file (keyed by AC + rework round) so the record
      // grows across runs rather than being overwritten. The merged trace is what the report renders.
      const traceRel = this.deps.store
        .pathForSpecDoc(specNumber)
        .replace(/spec\.md$/, "VERIFICATION-TRACE.json");
      const traceAbs = path.join(this.deps.store.thinkubeDir, traceRel);
      const prior = this.readVerificationTrace(traceAbs);
      const trace = mergeVerificationTrace(prior, result.verificationTrace);
      try {
        fs.writeFileSync(traceAbs, JSON.stringify(trace, null, 2), "utf8");
      } catch (err) {
        this.deps.output.appendLine(
          `▸ SP-${specNumber}: verification trace skipped — ${(err as Error).message}`,
        );
      }
      const body = this.deliveryMarkdown(
        specNumber,
        sha,
        files,
        result,
        verifs,
        trace,
        acTexts,
      );
      const rel = this.deps.store
        .pathForSpecDoc(specNumber)
        .replace(/spec\.md$/, "DELIVERY.md");
      fs.writeFileSync(
        path.join(this.deps.store.thinkubeDir, rel),
        body,
        "utf8",
      );
      this.deps.output.appendLine(
        `▸ SP-${specNumber}: delivery summary → ${rel}`,
      );
      return rel;
    } catch (err) {
      this.deps.output.appendLine(
        `▸ SP-${specNumber}: delivery summary skipped — ${(err as Error).message}`,
      );
      return undefined;
    }
  }

  /** Read the durable per-Spec verification trace JSON (SP-6/7 AC5), or [] when absent / unreadable —
   *  best-effort: a missing or corrupt file must never fail the (already-completed) delivery write. */
  private readVerificationTrace(absPath: string): VerificationTraceEntry[] {
    try {
      const raw = fs.readFileSync(absPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as VerificationTraceEntry[]) : [];
    } catch {
      return [];
    }
  }

  private advance(handle: string): Promise<void> {
    return (this.deps.advance ?? ((h) => this.defaultAdvance(h)))(handle);
  }

  /** Default advance: stamp the slice `status: done` in its file. */
  private async defaultAdvance(handle: string): Promise<void> {
    const m = /^TEP-(\d+)_SP-(\d+)_SL-(\d+)$/.exec(handle);
    if (!m) return;
    const rel = this.deps.store.pathForSlice(`${m[1]}/${m[2]}`, Number(m[3]));
    const parsed = await this.deps.store.getFile(rel);
    if (!parsed?.frontmatter) return;
    await this.deps.store.writeFile(
      rel,
      { ...parsed.frontmatter, status: "done" },
      parsed.body,
    );
  }

  private flagAttention(
    handle: string,
    diagnosis: string,
    escalation?: {
      attempts: number;
      escalated: boolean;
      evidenceHash?: string;
      fault?: Fault;
    },
  ): Promise<void> {
    return (
      this.deps.flagAttention ??
      ((h, d, e) => this.defaultFlagAttention(h, d, e))
    )(handle, diagnosis, escalation);
  }

  /**
   * Default requires-attention flag: stamp the slice `status: requires-attention` and append
   * the worker's failure diagnosis to its body, so the stalled card carries the reason a human
   * needs (AC4). `/attend` (SL-5) returns it to the loop.
   *
   * Bounded rework loop (SP-6/6 AC5): when `escalation` is supplied this also persists the threaded
   * `rework_attempts` counter to the frontmatter (read back by `buildSlices` so the loop carries across
   * runs), and on ESCALATION sets a durable `escalated: true` flag + appends the {@link ESCALATION_MARKER}
   * to the body (idempotently, via the core's pure `markEscalated`) — the reload-surviving signal that the
   * bounded loop gave up and `readyFrontier` must no longer auto-re-dispatch this slice.
   */
  private async defaultFlagAttention(
    handle: string,
    diagnosis: string,
    escalation?: {
      attempts: number;
      escalated: boolean;
      evidenceHash?: string;
      fault?: Fault;
    },
  ): Promise<void> {
    const m = /^TEP-(\d+)_SP-(\d+)_SL-(\d+)$/.exec(handle);
    if (!m) return;
    const rel = this.deps.store.pathForSlice(`${m[1]}/${m[2]}`, Number(m[3]));
    const parsed = await this.deps.store.getFile(rel);
    if (!parsed?.frontmatter) return;
    // Replace, don't append (2026-07-11): the card states its CURRENT state.
    // Any previous ⚑ block collapses to a one-line `attention_history` entry;
    // exactly ONE live diagnosis remains on the body.
    const { base, blocks } = splitAttentionArtifacts(parsed.body ?? "");
    const priorHistory = Array.isArray(parsed.frontmatter.attention_history)
      ? (parsed.frontmatter.attention_history as string[])
      : [];
    const date = new Date().toISOString().slice(0, 10);
    const history = [
      ...priorHistory,
      ...blocks.map((b) => attentionHistoryEntry(b, date)),
    ];
    const note = `\n\n## ⚑ Requires attention\n\n${diagnosis}\n`;
    const bodyWithNote = base + note;
    await this.deps.store.writeFile(
      rel,
      {
        ...parsed.frontmatter,
        status: "requires-attention",
        ...(history.length ? { attention_history: history } : {}),
        ...(escalation ? { rework_attempts: escalation.attempts } : {}),
        ...(escalation?.escalated ? { escalated: true } : {}),
        // Circuit-breaker memory (2026-07-11): the normalized failing-evidence
        // hash, read back by buildSlices on the next run.
        ...(escalation?.evidenceHash
          ? { last_evidence_hash: escalation.evidenceHash }
          : {}),
        // Checkpoint-seeding route memory: which role's units must re-run.
        ...(escalation?.fault ? { last_fault: escalation.fault } : {}),
      },
      escalation?.escalated ? markEscalated(bodyWithNote) : bodyWithNote,
    );
  }

  private flagNeedsInput(
    handle: string,
    question: string,
    sessionId?: string,
    unitId?: string,
  ): Promise<void> {
    return (
      this.deps.flagNeedsInput ??
      ((h, q, s, u) => this.defaultFlagNeedsInput(h, q, s, u))
    )(handle, question, sessionId, unitId);
  }

  /**
   * Default needs-input park (SL-3): mark the slice `requires-attention` (the human-needed column)
   * but distinct from a failure — `needs_input: true` + the worker's `worker_session` (resume
   * fallback) + `worker_unit` (the resident-session key `/attend` uses) + the question under a
   * `## ❓ Needs input` heading. `/attend` (SL-5) answers it.
   */
  private async defaultFlagNeedsInput(
    handle: string,
    question: string,
    sessionId?: string,
    unitId?: string,
  ): Promise<void> {
    const m = /^TEP-(\d+)_SP-(\d+)_SL-(\d+)$/.exec(handle);
    if (!m) return;
    const rel = this.deps.store.pathForSlice(`${m[1]}/${m[2]}`, Number(m[3]));
    const parsed = await this.deps.store.getFile(rel);
    if (!parsed?.frontmatter) return;
    const note = `\n\n## ❓ Needs input\n\n${question}\n`;
    await this.deps.store.writeFile(
      rel,
      {
        ...parsed.frontmatter,
        status: "requires-attention",
        needs_input: true,
        ...(sessionId ? { worker_session: sessionId } : {}),
        ...(unitId ? { worker_unit: unitId } : {}),
      },
      (parsed.body ?? "") + note,
    );
  }

  private commit(
    handle: string,
    specNumber: string,
    cwd: string,
  ): Promise<void> {
    return (this.deps.commit ?? ((h, n, c) => this.defaultCommit(h, n, c)))(
      handle,
      specNumber,
      cwd,
    );
  }

  /** Run one git command in `cwd`, resolving its exit code (never rejects). */
  private git(cwd: string, args: string[]): Promise<number> {
    return new Promise((resolve) => {
      const p = spawn("git", args, { cwd, stdio: "ignore" });
      p.on("error", () => resolve(-1));
      p.on("close", (code) => resolve(code ?? -1));
    });
  }

  /**
   * Unit checkpoint commit (2026-07-11): the moment a work unit lands, commit
   * its footprint to the spec branch as `wip(<unit>)`. Completion is thereafter
   * DERIVED from git + the durable `units_done` frontmatter — a reset returns
   * to the checkpoint instead of deleting the work, so a re-dispatch schedules
   * only units with no checkpoint (plus units implicated by the judged fault,
   * which rework FROM their checkpoint instead of from zero). The gate-green
   * slice commit still lands whatever remains; PR-level squash keeps main's
   * history one verified commit per slice. Best-effort: a checkpoint failure
   * never fails the unit (the gate-green commit is the backstop), and a
   * non-git `worktreePath` (unit-test fixtures) is a no-op.
   */
  private async checkpointUnit(
    worktreePath: string,
    slice: string,
    unitId: string,
    footprint: string[],
  ): Promise<void> {
    try {
      if ((await this.git(worktreePath, ["rev-parse", "--git-dir"])) !== 0)
        return; // not a git repo (test fixture) — nothing to checkpoint
      const paths = (footprint ?? []).filter(
        (p) => typeof p === "string" && p.trim(),
      );
      if (paths.length) {
        for (const p of paths)
          await this.git(worktreePath, ["add", "-A", "--", p]);
      } else {
        await this.git(worktreePath, ["add", "-A"]);
      }
      const committed = await this.git(worktreePath, [
        "commit",
        "-m",
        `wip(${unitId}): unit checkpoint (pre-gate; superseded by the slice's verified commit / PR squash)`,
      ]);
      if (committed === 0)
        this.deps.output.appendLine(`▸ ${unitId}: checkpoint committed.`);
      // Durable unit-done record, read back by buildSlices on the next run.
      const m = /^TEP-(\d+)_SP-(\d+)_SL-(\d+)$/.exec(slice);
      if (!m) return;
      const rel = this.deps.store.pathForSlice(`${m[1]}/${m[2]}`, Number(m[3]));
      const parsed = await this.deps.store.getFile(rel);
      if (!parsed?.frontmatter) return;
      const prev = Array.isArray(parsed.frontmatter.units_done)
        ? (parsed.frontmatter.units_done as string[])
        : [];
      if (!prev.includes(unitId)) {
        await this.deps.store.writeFile(
          rel,
          { ...parsed.frontmatter, units_done: [...prev, unitId] },
          parsed.body,
        );
      }
    } catch {
      /* best-effort — the gate-green slice commit is the backstop */
    }
  }

  /** Roll a slice back to `ready`: used when its commit fails so it is never left
   *  Done with uncommitted work. Defaults to stamping `status: ready`. */
  private rollbackToReady(handle: string): Promise<void> {
    return (
      this.deps.rollbackToReady ?? ((h) => this.defaultRollbackToReady(h))
    )(handle);
  }

  /** Default rollback: stamp the slice `status: ready` (clearing any stale `units_landed`) so a
   *  later run re-attempts it. The work itself stays in the worktree — a re-run RESUMES (commits)
   *  rather than re-authors only when the run records `units_landed` without a commit. */
  private async defaultRollbackToReady(handle: string): Promise<void> {
    const m = /^TEP-(\d+)_SP-(\d+)_SL-(\d+)$/.exec(handle);
    if (!m) return;
    const rel = this.deps.store.pathForSlice(`${m[1]}/${m[2]}`, Number(m[3]));
    const parsed = await this.deps.store.getFile(rel);
    if (!parsed?.frontmatter) return;
    await this.deps.store.writeFile(
      rel,
      { ...parsed.frontmatter, status: "ready" },
      parsed.body,
    );
  }

  /** Tear down a finished Spec: remove its worktree (the committed branch survives the removal). */
  private teardown(specNumber: string): Promise<void> {
    return (
      this.deps.teardown ??
      ((n: string) =>
        this.deps.worktrees.remove(this.deps.canonicalRepo, n).then(() => {}))
    )(specNumber);
  }

  /**
   * Default per-slice commit: stage everything present and commit it as ONE slice's
   * landing, then **publish the branch** (workers never commit). Commit-before-Done — the caller only
   * marks the slice Done after this resolves; a rejection would roll it back to `ready`. Best-effort
   * at the git layer — a "nothing to commit" exit (e.g. a sibling slice already swept the worktree in
   * the same run) is NOT a failure, so we resolve rather than reject and the slice still advances. A
   * genuine rollback is driven by an injected git that rejects (tests). The branch MUST be pushed so
   * the commit isn't local-only; push is non-interactive and best-effort.
   */
  private defaultCommit(
    handle: string,
    specNumber: string,
    cwd: string,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const add = spawn("git", ["add", "-A"], { cwd });
      add.on("error", () => resolve());
      add.on("close", () => {
        const commit = spawn(
          "git",
          ["commit", "-m", `feat(${handle}): orchestrated slice complete`],
          { cwd },
        );
        commit.on("error", () => resolve());
        commit.on("close", () => {
          const push = spawn(
            "git",
            [
              "push",
              "-u",
              "origin",
              `spec/TEP-${specNumber.replace("/", "_SP-")}`,
            ],
            { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
          );
          push.on("error", () => resolve());
          push.on("close", () => resolve());
        });
      });
    });
  }
}

interface UnitDone {
  id: string;
  slice: string;
  outcome: UnitOutcome;
  /** The escalated question (needs-input only). */
  question?: string;
  /** The worker's session id (for resume-on-answer). */
  sessionId?: string;
  /** A requires-attention diagnosis to surface verbatim (failed only) — the footprint-containment
   *  hard-stop's offending-path message (SP-6/2 AC3). */
  attention?: string;
  /** True when this `failed` outcome is a footprint VIOLATION (the containment hard-stop aborted the
   *  unit), distinct from an ordinary failure — the run-halt policy halts on the first one (SP-2 AC5). */
  containment?: boolean;
  /** SP-11/3: the worker's final output text, mined for its trailing `## Discoveries` block. */
  finalOutput?: string;
}
