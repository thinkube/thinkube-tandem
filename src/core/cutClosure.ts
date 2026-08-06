/**
 * The cut is closed under `needs` (the v1 rule, human-restored): what a
 * change depends on ships with it. Adding pulls the dependency closure
 * in; removing drops everything that depended on the removed change —
 * the cut can never hold a dangling dependency.
 */
import { Change } from "./schema";

/** Add ids and their transitive needs. Returns what came along uninvited. */
export function addWithNeeds(
  cut: Set<string>,
  ids: readonly string[],
  nodes: readonly Change[],
): { note?: string } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const asked = new Set(ids);
  const queue = [...ids];
  let pulled = 0;
  while (queue.length) {
    const id = queue.pop()!;
    if (!byId.has(id) || cut.has(id)) continue;
    cut.add(id);
    if (!asked.has(id)) pulled++;
    for (const dep of byId.get(id)!.needs) queue.push(dep);
  }
  return pulled
    ? { note: `Also added ${pulled} change(s) this depends on — they ship together.` }
    : {};
}

/** Remove ids and everything in the cut that needs them (transitively). */
export function removeWithDependents(
  cut: Set<string>,
  ids: readonly string[],
  nodes: readonly Change[],
): { note?: string } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const removing = new Set(ids.filter((id) => cut.has(id)));
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of cut) {
      if (removing.has(id)) continue;
      if ((byId.get(id)?.needs ?? []).some((d) => removing.has(d))) {
        removing.add(id);
        grew = true;
      }
    }
  }
  const asked = new Set(ids);
  let dropped = 0;
  for (const id of removing) {
    cut.delete(id);
    if (!asked.has(id)) dropped++;
  }
  return dropped
    ? { note: `Also removed ${dropped} change(s) that needed what you removed.` }
    : {};
}

/** Sign-gate backstop: members whose needs point outside the cut. */
export function danglingNeeds(
  cutIds: readonly string[],
  nodes: readonly Change[],
): { id: string; sentence: string; missing: string[] }[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const inCut = new Set(cutIds);
  const out: { id: string; sentence: string; missing: string[] }[] = [];
  for (const id of cutIds) {
    const n = byId.get(id);
    if (!n) continue;
    const missing = n.needs.filter((d) => byId.has(d) && !inCut.has(d));
    if (missing.length)
      out.push({
        id,
        sentence: n.sentence,
        missing: missing.map((d) => byId.get(d)!.sentence),
      });
  }
  return out;
}
