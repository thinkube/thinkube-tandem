/**
 * The affordance registry: every capability the system accepts maps to a
 * human door — a page and a gesture — or declares itself machine-only with
 * a reason. The suite walks this registry against the session's accepted
 * actions; a capability without a door fails the build.
 *
 * A door names one of the pages the surface really has, not a prose
 * description of a place. `page` is a key of `PAGES` — the same register
 * the surface's layout draws from — so an instruction can never point at
 * "the reading page" or "units map" when the surface draws no such thing.
 */

export interface Affordance {
  /** A key of PAGES — the page a person goes to for this gesture. */
  page: string;
  gesture: string;
}

export type AffordanceEntry =
  | { kind: "human"; affordance: Affordance }
  | { kind: "machine-only"; reason: string };

/**
 * The pages an instruction can name, each with the label a person reads
 * and the handle its rendered wrapper carries. Every one of the surface's
 * four pages (`SURFACE_PAGES`) has an entry here; `delivery-report` is the
 * one entry that is not a surface page — it names itself as such below,
 * because the delivery report is drawn inside the flow page rather than
 * being a fifth tab.
 */
export const PAGES: Record<string, { label: string; handle: string }> = {
  write: { label: "the write page", handle: "data-write-page" },
  intent: { label: "the intent page", handle: "data-intent-page" },
  work: { label: "the work page", handle: "data-work-page" },
  flow: { label: "the orchestration page", handle: "data-flow-page" },
  // Not one of SURFACE_PAGES's four tabs: the delivery report renders
  // inside the flow page once a run has produced one. Named here so a
  // door can point at it without being mistaken for a fifth tab.
  "delivery-report": { label: "the delivery report", handle: "data-delivery-report" },
};

export const AFFORDANCES: Record<string, AffordanceEntry> = {
  "save-draft": {
    kind: "human",
    affordance: {
      page: "write",
      gesture: "Write — every line is an ask, and the words are kept as you write them",
    },
  },
  "read-draft": {
    kind: "human",
    affordance: {
      page: "write",
      gesture: "press Read — it says what your words are about, and marks them up",
    },
  },
  "keep-draft": {
    kind: "human",
    affordance: {
      page: "write",
      gesture: "press Keep — the lines become asks, word for word, and the reading becomes their model",
    },
  },
  build: {
    kind: "human",
    affordance: {
      page: "work",
      gesture: "press Build — it says what it costs and which sentences it makes read-only",
    },
  },
  think: {
    kind: "human",
    affordance: {
      page: "intent",
      gesture: "go to the work page — that is what starts Think, and it says what it will cost",
    },
  },
  reframe: {
    kind: "human",
    affordance: {
      page: "intent",
      gesture: "press Reframe and say it differently — the reading re-forms, at a price shown first",
    },
  },
  amend: {
    kind: "human",
    affordance: {
      page: "work",
      gesture: "press Amend and add a new sentence that supersedes it — built work only changes through new work",
    },
  },
  "select-unit": {
    kind: "human",
    affordance: { page: "work", gesture: "Select a promise by clicking it" },
  },
  "accept-delivery": {
    kind: "human",
    affordance: {
      page: "delivery-report",
      gesture: "read the page, try the gestures, press Accept",
    },
  },
  attest: {
    kind: "human",
    affordance: {
      page: "delivery-report",
      gesture: "install it, use it, then press Attest to say whether it held",
    },
  },
  "think-again": {
    kind: "human",
    affordance: { page: "work", gesture: "press Think again" },
  },
  "reject-delivery": {
    kind: "human",
    affordance: {
      page: "delivery-report",
      gesture: "press Not this",
    },
  },
  "answer-worker": {
    kind: "human",
    affordance: {
      page: "flow",
      gesture: "type into a parked worker's answer box in the rail and press Answer",
    },
  },
  "dismiss-promise": {
    kind: "human",
    affordance: { page: "work", gesture: "press Dismiss on a promise that should not exist, with a reason" },
  },
  "retry-model": {
    kind: "human",
    affordance: { page: "intent", gesture: "press Retry — your sentences are already recorded" },
  },
  "read-log": {
    kind: "human",
    affordance: { page: "flow", gesture: "press Read log on a step to read its own log, and page through it" },
  },
  "stop-run": {
    kind: "human",
    affordance: { page: "flow", gesture: "press Stop" },
  },
  panic: {
    kind: "human",
    affordance: {
      page: "write",
      gesture: "press Panic, then confirm — refused after any signed TEP",
    },
  },
  reground: {
    kind: "human",
    affordance: {
      page: "work",
      gesture: "press Reground on an out-of-date badge to re-read the code under those promises",
    },
  },
  "accept-impact": {
    kind: "human",
    affordance: {
      page: "write",
      gesture: "press Apply on the implication you want in force",
    },
  },
  "dismiss-impact": {
    kind: "human",
    affordance: {
      page: "write",
      gesture: "press Set aside on the implication you do not want applied",
    },
  },
  "apply-all-impacts": {
    kind: "human",
    affordance: {
      page: "write",
      gesture: "press Apply all, shown once two or more implications are staged",
    },
  },
};
