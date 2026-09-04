/**
 * The question the run hands over when it has spent what it can do.
 *
 * Written once, here, so the person opening a Claude session never has to
 * retype what the platform said, find the commit, or explain what was
 * already tried. Everything in it is a fact this run holds: the repository,
 * the address, the promises it was building, the platform's own words, and
 * how many times the run repaired and pushed before stopping.
 */
import type { Delivery, Space } from "../core/schema";

export function helpPrompt(a: {
  repoRoot: string;
  delivery: Delivery;
  space: Space;
  tep?: string;
}): string {
  const d = a.delivery;
  const cut = a.space.cuts.find((c) => c.id === d.cutId);
  const promises = a.space.nodes
    .filter((n) => (cut?.changeIds ?? []).includes(n.id))
    .map((n) => `- ${n.sentence}`)
    .slice(0, 12);
  const tried = d.afterMerge?.tried ?? 0;
  return [
    `The platform will not build what was merged into ${a.repoRoot}, and Tandem has stopped trying.`,
    "",
    `What was being built${a.tep ? ` (${a.tep})` : ""}:`,
    ...(promises.length ? promises : ["- (the delivery names no promises)"]),
    "",
    ...(d.liveAt ? [`Where it is meant to be seen: ${d.liveAt}`, ""] : []),
    `The work is already in the project: it was merged and pushed${d.mergedAt ? ` at ${d.mergedAt}` : ""}.`,
    tried
      ? `Tandem repaired and pushed again ${tried} time(s), and the platform still refuses it.`
      : "Tandem did not attempt a repair.",
    "",
    "What the platform said:",
    d.afterMerge?.detail ?? "(the platform gave no words)",
    "",
    "Please find out why it does not build and fix it. Two things worth knowing:",
    "the tests run in the platform's pipeline, in a named image, so a green test",
    "run here is not proof; and the work can be taken back out instead of fixed —",
    "reverting the merge is a legitimate answer if the fix is not small.",
  ].join("\n");
}
