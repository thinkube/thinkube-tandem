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
}

/** Refuses anchors that smuggle in positions (line/column suffixes). */
export function validateAnchor(a: Anchor): string | undefined {
  if (!a.path.trim()) return "anchor has an empty path";
  if (/[:#]L?\d+\s*$/.test(a.path))
    return `anchor path carries a position ("${a.path}") — anchors are structural; lines are rendered at use`;
  return undefined;
}

export interface Grounding {
  touchpoints: Anchor[];
  stamp: SourceStamp[];
}

/** What proves a node done. `probePath` binds the executable form. */
export interface Check {
  id: string;
  text: string;
  probePath?: string;
}

/**
 * One grounded intended change: a sentence for the human, grounding
 * underneath, edges to the asks it serves and the nodes it needs, and the
 * checks that will prove it.
 */
export interface ChangeNode {
  id: string;
  /** The human-facing sentence — a render, restamped when inputs move. */
  sentence: string;
  /** Ask ids this node serves. Empty = orphan, flagged as scope creep. */
  serves: string[];
  /** Node ids this node needs built first. */
  needs: string[];
  grounding?: Grounding;
  checks: Check[];
}

/** Nodes clustered by real coupling: shared touchpoints and edges. */
export interface Unit {
  id: string;
  nodeIds: string[];
  /** Rendered title/abstract with the stamp of the inputs they described. */
  abstract?: { title: string; text?: string; stamp: SourceStamp[] };
}

/** A signed selection of nodes to build now. */
export interface Cut {
  id: string;
  nodeIds: string[];
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
export interface WorkOrder {
  id: string;
  cutId: string;
  nodeIds: string[];
  /** Files the worker may touch. */
  footprint: string[];
  anchors: Anchor[];
  /** Exact exports/signatures to create or change. */
  contracts: string[];
  /** Probe paths that define done for this order. */
  probes: string[];
  stamp: SourceStamp[];
}

export type ProofVerdict = "green" | "red" | "pending";

/** Evidence on a delivery: probe runs, suite verdicts, CI verdicts. */
export interface Proof {
  kind: "probe" | "suite" | "ci";
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
  /** Set when the human accepts; acceptance merges on the project's forge. */
  acceptedAt?: string;
}

/** One project's working graph. */
export interface Space {
  asks: Ask[];
  nodes: ChangeNode[];
  units: Unit[];
  cuts: Cut[];
  deliveries: Delivery[];
}

export function emptySpace(): Space {
  return { asks: [], nodes: [], units: [], cuts: [], deliveries: [] };
}
