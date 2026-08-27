/**
 * A COMPONENT is everything that must ship together: the objects a sentence
 * speaks about, plus every other sentence that speaks about those objects.
 * It is a connected component of the (ask, subject) graph, joined by the
 * claims that link them.
 *
 * It exists to remove a class of edge case rather than to add a concept.
 * One sentence can describe two objects and one object can be described by
 * two sentences, so committing to less than a whole component leaves a
 * sentence half-built and an object half-changed — states nothing
 * downstream can reason about honestly. Signing a whole component means:
 *  - a sentence is open or bound, never partly either;
 *  - an object's promises are all signed or all free, so re-reading never
 *    has to preserve frozen work among fresh work;
 *  - half of what the human asked for can never be delivered as done.
 */
import { Space } from "./schema";

export interface Component {
  askIds: string[];
  subjectIds: string[];
}

/** Every component in the space, each with its sentences and its objects. */
export function components(space: Space): Component[] {
  const claims = space.claims ?? [];
  const subjects = (space.subjects ?? []).map((s) => s.id);
  // Union-find over two id spaces at once; asks and subjects are joined by
  // the claims between them, and by the asks a subject names as its source.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r)!;
    while ((parent.get(x) ?? x) !== x) {
      const up = parent.get(x)!;
      parent.set(x, r);
      x = up;
    }
    return r;
  };
  const join = (a: string, b: string): void => {
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const a of space.asks) parent.set(a.id, a.id);
  for (const s of subjects) parent.set(s, s);
  for (const c of claims) {
    if (!parent.has(c.subjectId) || !parent.has(c.fromAsk)) continue;
    join(c.fromAsk, c.subjectId);
  }
  for (const s of space.subjects ?? [])
    for (const a of s.from) if (parent.has(a)) join(a, s.id);

  const asks = new Set(space.asks.map((a) => a.id));
  const by = new Map<string, Component>();
  for (const id of parent.keys()) {
    const root = find(id);
    const c = by.get(root) ?? { askIds: [], subjectIds: [] };
    (asks.has(id) ? c.askIds : c.subjectIds).push(id);
    by.set(root, c);
  }
  return [...by.values()];
}

/** The component holding this ask or subject. */
export function componentOf(space: Space, id: string): Component | undefined {
  return components(space).find(
    (c) => c.askIds.includes(id) || c.subjectIds.includes(id),
  );
}

/** Every promise derived for a component — what a cut of it would carry. */
export function promisesOf(space: Space, c: Component): string[] {
  const claimIds = new Set(
    (space.claims ?? []).filter((x) => c.subjectIds.includes(x.subjectId)).map((x) => x.id),
  );
  const subjects = new Set(c.subjectIds);
  return space.nodes
    .filter(
      (n) =>
        (n.servesClaim && claimIds.has(n.servesClaim)) ||
        n.serves.some((sv) => subjects.has(sv)),
    )
    .map((n) => n.id);
}

/**
 * A sentence is BOUND once anything in its component has been signed: the
 * record depends on its words, so they stop being editable. Everything
 * else is OPEN — free to edit, split or delete, at the price of the
 * unsigned work that has to be read again.
 */
export function askState(space: Space, askId: string, signed: Set<string>): "open" | "bound" {
  const c = componentOf(space, askId);
  if (!c) return "open";
  return promisesOf(space, c).some((id) => signed.has(id)) ? "bound" : "open";
}
