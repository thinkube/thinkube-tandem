/**
 * The contract between the host and the space surface: what the host
 * pushes, what the surface may send back, and which of those actions the
 * phase governs.
 *
 * It lives here, in the host's own tree, because both sides read it and a
 * contract with two copies is a contract that drifts. The webview's
 * bridge re-exports it, so the surface's files import it unchanged; the
 * bridge keeps only what is genuinely the webview's — the postMessage
 * plumbing and the window listener.
 *
 * Nothing here touches the DOM, `vscode`, or disk, so the host's own
 * checks import it and drive it directly.
 */
import type { SurfacePage } from "./surfaceLayout";
import { ACTION_NAMES, labelOf, SHAPES } from "./actions";
export type { SurfacePage } from "./surfaceLayout";

/** The one page that draws your asks. Named here, once, so the surface
 *  and its checks read the same answer instead of each deciding page by
 *  page which one shows the list. */
export const ASKS_PAGE: SurfacePage = "intent";

/** Whether this page draws the ask list. Exactly one page does. */
export function drawsAskList(page: SurfacePage): boolean {
  return page === ASKS_PAGE;
}

/** One check, with its verification state — read on the claim card
 *  independently of how many iterations produced it. */
interface CheckVM {
  /** The criterion's own id — what a delivery's proof is recorded against. */
  id: string;
  text: string;
  /** "assessment" = judged once at delivery by an independent reviewer;
   *  absent = a standing probe. */
  kind?: "assessment";
  /** The newest verdict any delivery recorded for this check: proved, not
   *  proved, or never judged because the check could not run. */
  verdict?: "green" | "red" | "unjudged";
  /** What that verdict means, in plain words: the failing assertion, or
   *  why nothing was judged. Absent when it is proved. */
  said?: string;
  tep?: string;
  accepted?: boolean;
  /** Where the standing proof lives in the repository's own suite. */
  proof?: { path: string; test?: string };
  /** The world moved since this was verified — proved-then, not proved-now. */
  drifted?: boolean;
}

interface PromiseVM {
  id: string;
  text: string;
  file: string;
  checks: CheckVM[];
  /** Effects the machine cannot verify, with the reason — notes, not checks. */
  unverified?: { text: string; why: string }[];
  needs: string[];
  stale: boolean;
  tep?: string;
}

interface ClaimVM {
  id: string;
  text: string;
  why?: string;
  /** The human's sentence this claim was read from — never replaced. */
  fromAsk: string;
  /** Its id and its number in your list, so the claim can point back. */
  fromAskId: string;
  fromAskN: number;
  /** The words of that sentence this claim was read from, and the words in
   *  it that stand for the subject — what the page marks inside your own
   *  sentence, so the reading is shown where you wrote it rather than
   *  repeated underneath in the machine's arrangement. */
  quote?: string;
  mention?: string;
  promises: PromiseVM[];
}

interface SubjectVM {
  id: string;
  name: string;
  thinking?: { label: string; current: number; total: number };
  claims: ClaimVM[];
  /** The sentences of yours this object was read from — its provenance,
   *  shown so a second listing of your words reads as a link and not as
   *  repetition. */
  from: { id: string; n: number; text: string }[];
}

interface DeliveryVM {
  id: string;
  page: string;
  accepted: boolean;
  /** Why it cannot be accepted, from the gate that would refuse it. */
  blocked?: string;
  url?: string;
  undelivered?: string[];
  /** What only the person can certify, by using the delivered thing. */
  observations?: string[];
  /** Promises whose answer comes from somewhere this run cannot reach —
   *  each with where it will come from, and whether it has arrived. A
   *  person attests the ones only a person can settle. */
  pending?: { criterionId?: string; text: string; settledBy: string; ref?: string }[];
  /** Why the delivery was withheld, and the signed work to run again. */
  withheld?: string;
  /** This delivery's own verdicts, by criterion — what the report is
   *  painted from, never a newer or older run's. */
  proofs?: { criterionId: string; verdict: "green" | "red" | "unjudged"; said?: string }[];
  rerun?: { id: string; tepId?: string };
}

