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

  lines.push(`CUT — ${members.length} promise(s). Signing approves exactly this.`);
  for (const n of members) {
    lines.push(`  • ${n.sentence}`);
    const lands = (n.grounding?.touchpoints ?? [])
      .map((t) => t.path + (t.symbol ? ` › ${t.symbol}` : "") + (t.planned ? " (new)" : ""))
      .join(", ");
    lines.push(`      lands at: ${lands || "(not grounded)"}`);
    if (n.acceptance.length === 0) lines.push(`      checked by: (no check yet)`);
    for (const c of n.acceptance)
      lines.push(
        `      checked by: ${c.text}${c.kind === "assessment" ? " — graded by an independent reviewer" : " — runnable test"}`,
      );
  }

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

  const openQuestions = space.questions.filter(
    (q) => !q.decided && members.some((m) => m.serves.includes(q.askId)),
  );
  if (openQuestions.length) {
    lines.push(`Unresolved questions on these asks (decide before signing):`);
    for (const q of openQuestions) lines.push(`  ? ${q.text}`);
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
  // The page is written in objects and what is now true of them, because
  // that is what a person can go and try. A promise is a step and cannot
  // be experienced on its own; a claim can. Where a claim is only partly
  // built the page says so rather than counting it as done.
  const built = new Set(members.map((n) => n.id));
  const subjects = space.subjects ?? [];
  const claims = space.claims ?? [];
  for (const subject of subjects) {
    const mine = claims.filter((c) => c.subjectId === subject.id);
    const touched = mine.filter((c) =>
      space.nodes.some((n) => n.servesClaim === c.id && built.has(n.id)),
    );
    if (!touched.length) continue;
    const whole = touched.filter((c) =>
      space.nodes.every((n) => n.servesClaim !== c.id || built.has(n.id)),
    );
    lines.push(`${subject.name} — ${whole.length} of ${mine.length} now true`);
    for (const c of touched) {
      const all = space.nodes.filter((n) => n.servesClaim === c.id);
      const here = all.filter((n) => built.has(n.id));
      const done = here.length === all.length;
      lines.push(
        done
          ? `  ✓ ${c.text}`
          : `  · ${c.text} — not yet (${here.length} of ${all.length} parts built)`,
      );
      // See it for yourself, beside the claim it proves: every line names
      // a door the machine verified renders. A promise whose door is
      // missing gets no line — it is undelivered rather than pointing at
      // a way in that is not there.
      for (const n of here) {
        const seen = experience.get(n.id);
        if (seen) lines.push(`      see it: ${seen}`);
      }
    }
  }
  // Work that belongs to no object is still reported — under the sentence
  // it came from, which is the only thing that can name it.
  const loose = members.filter((n) => !n.servesClaim);
  const byAsk = new Map<string, Change[]>();
  for (const n of loose)
    for (const a of asksOf(space, n)) byAsk.set(a.id, [...(byAsk.get(a.id) ?? []), n]);
  for (const [askId, ns] of byAsk) {
    lines.push(`You asked: ${space.asks.find((a) => a.id === askId)!.text.trim()}`);
    for (const n of ns) {
      lines.push(`  ✓ ${n.sentence}`);
      const seen = experience.get(n.id);
      if (seen) lines.push(`      see it: ${seen}`);
    }
  }
  for (const p of delivery.proofs)
    lines.push(
      `  check: ${p.label} — ${p.verdict}${p.ref ? ` (${p.ref})` : ""}`,
    );
  // What did NOT arrive is part of the decision, on the page's face —
  // including any unmet documentation obligation.
  for (const u of delivery.undelivered ?? [])
    lines.push(`  ⚠ undelivered: ${u}`);
  for (const [label, gesture] of experience)
    lines.push(`  see it: ${label} — ${gesture}`);
  return lines.join("\n");
}
