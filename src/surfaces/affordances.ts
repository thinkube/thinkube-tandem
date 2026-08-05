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
