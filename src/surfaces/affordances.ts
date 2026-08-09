/**
 * The affordance registry: every capability the system accepts maps to a
 * human door — a surface and a gesture — or declares itself machine-only
 * with a reason. The suite walks this registry against the session's
 * accepted actions; a capability without a door fails the build.
 */

interface Affordance {
  surface: string;
  gesture: string;
}

export type AffordanceEntry =
  | { kind: "human"; affordance: Affordance }
  | { kind: "machine-only"; reason: string };

/** Every accepted session action — the reachability test's ground truth. */
// prettier-ignore
// Derived from the registry below — the list can never drift empty again.
export const SESSION_ACTIONS: string[] = [];

export const AFFORDANCES: Record<string, AffordanceEntry> = {
  capture: {
    kind: "human",
    affordance: {
      surface: "map toolbar",
      gesture: "type into the capture box and press Enter",
    },
  },
  "select-unit": {
    kind: "human",
    affordance: { surface: "the work graph", gesture: "click a promise" },
  },
  "toggle-cut": {
    kind: "human",
    affordance: {
      surface: "unit detail panel",
      gesture: "press Add to cut / Remove from cut",
    },
  },
  "sign-cut": {
    kind: "human",
    affordance: {
      surface: "cut screen",
      gesture: "review the cut screen and press Sign",
    },
  },
  "accept-delivery": {
    kind: "human",
    affordance: {
      surface: "delivery page",
      gesture: "read the page, try the gestures, press Accept",
    },
  },
  "accept-question": {
    kind: "human",
    affordance: {
      surface: "questions panel",
      gesture: "press Accept on a question — or edit its recommendation first and accept your wording",
    },
  },
  "answer-worker": {
    kind: "human",
    affordance: {
      surface: "run view",
      gesture: "type into a parked worker's answer box and press Send",
    },
  },
  "accept-model": {
    kind: "human",
    affordance: { surface: "the model the round proposed", gesture: "press 'Yes — think about these' to record it and start thinking" },
  },
  "revise-model": {
    kind: "human",
    affordance: { surface: "the model the round proposed", gesture: "drop a subject or a rule, or turn a subject's claims into rules, before accepting" },
  },
  "rename-subject": {
    kind: "human",
    affordance: { surface: "the intent graph's panel", gesture: "press Rename on the selected subject and type your word for it" },
  },
  "merge-subject": {
    kind: "human",
    affordance: { surface: "the intent graph's panel", gesture: "press 'Merge into…' and pick the subject it is really the same as" },
  },
  "split-claim": {
    kind: "human",
    affordance: { surface: "the intent graph's panel", gesture: "press 'Split out' on a claim — it becomes its own subject" },
  },
  "move-claim": {
    kind: "human",
    affordance: { surface: "the intent graph's panel", gesture: "press 'Move to…' on a claim and pick the subject it belongs to" },
  },
  "promote-claim": {
    kind: "human",
    affordance: { surface: "the intent graph's panel", gesture: "press 'Make a rule' on a claim that governs more than its subject" },
  },
  "attach-promise": {
    kind: "human",
    affordance: {
      surface: "the intent graph's unattached list",
      gesture: "pick the claim a promise makes true and press Attach",
    },
  },
  "dismiss-promise": {
    kind: "human",
    affordance: { surface: "the work graph's panel", gesture: "press Dismiss on a promise that should not exist, with a reason" },
  },
  "retire-rule": {
    kind: "human",
    affordance: { surface: "the rules band", gesture: "press Retire on a rule — it governs nothing from then on" },
  },
  "retry-model": {
    kind: "human",
    affordance: { surface: "the intent graph, after a failed reading", gesture: "press 'Read it again' — your sentences are already recorded" },
  },
  "read-log": {
    kind: "human",
    affordance: { surface: "orchestration graph", gesture: "click a step to read its own log, and page through it" },
  },
  "stop-run": {
    kind: "human",
    affordance: { surface: "run view", gesture: "press Stop" },
  },
  "accept-impact": {
    kind: "human",
    affordance: { surface: "decisions panel", gesture: "press Re-derive on a staged decision implication" },
  },
  "dismiss-impact": {
    kind: "human",
    affordance: { surface: "decisions panel", gesture: "press Dismiss — the definitions stay as they are" },
  },
  "apply-all-impacts": {
    kind: "human",
    affordance: { surface: "decisions panel", gesture: "press Apply all — each affected ask re-thinks once, five at a time" },
  },
  panic: {
    kind: "human",
    affordance: {
      surface: "map toolbar",
      gesture: "press Panic, then confirm — refused after any signed TEP",
    },
  },
  "propose-check": {
    kind: "human",
    affordance: {
      surface: "the work graph",
      gesture: "press 'Write a check' on a promise that has none",
    },
  },
  "accept-check": {
    kind: "human",
    affordance: {
      surface: "the panel, when a check is proposed",
      gesture: "accept the proposed check, or reword it first — your wording wins",
    },
  },
  reground: {
    kind: "human",
    affordance: {
      surface: "units map",
      gesture: "press an out-of-date badge to re-read the code under those promises",
    },
  },
};

SESSION_ACTIONS.push(...Object.keys(AFFORDANCES));

/** The walkthrough line for a delivery: generated, so it can only name doors that exist. */
export function gestureFor(action: string): string | undefined {
  const entry = AFFORDANCES[action];
  return entry?.kind === "human"
    ? `${entry.affordance.surface}: ${entry.affordance.gesture}`
    : undefined;
}
