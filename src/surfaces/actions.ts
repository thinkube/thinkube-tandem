/**
 * Every action, declared once.
 *
 * An action used to be described in four places that had to agree by
 * somebody remembering: the surface contract held its label, `phase.ts` held
 * the phases it is allowed in, `mcp/boundary.ts` held whether a machine may
 * do it, and `extension.ts` held the ones that are VS Code commands. Four
 * lists, one subject, and no way to notice when they drifted — `look_at`
 * shipped as a tool and was refused on every call because it was in the
 * tool list and not in the boundary.
 *
 * So: one row per action, and every consumer reads from here. The surface
 * renders controls from it, the machine boundary answers from it, the phase
 * gate answers from it. Adding an action is one row; a row cannot be half
 * added, because nothing works until it exists.
 *
 * Three things every row carries, because a control that lacks any of them
 * is the control that fails silently:
 *
 *   `label`   what the person presses — their words, never the action id
 *   `when`    the phases it is live in; absent means always
 *   `mine`    why it is the person's alone, when it is. A machine asking is
 *             refused with this sentence rather than with "no".
 */

/** Where a space is, which decides what can be done in it. */
export type Phase = "drafting" | "read" | "understood" | "signed" | "running" | "delivered";

/** The phases in which work is shaped: a space that has been read and not
 *  yet signed, and one holding a delivery to decide about. */
const OPEN: readonly Phase[] = ["understood", "delivered"];
const WRITING: readonly Phase[] = ["drafting", "read", "understood", "delivered"];

export interface Action {
  /** What the person presses, in their register. */
  label: string;
  /** Phases this is live in. Absent: live in every phase — reading a log,
   *  selecting a unit, saving draft text, none of which shape anything. */
  when?: readonly Phase[];
  /** Why this is the person's alone. Present means a machine is refused,
   *  and this is the sentence it is refused with. */
  mine?: string;
  /** A VS Code command rather than a surface control: it runs outside the
   *  space's own phases, from the tree. Named here so the machine can reach
   *  it — creating a product or deploying a template was tree-only, which
   *  is why neither could be asked for through the MCP. */
  command?: string;
}

