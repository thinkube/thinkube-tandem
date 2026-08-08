/**
 * The core artifacts of Tandem: asks, nodes, units, cuts, work orders,
 * deliveries. Three rules shape every type here:
 *  - asks are the human's words, verbatim — no field the machine rewrites;
 *  - grounding anchors are structural (path + symbol), never line numbers;
 *  - every derived thing carries a stamp so its currency is checkable.
 */
import type { SourceStamp } from "./stamp";

export interface Ask {
  id: string;
  /** The human's words, byte for byte. */
  text: string;
  /** ISO timestamp of capture. */
  at: string;
}

/**
 * One place a change lands. `symbol` is a symbol path inside the file
 * ("reduce › case grow"); line numbers are rendered from anchors at the
 * moment of use and never stored.
 */
export interface Anchor {
  path: string;
  symbol?: string;
  /** The file does not exist yet — grounding against planned structure.
   *  Planned anchors are exempt from stamp acceptance until the file is born. */
  planned?: boolean;
  /** Project scope id (§7quater) — absent means the anchor scope. A slice
   *  never crosses scopes; a change never mixes them. */
  scope?: string;
}

/** Refuses anchors that smuggle in positions (line/column suffixes). */
export function validateAnchor(a: Anchor): string | undefined {
  if (!a.path.trim()) return "anchor has an empty path";
  if (/[:#]L?\d+\s*$/.test(a.path))
    return `anchor path carries a position ("${a.path}") — anchors are structural; lines are rendered at use`;
  return undefined;
}

interface Grounding {
  touchpoints: Anchor[];
  stamp: SourceStamp[];
}

/** What proves a promise kept. `probePath` binds the executable form;
 *  kind "assessment" marks a check no runnable test fits — graded at the
 *  closing gate by a fresh, independent assessor, never the builder. */
export interface AcceptanceCriterion {
  id: string;
  text: string;
  probePath?: string;
  kind?: "probe" | "assessment";
}

/**
 * One grounded intended change: a sentence for the human, grounding
 * underneath, edges to the asks it serves and the nodes it needs, and the
 * acceptance that will prove it.
 */
export interface Change {
  id: string;
  /** The human-facing sentence — a render, restamped when inputs move. */
  sentence: string;
  /** Ask ids this node serves. Empty = orphan, flagged as scope creep. */
  serves: string[];
  /** Node ids this node needs built first. */
  needs: string[];
  grounding?: Grounding;
  acceptance: AcceptanceCriterion[];
}

/** Nodes clustered by real coupling: shared touchpoints and edges. */
export interface Unit {
  id: string;
  changeIds: string[];
  /** Rendered title/abstract with the stamp of the inputs they described.
   *  `of` records the member set the render described — membership moving
   *  past it is what makes the render stale and due for re-naming. */
  abstract?: { title: string; text?: string; stamp: SourceStamp[]; of?: string[] };
}

/** A signed selection of changes to build now. Signing mints the TEP. */
export interface Cut {
  id: string;
  changeIds: string[];
  /** The minted TEP identity (author-scoped, permanent): TEP-<user>-<n>. */
  tepId?: string;
  /** Set when the human signs; binds the render AND the grounded members. */
  signature?: {
    at: string;
    renderHash: string;
    groundingHash: string;
  };
}

/**
 * The per-worker instruction, assembled from the cut at dispatch — never
 * authored. Anchors resolve against the worker's actual worktree; the
 * rendered positions live only inside the brief text handed over.
 */
export interface SliceBrief {
  id: string;
  cutId: string;
  changeIds: string[];
  /** Files the worker may touch. */
  footprint: string[];
  anchors: Anchor[];
  /** Exact exports/signatures to create or change. */
  contracts: string[];
  /** Probe paths that define done for this order. */
  probes: string[];
  stamp: SourceStamp[];
}

type ProofVerdict = "green" | "red" | "pending";

/** Evidence on a delivery: probe runs, suite verdicts, CI verdicts. */
export interface Proof {
  kind: "probe" | "suite" | "ci" | "assessment";
  label: string;
  verdict: ProofVerdict;
  /** Where the machine face of this evidence lives (log, run URL). */
  ref?: string;
}

export interface Delivery {
  id: string;
  cutId: string;
  branch: string;
  proofs: Proof[];
  /** The delivery's home on the forge (pull request URL). */
  url?: string;
  /** Declared gaps from the run's workers — honest, never hidden. */
  undelivered?: string[];
  /** Set when the human accepts; acceptance merges on the project's forge. */
  acceptedAt?: string;
}

/** One project's working graph. */
/**
 * Something the machine could not settle from the code: a question with the
 * machine's recommendation. The human's accept turns it into a decision —
 * binding, recorded, and re-grounding whatever it affects.
 */
export interface Question {
  id: string;
  askId: string;
  text: string;
  recommendation?: string;
  /** The accepted wording; set only by the human's act. */
  decided?: { text: string; at: string };
}

/**
 * A human override on unit formation: pin two nodes together or apart.
 * Pins outrank the computed coupling — the human's read of the structure
 * wins, and it survives re-clustering.
 */
export interface Pin {
  kind: "together" | "apart";
  changeIds: [string, string];
}

/** A staged machine suggestion — visible, structurally inert until the
 *  human accepts or rejects. A rejected merge is a PERMANENT veto. */
export interface MergeProposal {
  id: string;
  a: string;
  b: string;
}

/** A decision's staged implication: the ask whose changes the decision
 *  implies re-deriving. Nothing changes until the human accepts. */
interface ImpactSuggestionShape {
  id: string;
  questionId: string;
  askId: string;
  /** The decision's text, for the render. */
  decision: string;
}

export interface Space {
  asks: Ask[];
  nodes: Change[];
  units: Unit[];
  cuts: Cut[];
  deliveries: Delivery[];
  questions: Question[];
  pins: Pin[];
  /** Staged machine merge suggestions awaiting the human. */
  proposals?: MergeProposal[];
  /** Permanent merge vetoes (pair keys) — a rejected pair is never re-proposed. */
  vetoes?: string[];
  /** Units the human has already ruled on, keyed by the promises they hold:
   *  merging or keeping apart settles a unit until its promises change. */
  settled?: string[];
  /** Staged decision impacts awaiting the human. */
  impacts?: ImpactSuggestionShape[];
}

export function emptySpace(): Space {
  return { asks: [], nodes: [], units: [], cuts: [], deliveries: [], questions: [], pins: [] };
}
