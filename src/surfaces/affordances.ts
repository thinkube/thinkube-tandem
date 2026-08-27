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
  "save-draft": {
    kind: "human",
    affordance: {
      surface: "the writing page",
      gesture: "type — every line is an ask, and the words are kept as you write them",
    },
  },
  "read-draft": {
    kind: "human",
    affordance: {
      surface: "the writing page",
      gesture: "press Read — it says what your words are about, and marks them up",
    },
  },
  "keep-draft": {
    kind: "human",
    affordance: {
      surface: "the writing page",
      gesture: "press Keep — the lines become asks, word for word, and the reading becomes their model",
    },
  },
  build: {
    kind: "human",
    affordance: {
      surface: "the work page",
      gesture: "press Build — it says what it costs and which sentences it makes read-only",
    },
  },
  think: {
    kind: "human",
    affordance: {
      surface: "the reading page",
      gesture: "go to the work page — that is what starts the thinking, and it says what it will cost",
    },
  },
  reframe: {
    kind: "human",
    affordance: {
      surface: "any sentence of yours",
      gesture: "say it differently — the reading re-forms, at a price shown first",
    },
  },
  amend: {
    kind: "human",
    affordance: {
      surface: "a sentence whose work is built",
      gesture: "add a new sentence that supersedes it — built work only changes through new work",
    },
  },
  "select-unit": {
    kind: "human",
    affordance: { surface: "the work graph", gesture: "click a promise" },
  },
  "accept-delivery": {
    kind: "human",
    affordance: {
      surface: "delivery page",
      gesture: "read the page, try the gestures, press Accept",
    },
  },
  "think-again": {
    kind: "human",
    affordance: { surface: "the work page", gesture: "press Think again" },
  },
  "reject-delivery": {
    kind: "human",
    affordance: {
      surface: "delivery page",
      gesture: "press Not this",
    },
  },
  "answer-worker": {
    kind: "human",
    affordance: {
      surface: "run view",
      gesture: "type into a parked worker's answer box and press Send",
    },
  },
  "dismiss-promise": {
    kind: "human",
    affordance: { surface: "the work graph's panel", gesture: "press Dismiss on a promise that should not exist, with a reason" },
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
  panic: {
    kind: "human",
    affordance: {
      surface: "map toolbar",
      gesture: "press Panic, then confirm — refused after any signed TEP",
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