interface RunView {
  units: {
    id: string;
    slice: string;
    /** The slice in the human's words, when the space still knows it. */
    sliceTitle?: string;
    /** The promise this unit's slice is keeping — the card's title (or a
     *  count when it holds more than one) and the full sentence(s) for
     *  hover, in the space's own wording. Absent when no change could be
     *  matched to the unit; the card falls back to its slice title. */
    promiseLabel?: { label: string; full: string };
    role: "code" | "test" | "maintain";
    /** What this unit builds, in the reading's own words. */
    what?: string;
    state: string;
    requires: string[];
    /** Why it waits, per edge: a cross-slice dependency, or the probes
     *  that must exist before a coder starts. */
    waits?: { on: string; kind: "needs" | "probes"; what?: string }[];
    startedAt?: number;
    question?: string;
    /** Why it failed, in the words the worker or the gate reported. */
    note?: string;
    /** What it is doing or waiting on right now, and since when. */
    activity?: { text: string; since: number };
  }[];
  logs: string[];
  parked: { unitId: string; question: string }[];
  /** How many lines each step holds — the surface pages them on demand. */
  logCounts: Record<string, number>;
  /** Per-slice acceptance-criteria outcomes, from the last grading — the
   *  audit card's own account of what passed and what did not. */
  sliceChecks?: Record<string, { ac: number; pass: boolean; text?: string }[]>;
  /** The door before the first worker and the delivery after the gate:
   *  each a card on the page with a state, what it is doing, and a log. */
  phases?: Record<"door" | "gate" | "delivery", { state: "pending" | "running" | "done" | "failed"; doing?: string; since?: number }>;
}

