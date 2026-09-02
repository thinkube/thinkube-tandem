/**
 * The gate renders: decision-sized, written from the graph, never authored.
 * A render exists so the human can make exactly one decision; if it cannot
 * fit the size budget, it is carrying machine context and must be cut.
 */
import { Change, Cut, Delivery, Space } from "../core/schema";
import { sayShape } from "./moduleSizes";
import { asksOf } from "../core/intent";
import { docsDuty } from "../core/docsDuty";
import { declaredDoors, verifiedDoors } from "./doors";
import { observationShaped } from "../run/observations";



function nodesOf(space: Space, ids: readonly string[]): Change[] {
  const byId = new Map(space.nodes.map((n) => [n.id, n]));
  return ids.map((id) => byId.get(id)).filter((n): n is Change => !!n);
}

/**
 * Every acceptance criterion of the cut, each with its verdict — never
 * silently dropped when nothing judged it.
 *
 * A criterion that no proof mentions is "not checked" rather than absent
 * from the page: the delivery page once listed only what proofs happened
 * to answer, so a criterion the run never graded read as if it had been
 * kept. An observation-shaped criterion — one only the running product can
 * show — is never "not checked" and never "red": it is "for you to
 * certify", the same reading a reviewer's OBSERVE ruling gets when the
 * criterion's own words head an entry on `delivery.observations`.
 */
export function criterionVerdicts(
  space: Space,
  delivery: Delivery,
): {
  promiseId: string;
  promise: string;
  id: string;
  text: string;
  kind: "probe" | "assessment";
  verdict: "green" | "red" | "not checked" | "for you to certify";
  ref?: string;
}[] {
  const cut = space.cuts.find((c) => c.id === delivery.cutId);
  const members = cut ? nodesOf(space, cut.changeIds) : [];
  const verdictOfCriterion = new Map<string, { verdict: string; ref?: string }>();
  for (const p of delivery.proofs) {
    if (p.criterionId) verdictOfCriterion.set(p.criterionId, { verdict: p.verdict, ref: p.ref });
    verdictOfCriterion.set(`text:${p.label.trim()}`, { verdict: p.verdict, ref: p.ref });
  }
  const observations = delivery.observations ?? [];
  const headsObservation = (text: string): boolean =>
    observations.some((o) => o.startsWith(`${text.trim()} — `));
  const out: {
    promiseId: string;
    promise: string;
    id: string;
    text: string;
    kind: "probe" | "assessment";
    verdict: "green" | "red" | "not checked" | "for you to certify";
    ref?: string;
  }[] = [];
  for (const n of members) {
    for (const c of n.acceptance) {
      const kind: "probe" | "assessment" = c.kind === "assessment" ? "assessment" : "probe";
      if (observationShaped(c.text) || headsObservation(c.text)) {
        out.push({ promiseId: n.id, promise: n.sentence, id: c.id, text: c.text, kind, verdict: "for you to certify" });
        continue;
      }
      const proof = verdictOfCriterion.get(c.id) ?? verdictOfCriterion.get(`text:${c.text.trim()}`);
      const verdict: "green" | "red" | "not checked" =
        !proof ? "not checked" : proof.verdict === "green" ? "green" : "red";
      out.push({
        promiseId: n.id,
        promise: n.sentence,
        id: c.id,
        text: c.text,
        kind,
        verdict,
        ...(proof?.ref ? { ref: proof.ref } : {}),
      });
    }
  }
  return out;
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
        `      checked by: ${c.text}${
          // The person signs knowing WHERE each promise is settled — a
          // criterion answered after the merge must never read as a test
          // the run will execute.
          c.settledBy
            ? ` — settled after the merge by ${c.settledBy}`
            : c.kind === "assessment"
              ? " — graded by an independent reviewer"
              : " — runnable test"
        }`,
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
 *  machine verified renders — its page and its gesture — matched by the
 *  promise's own sentence, against the surface this build actually shipped.
 *  A promise whose door's handle (or page's handle) is absent from
 *  `surfaceText` gets no entry — it is named as undelivered instead of
 *  pointing at a way in that is not there. */
export function doorsBySentence(nodes: readonly Change[], surfaceText: string): ReadonlyMap<string, string> {
  const doors = verifiedDoors(surfaceText);
  const experience = new Map<string, string>();
  for (const n of nodes) {
    const door = doors.find((x) => n.sentence.toLowerCase().includes(x.action.replace(/-/g, " ")));
    if (door) experience.set(n.id, `${door.label} — ${door.gesture}`);
  }
  return experience;
}

/**
 * Promises whose sentence names a declared door's gesture, but whose door
 * the machine could not prove renders in the given surface text — named as
 * undelivered instead of quietly losing their "see it" line. A promise
 * whose sentence names no door at all is not about a door and is never
 * named here; only one that matched an action and then failed proof is.
 */
export function unprovenDoorPromises(nodes: readonly Change[], surfaceText: string): string[] {
  const all = declaredDoors();
  const proved = doorsBySentence(nodes, surfaceText);
  const out: string[] = [];
  for (const n of nodes) {
    if (proved.has(n.id)) continue;
    const matched = all.find((x) => n.sentence.toLowerCase().includes(x.action.replace(/-/g, " ")));
    if (matched) out.push(`${n.sentence} — the way in could not be proved`);
  }
  return out;
}

