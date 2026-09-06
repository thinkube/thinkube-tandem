/**
 * What the work noticed and did not do.
 *
 * An actor working on a promise sees other things: a wording that is
 * wrong elsewhere, a control that behaves oddly, a file half-translated.
 * It has one question to answer about each: does this stop the ask being
 * delivered? If it does, it is part of the work and it is fixed. If it
 * does not, it is not this run's to touch — it is written down, carried
 * on the delivery, and the person decides whether it becomes an ask.
 *
 * That is the rule that keeps a repair from becoming a tidy-up: a run
 * that fixes what nobody asked for hands back a change the person has to
 * review instead of the one they wanted.
 */

const PREFIX = "FINDING:";

/** The instruction every actor carries, in one place so they agree. */
export const THE_FINDING_RULE = [
  "If you notice something that is not what you were asked to do, ask one",
  "question about it: does it stop this work being delivered?",
  "",
  "  - It does: it is part of the work. Fix it, and say what you fixed.",
  "  - It does not: leave it alone. Write it in a line beginning",
  "    `FINDING:` — one sentence, in the words a person would use, saying",
  "    what you saw and where. It rides the delivery and the person",
  "    decides whether it becomes work.",
  "",
  "Changing what nobody asked for is not thoroughness: it turns a small",
  "repair into a change the person has to review.",
].join("\n");

/** The findings an actor wrote in its report, one per line. */
export function findingsIn(text: string): string[] {
  const out: string[] = [];
  for (const line of (text ?? "").split(/\r?\n/)) {
    const stripped = line.replace(/^\s*(?:[-*+]|\d+[.)])?\s*/, "");
    if (!stripped.toUpperCase().startsWith(PREFIX)) continue;
    const said = stripped.slice(PREFIX.length).trim();
    // "FINDING: none" is a report of nothing, not a finding.
    if (said && !/^\s*(none|nothing|n\/a|-)\s*([.!,;:(—–-]|$)/i.test(said)) out.push(said);
  }
  return out;
}