export interface SpacePush {
  kind: "space";
  running: boolean;
  /** Where the space is in its sequence of steps — controls follow it. */
  phase: "drafting" | "read" | "understood" | "signed" | "running" | "delivered";
  /** The shaping actions the host acts on right now; a control for any
   *  other shaping action is disabled, and `post` drops it. */
  allowed: string[];
  /** Set when the space predates the model — readable, not writable. */
  legacy?: string;
  signedTeps: number;
  repoName?: string;
  /** The thinking space this push is about, by the name the person gave
   *  it. Without it an empty panel cannot say WHICH space is empty, and a
   *  person looking at blank chrome has no way to tell an empty space from
   *  a broken one — nor did I, with the filesystem in front of me. */
  spaceName?: string;
  /** No repository chosen yet — the view renders the chooser state. */
  needsRepo?: boolean;
  /** Liveness: what the machine is doing right now, and for which ask. */
  activity?: { label: string; current: number; total: number; askId?: string };
  pendingCheck?: { changeId: string; text: string; kind: "probe" | "assessment" };
  /** Why the last build did not start — rendered on the flow tab. */
  runNote?: string;
  /** Work that was signed and never delivered — it can be run again. */
  unrun?: { id: string; tepId?: string };
  /** The one notice for signed work that has not delivered — its heading,
   *  its sentence, and which ways back in ride with it. Every page renders
   *  this instead of wording the fact again. Absent while a run is in
   *  flight, or when there is no signed, undelivered work. */
  signedIdle?: { heading: string; sentence: string; canRerun: boolean; canThinkAgain: boolean };
  /** One live progress row per ask being grounded right now. */
  grounding?: { askId: string; label: string; current: number; total: number }[];
  run?: RunView;
  /** The tail of one step's own log, and how long the whole log is. */
  runLog?: { step: string; lines: string[]; total: number; shown: number };
  questions: {
    id: string;
    text: string;
    recommendation?: string;
    askLabel?: string;
    cards: { id: string; title: string }[];
  }[];
  decisions: string[];
  /** Promises the machine could not attach to any claim. */
  orphans: { id: string; text: string }[];
  /** Your sentences: what each decided, what was assumed in its name, and
   *  whether it is still yours to edit. */
  sentences: {
    id: string;
    text: string;
    state: "open" | "bound";
    subjects: number;
    promises: number;
    alsoReads: string[];
    amends?: string;
    /** What became of this ask's work: approved, delivered, or accepted
     *  into the project. Absent while the ask is still yours to edit. */
    bound?: { tep?: string; stage: "signed" | "delivered" | "accepted" };
    assumptions: { question: string; answer: string; clause?: string; assumed: boolean }[];
  }[];
  /** What thinking about what is left will cost. */
  cost: { subjects: number; rounds: number };
  /** What the machine read before the code moved under it: how many
   *  promises say something that may no longer be true, how many objects
   *  would be read again to settle them, and what that costs. */
  outOfDate: { promises: number; subjects: number; rounds: number };
  /** What can be committed right now. `thinking` means the machine is
   *  still deriving and nothing may be committed yet. */
  ready: { subjects: number; promises: number; asks: number; thinking: boolean };
  /** Why the last Sign and build was refused — beside the button, until a press succeeds. */
  buildRefusal?: string;
  /** Why the last press of Accept did nothing — beside the button, until a press succeeds. */
  acceptRefusal?: string;
  /** A reading that failed: nothing derived, and why. */
  modelFailure?: { reason: string; sentences: number };
  /** What you are writing, kept with the space so it survives a reload. */
  draft: string;
  /** The reading of the draft, and whether it still matches what is
   *  written: subjects with their claims, each claim carrying the words
   *  it was read from, the pronoun that stood for the subject, and any
   *  earlier claim it displaces. */
  pendingModel?: {
    subjects: {
      name: string;
      from: number[];
      claims: {
        text: string;
        why?: string;
        from: number;
        quote?: string;
        mention?: string;
        replaces?: string;
      }[];
    }[];
    /** The sentences it was read from, in order — what the marks are
     *  drawn on. Recorded asks first, then what is still written. */
    texts: string[];
    /** The tail of `texts` that is still yours to change: what the words
     *  in the box were read as. Compared with the box to know whether the
     *  reading is behind. */
    fresh: string[];
    missing: string[];
  };
  impacts: { id: string; decision: string; askText: string; affected: number }[];
  /** The sets worth delivering on their own — the person's grouping of their
   *  own subjects. Empty until it is made; the surface behaves as before. */
  specs?: {
    id: string;
    name: string;
    subjects: number;
    /** Which of the person's own sentences it carries, by their numbers. */
    asks?: number[];
    promises: number;
    /** In the cut right now — one set at a time, so at most one is. */
    chosen: boolean;
    /** Every promise of it is signed: built already, and not offered again. */
    built: boolean;
    /** The repositories it lands in. More than one is fine and is said: the
     *  parts are delivered separately and accepted together, because a
     *  provider and its consumer are one piece of work. */
    repos: string[];
  }[];
  subjects: SubjectVM[];
  cutCount: number;
  deliveries: DeliveryVM[];
  /** The one rule's verdict for the pending cut, carried by the push so the
   *  rail states it rather than working it out again: landed with its
   *  paths, exempt with its reason, or missing. */
  documentation: { state: "landed" | "exempt" | "missing"; landings: string[]; reason?: string };
  message?: string;
}

export type WebToHost =
  | { action: "load" }
  | { action: "save-draft"; text: string }
  | { action: "read-draft" }
  | { action: "keep-draft" }
  | { action: "cancel-capture" }
  | { action: "reground" }
  | { action: "open-cut-review" }
  | { action: "answer-worker"; unitId: string; text: string }
  | { action: "retry-model" }
  | { action: "reframe"; unitId: string; text: string }
  | { action: "amend"; unitId: string; text: string }
  | { action: "think" }
  | { action: "build"; specId?: string; changeIds?: string[] }
  | { action: "dismiss-promise"; unitId: string; text?: string }
  | { action: "read-log"; stepId?: string }
  | { action: "stop-run" }
  | { action: "pin"; pinKind: "together" | "apart"; changeIds: [string, string] }
  | { action: "select-unit"; unitId: string }
  | { action: "accept-delivery"; deliveryId: string }
  | { action: "reject-delivery"; deliveryId: string }
  /** What only a person can settle, settled: installed on a clean node,
   *  seen working in the running product. Closes the one pending promise
   *  it names, in the person's own words. */
  | { action: "attest"; deliveryId: string; criterionId: string; held: boolean; note?: string }
  | { action: "panic" }
  | { action: "rerun" }
  | { action: "think-again" }
  | { action: "reread" }
  | { action: "accept-question"; questionId: string; text?: string }
  | { action: "accept-impact"; impactId: string }
  | { action: "dismiss-impact"; impactId: string }
  | { action: "apply-all-impacts" }
  | { action: "group-into-sets" }
  | { action: "choose-set"; specId: string }
  | { action: "propose-check"; changeIds: string[] }
  | { action: "accept-check"; changeIds: string[]; text: string; kind: "probe" | "assessment" }
  | { action: "exempt-docs"; reason: string }
  | { action: "switch-repo" };

