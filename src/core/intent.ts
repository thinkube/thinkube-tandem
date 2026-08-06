/**
 * The intent contract: the human's asks are the root of the graph.
 *  - Asks are stored verbatim and are append-only; no function in this
 *    codebase edits an ask's text.
 *  - Every node traces up to an ask through `serves`; a node that doesn't
 *    is an orphan and is surfaced, never silently kept.
 */
import { Ask, Change, Space } from "./schema";

export type Rejection = { ok: false; reason: string };
export type Applied<T> = { ok: true; space: Space; added: T };

/** Capture an ask. The text is stored byte for byte; empty is refused. */
export function addAsk(
  space: Space,
  text: string,
  at: string,
  id?: string,
): Applied<Ask> | Rejection {
  if (!text.trim()) return { ok: false, reason: "an ask cannot be empty" };
  const ask: Ask = { id: id ?? `ask-${space.asks.length + 1}`, text, at };
  return { ok: true, space: { ...space, asks: [...space.asks, ask] }, added: ask };
}

/**
 * Add a node. Its `serves` must name existing asks and its `needs` existing
 * nodes — dangling edges are refused at the door, not discovered later.
 */
export function addNode(
  space: Space,
  node: Omit<Change, "id">,
): Applied<Change> | Rejection {
  const askIds = new Set(space.asks.map((a) => a.id));
  for (const s of node.serves)
    if (!askIds.has(s)) return { ok: false, reason: `serves unknown ask '${s}'` };
  const changeIds = new Set(space.nodes.map((n) => n.id));
  for (const d of node.needs)
    if (!changeIds.has(d)) return { ok: false, reason: `needs unknown node '${d}'` };
  const added: Change = { ...node, id: `node-${space.nodes.length + 1}` };
  return {
    ok: true,
    space: { ...space, nodes: [...space.nodes, added] },
    added,
  };
}

/** Nodes with no path up to any ask — scope creep, surfaced by the UI. */
export function orphanChanges(space: Space): Change[] {
  return space.nodes.filter((n) => n.serves.length === 0);
}

/** The asks a node serves, resolved — for renders written in the asks' words. */
export function asksOf(space: Space, node: Change): Ask[] {
  const byId = new Map(space.asks.map((a) => [a.id, a]));
  return node.serves
    .map((id) => byId.get(id))
    .filter((a): a is Ask => !!a);
}
