/**
 * The TEP rendered for worker briefs: the asks' verbatim words, the
 * decisions in force, and the grounded changes with their acceptance
 * criteria — the north star every brief carries.
 */
import { Cut, Space } from "../core/schema";
import { docsDuty } from "../core/docsDuty";

/** The TEP rendered for briefs: the asks' words plus the grounded slices. */
export function renderTepBody(space: Space, cut: Cut): string {
  const byId = new Map(space.nodes.map((n) => [n.id, n]));
  const members = cut.changeIds.map((id) => byId.get(id)).filter((c) => !!c);
  const askIds = new Set(members.flatMap((c) => c!.serves));
  const asks = space.asks.filter((a) => askIds.has(a.id));
  const lines: string[] = [];
  lines.push(`# ${cut.tepId ?? cut.id}`);
  lines.push(`## The asks (verbatim)`);
  for (const a of asks) lines.push(`- ${a.text.trim()}`);
  const decided = space.questions.filter((q) => q.decided);
  if (decided.length) {
    lines.push(`## Decisions in force (the human settled these — build under them)`);
    for (const q of decided) lines.push(`- ${q.decided!.text}`);
  }
  lines.push(`## Your commits stay here`);
  lines.push(`You never push. Your work is committed on this branch and the person's Accept merges and pushes it. There is no remote to push to from this tree.`);
  lines.push(`## The changes`);
  for (const c of members) {
    lines.push(`- ${c!.sentence}`);
    for (const t of c!.grounding?.touchpoints ?? [])
      lines.push(`  - lands at ${t.path}${t.symbol ? ` › ${t.symbol}` : ""}${t.planned ? " (new file)" : ""}`);
    lines.push(`  ## Acceptance Criteria`);
    for (const ac of c!.acceptance) lines.push(`  - [ ] ${ac.text}`);
  }
  lines.push(`## Documentation`);
  const duty = docsDuty(space, cut);
  if (duty.state === "exempt") {
    lines.push(`- documentation is not needed for this cut — ${duty.reason}`);
  } else if (duty.state === "landed") {
    lines.push(`- this cut must land documentation at:`);
    for (const p of duty.landings) lines.push(`  - ${p}`);
  } else {
    lines.push(`- this cut owes documentation: no docs/ page is grounded and no exemption is recorded`);
  }
  return lines.join("\n");
}
