/**
 * A person says a delivered promise does not hold.
 *
 * The mirror of attesting. Attesting answers a criterion the machine
 * could not settle; this answers one it settled wrongly — and it is the
 * only source of that answer in half of this platform's targets, where no
 * machine speaks after the merge at all.
 *
 * Refused without words: a repair is told what to fix, and "it does not
 * work" alone tells it nothing. Refused on work never delivered: there is
 * nothing to contradict, and the promise is already waiting to be built.
 */
import type { Contradiction } from "../core/schema";
import type { TandemSession } from "./session";

export function contradictOn(
  s: TandemSession,
  target: { promiseId?: string; criterionId?: string },
  said: string,
): { ok: boolean; reason?: string } {
  const words = said.trim();
  if (!words)
    return { ok: false, reason: "say what you saw — a repair is told what to fix, and nothing else can tell it" };
  const node = target.criterionId
    ? s.space.nodes.find((n) => n.acceptance.some((a) => a.id === target.criterionId))
    : s.space.nodes.find((n) => n.id === target.promiseId);
  if (!node) return { ok: false, reason: "no promise of this space carries that" };
  const criteria = target.criterionId
    ? node.acceptance.filter((a) => a.id === target.criterionId)
    : node.acceptance;
  if (!criteria.length) return { ok: false, reason: `"${node.sentence.slice(0, 60)}" has nothing to prove yet` };
  // Only what was delivered can be contradicted: a promise nobody built
  // is already work, and saying it does not hold would say nothing new.
  const proved = new Set(
    s.space.deliveries.flatMap((d) => d.proofs.filter((p) => p.criterionId).map((p) => p.criterionId!)),
  );
  const mine = criteria.filter((a) => proved.has(a.id));
  if (!mine.length)
    return {
      ok: false,
      reason: `nothing has been delivered for "${node.sentence.slice(0, 60)}" yet — it is already waiting to be built`,
    };
  const at = s.deps.now();
  const made: Contradiction[] = mine.map((a) => ({
    criterionId: a.id,
    at,
    by: s.author,
    source: "person",
    said: words,
  }));
  s.space = { ...s.space, contradictions: [...(s.space.contradictions ?? []), ...made] };
  s.changed(
    `"${node.sentence.slice(0, 60)}" no longer holds — ${made.length === 1 ? "one criterion" : `${made.length} criteria`} to make true again.`,
  );
  return { ok: true };
}