/** The actions that shape work, and so are governed by the phase. The
 *  hygiene check reads this set to prove it names exactly what the host's
 *  phase table governs — the two must not drift apart. */
export const SHAPING = SHAPES;

/** The shaping actions the host allows right now, from the last push, and
 *  the phase that push carried. Before the first push nothing is known, so
 *  nothing is refused here — the host still refuses on its side. */
let allowedNow: string[] | undefined;
let phaseNow: SpacePush["phase"] | undefined;

/** What the host allows now, and in which phase — set by every push, and by
 *  a harness that renders the surface without a host. */
export function noteAllowed(allowed: string[] | undefined, phase?: SpacePush["phase"]): void {
  allowedNow = allowed;
  phaseNow = phase;
}

/** Whether the host would act on this action now. Non-shaping actions
 *  (reading a log, selecting, answering a worker, saving text) are always on. */
export function can(action: string): boolean {
  if (!SHAPING.has(action)) return true;
  return !allowedNow || allowedNow.includes(action);
}

/**
 * The person-facing name for every control the phase can govern, or that a
 * refusal names — the same word the affordance registry's gesture uses for
 * it, so a control is never called one thing in a refusal and another in an
 * instruction.
 */
export const CONTROL_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  ACTION_NAMES.map((a) => [a, labelOf(a)]),
);

/** Why a control is off, for its tooltip — one sentence per phase, when this
 *  phase has its own reason. Absent for a phase with no phase-specific
 *  wording, so callers fall back to the bare "Not now." */
const PHASE_REASON: Partial<Record<NonNullable<SpacePush["phase"]>, string>> = {
  running: "a run is in flight — stop it first",
  signed: "signed work is waiting to run — run it, or it stays as it is",
  delivered: "a delivery is waiting for your decision",
  read: "the reading is waiting for keep or edit",
  understood: "nothing is signed or running",
  drafting: "nothing has been read yet",
};

const NO_REASON = "Not now.";

/** One sentence naming a governed control and why it is unavailable right
 *  now: the control's person-facing name, and this phase's reason when one
 *  is defined — the bare fallback otherwise. This is the one place the
 *  per-phase wording lives; nothing else keeps its own copy. */
export function refusalSentence(action: string, phase: SpacePush["phase"] | undefined): string {
  const name = CONTROL_NAMES[action] ?? action;
  const reason = phase ? PHASE_REASON[phase] : undefined;
  return reason ? `${name} — not now: ${reason}.` : `${name}: ${NO_REASON}`;
}

/** The refusal sentence for this action, if the last-noted allowed list
 *  excludes it — undefined when the action is allowed (or nothing is known
 *  yet about what is allowed). */
export function refusalIfRefused(action: string): string | undefined {
  if (can(action)) return undefined;
  return refusalSentence(action, phaseNow);
}

/**
 * Whether a "passed" verdict is backed by a log a person can read, and the
 * sentence that says so either way. A step can be marked done because an
 * earlier run already proved it — the log for that proof may or may not
 * still be on this run's record — so the surface never draws a bare
 * "passed" that implies evidence nobody can actually open.
 */
export function proofOfPass(logLines: number): { text: string; proven: boolean; why: string } {
  if (logLines > 0)
    return {
      text: `passed — ${logLines} log line${logLines === 1 ? "" : "s"}`,
      proven: true,
      why: "Click this card to read the log lines that prove it passed.",
    };
  return {
    text: "passed — no log of the proof is kept",
    proven: false,
    why: "This step is marked passed, but no log of the proof survives to read.",
  };
}
