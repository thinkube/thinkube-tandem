/**
 * The gate renders: decision-sized, written from the graph, never authored.
 * A render exists so the human can make exactly one decision; if it cannot
 * fit the size budget, it is carrying machine context and must be cut.
 */
import { Change, Cut, Delivery, Space } from "../core/schema";
import { asksOf } from "../core/intent";
import { docsDuty } from "../core/docsDuty";
import { verifiedDoors } from "./doors";



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
    // Which repository this promise lands in — visible before signing,
    // because a cut spanning two repositories is delivered twice, accepted
    // twice, and a person signing it should know that from the page.
    const where = [...new Set((n.grounding?.touchpoints ?? []).map((t) => t.scope ?? ""))];
    lines.push(
      `      lands at: ${lands || "(not grounded)"}` +
        (where.some(Boolean) ? ` — in ${where.map((w) => w || "this repository").join(" and ")}` : ""),
    );
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

  const unprovable = members.filter((n) => n.acceptance.length === 0 && !n.unverified?.length);
  if (unprovable.length) {
    lines.push(`Nothing proves these yet:`);
    for (const n of unprovable) lines.push(`  ⚠ ${n.sentence}`);
  }

  // What the machine cannot observe, said before you sign rather than
  // discovered on the delivery. Never silently substituted with a check
  // of something else: you accept it knowingly, or the promise is
  // re-grounded until it can be driven.
  const unverified = members.flatMap((n) => (n.unverified ?? []).map((u) => ({ n, u })));
  if (unverified.length) {
    lines.push(`The machine cannot prove these — accept them knowingly, or re-ground them:`);
    for (const { n, u } of unverified) lines.push(`  ○ ${u.text} (${n.sentence}) — ${u.why}`);
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

  // The documentation decision, stated before you sign: the doc pages this
  // work lands, or that documentation is not needed and the reason given —
  // the one rule (docsDuty) says which, so this is never worked out twice.
  const duty = docsDuty(space, cut);
  if (duty.state === "landed") {
    lines.push(`Documentation — lands:`);
    for (const p of duty.landings) lines.push(`  • ${p}`);
  } else if (duty.state === "exempt") {
    lines.push(`Documentation — not needed: ${duty.reason}`);
  } else {
    lines.push(`Documentation — missing: this cut owes documentation and carries no exemption`);
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
/** The walkthrough line for each promise: every one names a door the
 *  machine verified renders, matched by the promise's own sentence. */
export function doorsBySentence(nodes: readonly Change[]): ReadonlyMap<string, string> {
  const doors = verifiedDoors();
  const experience = new Map<string, string>();
  for (const n of nodes) {
    const door = doors.find((x) => n.sentence.toLowerCase().includes(x.action.replace(/-/g, " ")));
    if (door) experience.set(n.id, `${door.surface} — ${door.gesture}`);
  }
  return experience;
}

export function renderDeliveryPage(
  space: Space,
  delivery: Delivery,
  experience: ReadonlyMap<string, string> = new Map(),
): string {
  const cut = space.cuts.find((c) => c.id === delivery.cutId);
  const members = cut ? nodesOf(space, cut.changeIds) : [];
  const lines: string[] = [];
  lines.push(`# Delivery — \`${delivery.branch}\``);
  // Which run produced this page, and when — before any section of the
  // report, so a stale page can never be read as the newest run's. Absent
  // is not a default state: it is said plainly, because an old record
  // stays readable and still cannot pass for the newest.
  lines.push(
    delivery.runId && delivery.producedAt
      ? `Run \`${delivery.runId}\` — produced ${delivery.producedAt}`
      : "produced by a run this space did not record",
  );
  // What the machine could not settle, before anything else: the person
  // deciding this page is the only actor left for these, and a finding
  // buried under the proofs is a finding nobody weighed.
  if (delivery.findings?.length) {
    lines.push("");
    lines.push("## For you to weigh — the machine could not settle these");
    for (const f of delivery.findings) lines.push(`- ⚠ ${f}`);
  }
  if (delivery.withheld) {
    lines.push("");
    lines.push(`**Withheld — not accepted, nothing opened.** ${delivery.withheld}`);
  }
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
  /**
   * A criterion is matched to its proof by ID, not by its words.
   *
   * A runnable check's proof is labelled with the criterion's own text, so
   * matching on text worked for those. A REVIEW's proof is labelled
   * `review-3: ` plus the first sixty characters — it can never equal the
   * criterion, so every claim proved only by review read "nothing proved
   * it" while the same page listed its green review underneath. A person
   * was told four asks were unproved over a page of evidence that they
   * were kept.
   *
   * Both kinds carry `criterionId`. The text is kept only as a fallback
   * for a proof written before ids were on them.
   */
  const verdictOfCriterion = new Map<string, string>();
  for (const p of delivery.proofs) {
    if (p.criterionId) verdictOfCriterion.set(p.criterionId, p.verdict);
    verdictOfCriterion.set(`text:${p.label.trim()}`, p.verdict);
  }
  const verdictFor = (a: { id?: string; text: string }): string | undefined =>
    (a.id ? verdictOfCriterion.get(a.id) : undefined) ?? verdictOfCriterion.get(`text:${a.text.trim()}`);
  /** A promise is kept when every check on it is green. */
  const kept = (n: Change): boolean =>
    inCut.has(n.id) && n.acceptance.length > 0 && n.acceptance.every((a) => verdictFor(a) === "green");
  const failing = (n: Change): string[] =>
    n.acceptance.filter((a) => (verdictFor(a) ?? "green") !== "green").map((a) => a.text);
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
