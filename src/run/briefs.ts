/**
 * The TEP rendered for worker briefs: the asks' verbatim words, the
 * decisions in force, and the grounded changes with their acceptance
 * criteria — the north star every brief carries.
 *
 * The rendered body is handed to `buildWorkerPrompt` under ONE field, so it
 * reaches a worker exactly once. The dispatcher that does so is
 * `src/run/dispatch.ts`; there is no second copy of that call here.
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
  if (cut.docsExemption?.reason)
    lines.push(`Documentation is not needed for this cut — ${cut.docsExemption.reason}`);
  lines.push(`## The changes`);
  for (const c of members) {
    lines.push(`- ${c!.sentence}`);
    for (const t of c!.grounding?.touchpoints ?? [])
      lines.push(`  - lands at ${t.path}${t.symbol ? ` › ${t.symbol}` : ""}${t.planned ? " (new file)" : ""}`);
    lines.push(`  ## Acceptance Criteria`);
    for (const ac of c!.acceptance) lines.push(`  - [ ] ${ac.text}`);
  }
  return lines.join("\n");
}
