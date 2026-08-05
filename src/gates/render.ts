/**
 * The gate renders: decision-sized, written from the graph, never authored.
 * A render exists so the human can make exactly one decision; if it cannot
 * fit the size budget, it is carrying machine context and must be cut.
 */
import { Change, Cut, Delivery, Space } from "../core/schema";
import { asksOf } from "../core/intent";

/** A render that exceeds this is not a decision — it is homework. */
export const RENDER_LINE_BUDGET = 30;

function nodesOf(space: Space, ids: readonly string[]): Change[] {
  const byId = new Map(space.nodes.map((n) => [n.id, n]));
  return ids.map((id) => byId.get(id)).filter((n): n is Change => !!n);
}

/**
 * The sign-the-cut screen: what ships, what it needs first, what is not
 * yet provable, what is not grounded. One decision: sign or not.
 */
export function renderCutScreen(space: Space, cut: Cut): string {
  const members = nodesOf(space, cut.changeIds);
  const inCut = new Set(cut.changeIds);
  const lines: string[] = [];

  lines.push(`CUT — ${members.length} change(s)`);
  for (const n of members) lines.push(`  • ${n.sentence}`);

  const needsFirst = [
    ...new Set(
      members
        .flatMap((n) => n.needs)
        .filter((id) => !inCut.has(id))
        .map((id) => space.nodes.find((n) => n.id === id)?.sentence ?? id),
    ),
  ];
  if (needsFirst.length) {
    lines.push(`Needs first (not in this cut):`);
    for (const s of needsFirst) lines.push(`  → ${s}`);
  }

  const unprovable = members.filter((n) => n.acceptance.length === 0);
  if (unprovable.length) {
    lines.push(`Nothing proves these yet:`);
    for (const n of unprovable) lines.push(`  ⚠ ${n.sentence}`);
  }

  const ungrounded = members.filter((n) => !n.grounding);
  if (ungrounded.length) {
    lines.push(`Not grounded (no place in the code yet):`);
    for (const n of ungrounded) lines.push(`  ⚠ ${n.sentence}`);
  }
  return lines.join("\n");
}

/**
 * The accept-the-delivery page: what changed in the asks' own words, proof
 * beside each line, and the gesture that lets the human experience it.
 */
export function renderDeliveryPage(
  space: Space,
  delivery: Delivery,
  experience: ReadonlyMap<string, string> = new Map(),
): string {
  const cut = space.cuts.find((c) => c.id === delivery.cutId);
  const members = cut ? nodesOf(space, cut.changeIds) : [];
  const lines: string[] = [];
  lines.push(`DELIVERY on ${delivery.branch}`);
  const askLines = new Map<string, string[]>();
  for (const n of members) {
    for (const a of asksOf(space, n)) {
      if (!askLines.has(a.id)) askLines.set(a.id, []);
      askLines.get(a.id)!.push(n.sentence);
    }
  }
  for (const [askId, sentences] of askLines) {
    const ask = space.asks.find((a) => a.id === askId)!;
    lines.push(`You asked: ${ask.text.trim()}`);
    for (const s of sentences) lines.push(`  ✓ ${s}`);
  }
  for (const p of delivery.proofs)
    lines.push(
      `  proof: ${p.label} — ${p.verdict}${p.ref ? ` (${p.ref})` : ""}`,
    );
  for (const [label, gesture] of experience)
    lines.push(`  see it: ${label} — ${gesture}`);
  return lines.join("\n");
}
