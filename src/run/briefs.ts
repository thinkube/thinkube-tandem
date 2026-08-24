/**
 * The TEP rendered for worker briefs: the asks' verbatim words, the
 * decisions in force, and the grounded changes with their acceptance
 * criteria — the north star every brief carries.
 */
import { Cut, Space } from "../core/schema";

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
  lines.push(`## The changes`);
  for (const c of members) {
    lines.push(`- ${c!.sentence}`);
    for (const t of c!.grounding?.touchpoints ?? [])
      lines.push(`  - lands at ${t.path}${t.symbol ? ` › ${t.symbol}` : ""}${t.planned ? " (new file)" : ""}`);
    lines.push(`  ## Acceptance Criteria`);
    for (const ac of c!.acceptance) lines.push(`  - [ ] ${ac.text}`);
  }
  lines.push(`## Documentation`);
  const docsPaths = members
    .flatMap((c) => c!.grounding?.touchpoints ?? [])
    .map((t) => t.path)
    .filter((p) => p.startsWith("docs/"));
  if (cut.docsWaiver) {
    lines.push(`- Not needed: ${cut.docsWaiver.reason}`);
  } else if (docsPaths.length) {
    lines.push(`This cut must land:`);
    for (const p of docsPaths) lines.push(`- ${p}`);
  } else {
    lines.push(`- No documentation path is grounded and no waiver is recorded.`);
  }
  return lines.join("\n");
}
