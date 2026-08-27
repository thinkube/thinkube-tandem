/**
 * Repair of a record whose claim ids were minted twice. Two different
 * claims sharing one id is corrupt data, and the damage is silent: a
 * promise then hangs under whichever claim the lookup meets first, which
 * can belong to another subject entirely.
 *
 * The repair does not guess. A promise carries the subject it was derived
 * for, so the claim it meant is the one with that id UNDER THAT SUBJECT.
 * Where that cannot be decided, the link is dropped and the promise is
 * named as unattached rather than left pointing somewhere plausible.
 */
import { Space } from "./schema";

/** Next free number for ids shaped `<kind>-<author>-<n>`. */
function nextFree(ids: string[]): number {
  let max = 0;
  for (const id of ids) {
    const n = Number(id.slice(id.lastIndexOf("-") + 1));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/** The space with every claim id unique and every promise still on the
 *  claim it was derived for. Unchanged records are returned as they are. */
export function repairClaimIds(space: Space): Space {
  const claims = space.claims ?? [];
  const duplicated = new Set(
    claims.map((c) => c.id).filter((id, i, all) => all.indexOf(id) !== i),
  );
  if (!duplicated.size) return space;

  let counter = nextFree(claims.map((c) => c.id));
  const used = new Set<string>();
  // (old id, subject) → the id that claim now carries.
  const moved = new Map<string, string>();
  const repaired = claims.map((c) => {
    if (!used.has(c.id)) {
      used.add(c.id);
      moved.set(`${c.id}|${c.subjectId}`, c.id);
      return c;
    }
    const prefix = c.id.slice(0, c.id.lastIndexOf("-") + 1);
    const fresh = `${prefix}${counter++}`;
    moved.set(`${c.id}|${c.subjectId}`, fresh);
    return { ...c, id: fresh };
  });

  const subjects = new Set((space.subjects ?? []).map((s) => s.id));
  const nodes = space.nodes.map((n) => {
    if (!n.servesClaim || !duplicated.has(n.servesClaim)) return n;
    const subject = n.serves.find((x) => subjects.has(x));
    const fixed = subject ? moved.get(`${n.servesClaim}|${subject}`) : undefined;
    if (fixed) return { ...n, servesClaim: fixed };
    const { servesClaim: _dropped, ...rest } = n;
    return rest;
  });

  return { ...space, claims: repaired, nodes };
}