export const ACTIONS: Readonly<Record<string, Action>> = {
  // ── writing, and reading what was written ──────────────────────────
  "save-draft": { label: "Write" },
  "read-draft": { label: "Read", when: WRITING },
  "keep-draft": {
    label: "Keep",
    when: ["read"],
    mine: "turning drafted words into your asks is yours; a machine may draft, never keep",
  },
  "cancel-capture": { label: "Cancel", when: ["read"] },
  "capture-many": { label: "Read", when: ["read"] },

  // ── working out what was asked ─────────────────────────────────────
  think: { label: "Think", when: ["read", ...OPEN] },
  reread: {
    label: "Read again",
    when: OPEN,
    mine: "reading your sentences again from nothing deletes what they produced — yours to decide",
  },
  reground: { label: "Reground", when: OPEN },
  reframe: {
    label: "Reframe",
    when: OPEN,
    mine: "your ask is your words — a machine may never rewrite them",
  },
  amend: {
    label: "Amend",
    when: OPEN,
    mine: "your ask is your words — a machine may never rewrite them",
  },
  "dismiss-promise": {
    label: "Dismiss",
    when: OPEN,
    mine: "dropping a promise narrows what gets built, and narrowing is yours",
  },
  "propose-check": { label: "Work out a check", when: OPEN },
  "accept-check": {
    label: "Use this check",
    when: OPEN,
    mine: "a check you accept is one you vouched for; a machine may propose, never accept",
  },
  "accept-question": {
    label: "Decide",
    when: OPEN,
    mine: "your answer becomes a decision in force — only you can give it",
  },
  "accept-impact": { label: "Apply", when: OPEN },
  "dismiss-impact": {
    label: "Set aside",
    when: OPEN,
    mine: "discarding what a decision implies is a judgement, and it is yours",
  },
  "apply-all-impacts": { label: "Apply all", when: OPEN },
  "group-into-sets": { label: "Group into sets", when: OPEN },
  "choose-set": {
    label: "Build this set",
    when: OPEN,
    mine: "which set is built next decides what you get to look at, and in what order — a machine may propose the sets, never pick one",
  },
  "open-cut-review": { label: "Read the cut review", when: OPEN },
  "exempt-docs": {
    label: "Say why documentation is not needed",
    when: OPEN,
    mine: "recording that documentation is not needed is a judgement, and it is yours",
  },

  // ── the two gates ──────────────────────────────────────────────────
  build: {
    label: "Build",
    when: OPEN,
    mine: "signing a cut is the first gate — a machine may not sign work it will then do",
  },
  rerun: { label: "Run again", when: ["signed", "delivered"] },
  "think-again": {
    label: "Think again",
    when: ["signed"],
    mine: "withdrawing signed work discards what you approved — yours to decide",
  },
  "stop-run": { label: "Stop", when: ["running"] },
  "accept-delivery": {
    label: "Accept",
    when: ["delivered"],
    mine: "accepting a delivery is the second gate — a machine may not accept its own work",
  },
  "reject-delivery": {
    label: "Not this",
    when: ["delivered"],
    mine: "rejecting a delivery is a judgement about the work, and it is yours",
  },
  // Attesting is what a person does AFTER the work is theirs — the answer
  // to a promise nothing here could settle arrives once they have used it.
  "ask-platform-again": { label: "Ask the platform again", when: OPEN },
  contradict: {
    label: "It does not hold",
    when: OPEN,
    mine:
      "saying a delivered promise does not hold is the person's own judgement of the running thing — " +
      "a machine that could tell would have told at the gate",
  },
  attest: {
    label: "Attest",
    when: ["delivered"],
    mine:
      "attesting is the answer to a promise nothing mechanical could settle — installed on a clean " +
      "node, seen working. A machine saying it held would be inventing the one verdict it cannot reach",
  },

  // ── the space itself ───────────────────────────────────────────────
  panic: {
    label: "Panic",
    when: ["drafting", "read", "understood"],
    mine: "clearing what was derived is destructive and yours to decide",
  },
  "switch-repo": {
    label: "Switch",
    when: ["drafting", "read", "understood", "signed", "delivered"],
    mine: "changing which project you are working on moves the ground under you",
  },

  // ── always live: reading and answering shape nothing ───────────────
  "select-unit": { label: "Select" },
  "read-log": { label: "Read log" },
  "answer-worker": { label: "Answer" },
  "retry-model": { label: "Retry" },
  "look-at": { label: "Look at it" },
  "mint-approval": { label: "Approve", mine: "an approval stands for your click; a machine minting one forges it" },

  // ── reading, in every shape: asking never changes anything ─────────
  "read-space": { label: "Read the space" },
  "read-run": { label: "Read the run" },
  "read-delivery": { label: "Read the delivery" },
  "read-defects": { label: "Read the defect record" },
  "read-allowed": { label: "Read what is allowed now" },
  "full-rerun": { label: "Run again from nothing" },
  "list-spaces": { label: "List the spaces" },
  "stop-run-tool": { label: "Stop the run" },

  // ── the tree's own commands, reachable from the machine at last ────
  "new-product": { label: "New product", command: "thinkube-tandem.newProduct" },
  "new-project": { label: "New project", command: "thinkube-tandem.newProject" },
  "open-space": { label: "Open space", command: "thinkube-tandem.openSpace" },
  "activate-project": { label: "Activate", command: "thinkube-tandem.activateProject" },
  "set-product": { label: "Move to product", command: "thinkube-tandem.setProduct" },
  "set-context-scope": { label: "Set what it may read", command: "thinkube-tandem.setContextScope" },
  "toggle-project-done": { label: "Mark done", command: "thinkube-tandem.toggleProjectDone" },
};

/** Every action name, for a consumer that enumerates rather than looks up. */
export const ACTION_NAMES: readonly string[] = Object.keys(ACTIONS);

/** Actions that SHAPE work, and so answer to the phase. Everything else —
 *  reading a log, selecting, answering a parked worker, saving draft text —
 *  is live whenever the space is. */
export const SHAPES = new Set(ACTION_NAMES.filter((a) => ACTIONS[a].when));

/** What the person presses, or the action's own name when nothing better
 *  exists — a control with no name is worse than a clumsy one. */
export function labelOf(action: string): string {
  return ACTIONS[action]?.label ?? action;
}

/** The shaping actions live in this phase, which the surface enables and
 *  nothing else. */
export function liveIn(phase: Phase): string[] {
  return ACTION_NAMES.filter((a) => ACTIONS[a].when?.includes(phase));
}

/** Whether a machine may do this at all, and why not when it may not. */
export function machineMay(action: string): { ok: true } | { ok: false; reason: string } {
  const a = ACTIONS[action];
  if (!a) return { ok: false, reason: `${action} is not declared — refused until it is` };
  return a.mine ? { ok: false, reason: a.mine } : { ok: true };
}