/** A kept promise, one that is not, and one nobody settled either way. */
const MARK: Record<string, string> = { green: "✓", red: "✗" };

/**
 * What a proof says to someone who was not here.
 *
 * A proof's `ref` is the MACHINE's face of the evidence — the command, its
 * exit code, the tail of its output — and that is what a record should
 * hold. Printed on this page it hands a reader a shell line with a `sed`
 * expression inside it and calls that the explanation.
 *
 * So: a kept promise needs no face at all, because the criterion and its
 * mark already say it. One that failed needs the sentence the check itself
 * wrote when it failed, which the tail already carries. One nobody could
 * judge says that, in those words. The command, the exit code and the tail
 * stay in the run record and the log, where a developer goes looking.
 */
export function saidPlainly(p: Delivery["proofs"][number]): string {
  if (p.verdict === "green") return "";
  if (p.verdict === "pending")
    return p.settledBy ? `settled after the merge, by ${p.settledBy}` : "settled after the merge";
  if (p.verdict === "unjudged") return "the machine could not run this check, so nothing was judged here";
  const said = (p.ref ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // What the check said when it failed, before what the machine typed.
  const failed = said.find((l) => /^not ok\b/.test(l) || /^(AssertionError|Error)\b/.test(l));
  if (failed) return failed.replace(/^not ok\s+\d+\s+-\s+/, "");
  // A reviewer answers in prose, which reads as it is; a command does not.
  if (!/^\$ /.test(said[0] ?? "")) return said[0] ?? "";
  // A command and nothing to quote from it. Saying nothing at all leaves a
  // failure with no reason beside it, so say the one thing that is known
  // and point at where the command and its output are kept.
  if (said.some((l) => /the run was halted|stopped/i.test(l)))
    return "the check did not finish — the run was stopped before it answered";
  return "the check did not pass; the command it ran and its output are in the run record";
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
  // Every acceptance criterion of the cut, with its verdict — a criterion
  // no proof mentions is named "not checked" rather than left off the page.
  // Proofs that answer no criterion (the repository suite, a red push) are
  // not about any one promise and are listed beside the criteria, not
  // folded into them.
  const criteria = criterionVerdicts(space, delivery);
  const criterionProofIds = new Set(
    delivery.proofs.filter((p) => p.criterionId).map((p) => p.criterionId),
  );
  const criterionProofLabels = new Set(
    delivery.proofs.filter((p) => p.criterionId).map((p) => `text:${p.label.trim()}`),
  );
  const looseProofs = delivery.proofs.filter(
    (p) =>
      !(p.criterionId && criterionProofIds.has(p.criterionId)) &&
      !criterionProofLabels.has(`text:${p.label.trim()}`),
  );
  if (criteria.length || looseProofs.length) {
    lines.push("");
    lines.push("## Checks");
    lines.push("");
    for (const c of criteria)
      lines.push(
        `- ${c.verdict === "green" ? "✓" : c.verdict === "not checked" ? "○" : c.verdict === "for you to certify" ? "◐" : "✗"} ${c.text} — ${c.verdict}${c.ref ? ` (${c.ref})` : ""}`,
      );
    for (const p of looseProofs) {
      const said = saidPlainly(p);
      lines.push(`- ${MARK[p.verdict] ?? "○"} ${p.label}${said ? ` — ${said}` : ""}`);
    }
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
  // Last, because it is context rather than a verdict: how big this tree's
  // modules are. Nothing here withholds anything or asks for anything.
  if (delivery.moduleSizes) lines.push(...sayShape(delivery.moduleSizes));
  // The walkthrough already appears beside the claim each line belongs to.
  // Repeating it here keyed by promise id printed the machine's own
  // identifiers at the foot of the page and said nothing new.
  return lines.join("\n");
}

/**
 * The pull-request body: the same account of the delivery the accept page
 * gives, in the words a forge shows beside the diff. What only the person
 * can certify, every undelivered line, and every acceptance criterion with
 * its verdict — the forge face and the accept page never say different
 * things about a criterion, because both are read from this delivery.
 */
export function renderDeliveryBody(space: Space, delivery: Delivery): string {
  const lines: string[] = [];
  lines.push(
    `Delivered by run ${delivery.runId ?? "(unrecorded)"} for ${delivery.cutId}` +
      (delivery.producedAt ? `, produced at ${delivery.producedAt}.` : "."),
  );
  const observations = delivery.observations ?? [];
  if (observations.length) {
    lines.push("");
    lines.push("## For you to certify — the machine cannot observe the running product");
    lines.push("");
    for (const o of observations) lines.push(`- ${o}`);
  }
  const undelivered = delivery.undelivered ?? [];
  if (undelivered.length) {
    lines.push("");
    lines.push("## Not delivered");
    lines.push("");
    for (const u of undelivered) lines.push(`- ⚠ ${u}`);
  }
  const criteria = criterionVerdicts(space, delivery);
  if (criteria.length) {
    lines.push("");
    lines.push("## Checks");
    lines.push("");
    for (const c of criteria)
      lines.push(
        `- ${c.verdict === "green" ? "✓" : c.verdict === "not checked" ? "○" : c.verdict === "for you to certify" ? "◐" : "✗"} ${c.text} — ${c.verdict}${c.ref ? ` (${c.ref})` : ""}`,
      );
  }
  return lines.join("\n");
}
