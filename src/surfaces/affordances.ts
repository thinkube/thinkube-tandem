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
export const SESSION_ACTIONS: string[] = [
  
];

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
    affordance: { surface: "units map", gesture: "click a unit card" },
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
  "flip-face": {
    kind: "human",
    affordance: {
      surface: "every abstract",
      gesture: "press the ⌄ chevron to open the machine face",
    },
  },
  "accept-question": {
    kind: "human",
    affordance: {
      surface: "questions panel",
      gesture: "press Accept on a question — or edit its recommendation first and accept your wording",
    },
  },
  pin: {
    kind: "human",
    affordance: {
      surface: "unit panel",
      gesture: "press 'Merge into one slice' with two or more units in the cut, or 'Split out' on a change",
    },
  },
  "answer-worker": {
    kind: "human",
    affordance: {
      surface: "run view",
      gesture: "type into a parked worker's answer box and press Send",
    },
  },
  "stop-run": {
    kind: "human",
    affordance: { surface: "run view", gesture: "press Stop" },
  },
  "accept-merge": {
    kind: "human",
    affordance: { surface: "suggestions panel", gesture: "press Merge on a staged merge suggestion" },
  },
  "reject-merge": {
    kind: "human",
    affordance: { surface: "suggestions panel", gesture: "press Reject — the pair is never proposed again" },
  },
  "accept-impact": {
    kind: "human",
    affordance: { surface: "decisions panel", gesture: "press Re-derive on a staged decision implication" },
  },
  "dismiss-impact": {
    kind: "human",
    affordance: { surface: "decisions panel", gesture: "press Dismiss — the definitions stay as they are" },
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
      surface: "selected unit detail",
      gesture: "press 'Write a check' on a promise that has none",
    },
  },
  "accept-check": {
    kind: "human",
    affordance: {
      surface: "selected unit detail",
      gesture: "accept (or reword) the proposed check — your wording wins",
    },
  },
  reground: {
    kind: "human",
    affordance: {
      surface: "units map",
      gesture: "press a stale badge to re-ground the changes it marks",
    },
  },
};

/** The walkthrough line for a delivery: generated, so it can only name doors that exist. */
export function gestureFor(action: string): string | undefined {
  const entry = AFFORDANCES[action];
  return entry?.kind === "human"
    ? `${entry.affordance.surface}: ${entry.affordance.gesture}`
    : undefined;
}
