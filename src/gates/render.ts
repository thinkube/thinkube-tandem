/**
 * The gate renders: decision-sized, written from the graph, never authored.
 * A render exists so the human can make exactly one decision; if it cannot
 * fit the size budget, it is carrying machine context and must be cut.
 */
import { Change, Cut, Delivery, Space } from "../core/schema";
import { asksOf } from "../core/intent";

/** A render that exceeds this is not a decision — it is homework. Blank
 *  lines separate the sections of a rendered page and say nothing, so
 *  what counts is the lines that carry something. */
export const RENDER_LINE_BUDGET = 30;

/** What a render costs against the budget. */
export const renderWeight = (page: string): number =>
  page.split("\n").filter((l) => l.trim()).length;

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
 *
 * Written as MARKDOWN, because this is the one page read to make a
 * decision and it has to be read at speed: headed sections tell the eye
 * where the answer to each question lives — what is true now, what you
 * asked for, what was checked, what did not arrive — where a flat block
 * of indented text makes every question cost a search. Sections do not
 * license length: the budget above still holds, in lines that say
 * something.
 */
export function renderDeliveryPage(
  space: Space,
  delivery: Delivery,
  experience: ReadonlyMap<string, string> = new Map(),
): string {
  const cut = space.cuts.find((c) => c.id === delivery.cutId);
  const members = cut ? nodesOf(space, cut.changeIds) : [];
  const lines: string[] = [];
  lines.push(`# Delivery — \`${delivery.branch}\``);
  // The page is written in subjects and what is now true of them, because
  // that is what a person can go and try. A promise is a step and cannot
  // be experienced on its own; a claim can.
  //
  // TRUE MEANS PROVED. Being in the cut says only that the work was asked
  // for; a claim is true when every promise serving it was built AND every
  // check on those promises came back green. This page once counted a
  // claim as true because its promises were in the cut, and said "1 of 1
  // now true" over a hundred red checks and a run that never dispatched.
  const inCut = new Set(members.map((n) => n.id));
  const green = new Set(
    delivery.proofs.filter((p) => p.verdict === "green").map((p) => p.label.trim()),
  );
  const red = new Map(
    delivery.proofs
      .filter((p) => p.verdict !== "green")
      .map((p) => [p.label.trim(), p.verdict] as const),
  );
  /** A promise is kept when every check on it is green. */
  const kept = (n: Change): boolean =>
    inCut.has(n.id) && n.acceptance.length > 0 && n.acceptance.every((a) => green.has(a.text.trim()));
  const failing = (n: Change): string[] =>
    n.acceptance.filter((a) => red.has(a.text.trim())).map((a) => a.text);
  const built = inCut;
  const subjects = space.subjects ?? [];
  const claims = space.claims ?? [];
  const truth: string[] = [];
  for (const subject of subjects) {
    const mine = claims.filter((c) => c.subjectId === subject.id);
    const touched = mine.filter((c) =>
      space.nodes.some((n) => n.servesClaim === c.id && built.has(n.id)),
    );
    if (!touched.length) continue;
    const proved = (c: { id: string }): boolean => {
      const all = space.nodes.filter((n) => n.servesClaim === c.id);
      return all.length > 0 && all.every(kept);
    };
    const whole = touched.filter(proved);
    truth.push("");
    truth.push(`### ${subject.name} — ${whole.length} of ${mine.length} now true`);
    truth.push("");
    for (const c of touched) {
      const all = space.nodes.filter((n) => n.servesClaim === c.id);
      const here = all.filter((n) => built.has(n.id));
      const reds = [...new Set(all.flatMap(failing))];
      truth.push(
        proved(c)
          ? `- ✓ ${c.text}`
          : `- ✗ ${c.text} — **NOT true yet**` +
            (here.length < all.length ? ` (${here.length} of ${all.length} parts in this delivery)` : "") +
            (reds.length ? `; ${reds.length} check(s) red` : "; nothing proved it"),
      );
      for (const r of reds.slice(0, 3)) truth.push(`    - red: ${r}`);
      // See it for yourself, beside the claim it proves: every line names
      // a door the machine verified renders. A promise whose door is
      // missing gets no line — it is undelivered rather than pointing at
      // a way in that is not there.
      for (const n of here) {
        const seen = experience.get(n.id);
        if (seen) truth.push(`    - see it: ${seen}`);
      }
    }
  }
  if (truth.length) {
    lines.push("");
    lines.push("## What is now true");
    lines.push(...truth);
  }
  // Work that belongs to no object is still reported — under the sentence
  // it came from, which is the only thing that can name it.
  const loose = members.filter((n) => !n.servesClaim);
  const byAsk = new Map<string, Change[]>();
  for (const n of loose)
    for (const a of asksOf(space, n)) byAsk.set(a.id, [...(byAsk.get(a.id) ?? []), n]);
  if (byAsk.size) {
    lines.push("");
    lines.push("## Work that belongs to no object");
  }
  for (const [askId, ns] of byAsk) {
    lines.push("");
    lines.push(`You asked: ${space.asks.find((a) => a.id === askId)!.text.trim()}`);
    lines.push("");
    for (const n of ns) {
      lines.push(`- ${kept(n) ? "✓" : "✗"} ${n.sentence}`);
      const seen = experience.get(n.id);
      if (seen) lines.push(`    - see it: ${seen}`);
    }
  }
  if (delivery.proofs.length) {
    lines.push("");
    lines.push("## Checks");
    lines.push("");
    for (const p of delivery.proofs)
      lines.push(
        `- ${p.verdict === "green" ? "✓" : "✗"} ${p.label} — ${p.verdict}${p.ref ? ` (${p.ref})` : ""}`,
      );
  }
  // Effects the machine could not verify are said, with the reason — never
  // graded by a reviewer that cannot judge them, never assigned to a person.
  const unverified = members.flatMap((n) => (n.unverified ?? []).map((u) => ({ promise: n.sentence, ...u })));
  if (unverified.length) {
    lines.push("");
    lines.push("## Not verified by the machine");
    lines.push("");
    for (const u of unverified) lines.push(`- ○ ${u.text} — ${u.why} (promise: ${u.promise.slice(0, 80)})`);
  }
  // An exam amended mid-run is part of the decision: every challenge the
  // oracle ruled on, granted or denied, on the page's face — the human
  // accepts knowing the checks changed, which one, and why.
  if ((delivery.rulings ?? []).length) {
    lines.push("");
    lines.push("## Rulings — checks challenged during the run");
    lines.push("");
    for (const r of delivery.rulings ?? []) {
      const check = space.nodes
        .flatMap((n) => n.acceptance)
        .find((a) => a.id === r.criterionId);
      lines.push(
        `- ${r.granted ? "⚖ re-authored" : "· upheld"} (${r.unit}) "${check?.text ?? r.criterionId}" — ${r.reason}`,
      );
    }
  }
  // What the tester settled where the contract was silent — the coder built
  // to these; the reader sees them, nobody was asked.
  if ((delivery.decisions ?? []).length) {
    lines.push("");
    lines.push("## Decisions — what the tester settled where the contract was silent");
    lines.push("");
    for (const d of delivery.decisions ?? []) lines.push(`- (${d.unit}) ${d.text}`);
  }
  // What did NOT arrive is part of the decision, on the page's face —
  // including any unmet documentation obligation.
  if ((delivery.undelivered ?? []).length) {
    lines.push("");
    lines.push("## Not delivered");
    lines.push("");
    for (const u of delivery.undelivered ?? []) lines.push(`- ⚠ ${u}`);
  }
  // The walkthrough already appears beside the claim each line belongs to.
  // Repeating it here keyed by promise id printed the machine's own
  // identifiers at the foot of the page and said nothing new.
  return lines.join("\n");
}
