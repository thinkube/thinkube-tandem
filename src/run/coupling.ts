/**
 * Which files a change in one file can break, read from the code map.
 *
 * A unit is graded on the committed base plus ITS OWN files: another
 * coder's half-written work can neither pass it nor fail it. That rule is
 * what keeps parallel workers from grading each other's rubble, and it
 * carries one consequence the plan has to respect.
 *
 * If a unit changes the shape of something a file in ANOTHER unit's hands
 * uses, the two can never see each other. The first unit's runner holds
 * the new shape and the old caller; the second unit's runner holds the old
 * shape and the new caller. Neither state compiles, neither worker can
 * reach the file that would fix it, and neither can learn why — the tree
 * they both read shows the change that their runners do not.
 *
 * The map already knows who uses whom. Reading it costs one file and
 * turns an hour of rounds against an impossible state into one sentence
 * before anybody starts.
 */
import * as fs from "node:fs";

interface GraphNode {
  id?: string;
  source_file?: string;
}
interface GraphLink {
  relation?: string;
  source?: string;
  target?: string;
  source_file?: string;
}

/** The relations that mean "this file would not compile if that one changed shape". */
const USES = new Set(["imports", "imports_from", "re_exports"]);

/**
 * File → the files it uses, from the map. An absent or unreadable map
 * yields nothing, and every rule built on this simply does not fire: an
 * unavailable reading is never a refusal.
 */
export function usesByFile(graphPath: string): Map<string, Set<string>> {
  let parsed: { nodes?: GraphNode[]; links?: GraphLink[] };
  try {
    parsed = JSON.parse(fs.readFileSync(graphPath, "utf8")) as { nodes?: GraphNode[]; links?: GraphLink[] };
  } catch {
    return new Map();
  }
  const fileOf = new Map((parsed.nodes ?? []).map((n) => [n.id ?? "", n.source_file ?? ""]));
  const out = new Map<string, Set<string>>();
  for (const l of parsed.links ?? []) {
    if (!USES.has(l.relation ?? "")) continue;
    const from = l.source_file ?? fileOf.get(l.source ?? "") ?? "";
    const to = fileOf.get(l.target ?? "") ?? "";
    if (!from || !to || from === to) continue;
    const set = out.get(from) ?? new Set<string>();
    set.add(to);
    out.set(from, set);
  }
  return out;
}

/**
 * Whether one set of files uses another — asymmetric, because which side
 * uses which is exactly what says who has to go first.
 *
 * Returns the pair, for the edge and for the sentence a person reads.
 */
function usesAcross(
  user: readonly string[],
  used: readonly string[],
  uses: Map<string, Set<string>>,
): { user: string; used: string } | undefined {
  const theirs = new Set(used);
  for (const f of user) for (const u of uses.get(f) ?? []) if (theirs.has(u)) return { user: f, used: u };
  return undefined;
}

/** A slice, as far as ordering is concerned. */
interface Orderable {
  handle: string;
  workUnits?: { role?: string; footprint: string[]; consumes?: string[] }[];
}

/** What a slice's code units may write — production only, since a test
 *  home is the tester's and is never what another slice calls. */
function productionOf(s: Orderable): string[] {
  return (s.workUnits ?? []).filter((u) => (u.role ?? "code") !== "test").flatMap((u) => u.footprint);
}

/**
 * Put the coupled slices of a plan in order, from what the code map says
 * rather than from what the reading happened to mention.
 *
 * Cross-slice order is derived today from `needs` — the model's own
 * sentence that one promise needs another. When the model says it, the
 * plan is ordered and everything works. When it does not, two slices that
 * change what the other calls run side by side, and neither can ever be
 * proven: each is graded on what is committed plus its own files, so one
 * runner holds the new shape with the old caller and the other the old
 * caller with the new shape.
 *
 * The map knows who uses whom, and that fact settles the order without
 * asking anybody: the slice that OWNS the used file goes first, and its
 * caller follows. The edge is written in the language the engine already
 * reads — the caller consumes the file it calls — so nothing downstream
 * learns a new word.
 *
 * Returns the edges it added, for the log, and the pairs that cannot be
 * ordered at all: each using the other is a genuine knot, and no order
 * exists to be found.
 */
export function orderCoupledSlices(
  slices: readonly Orderable[],
  uses: Map<string, Set<string>>,
): { added: { after: string; before: string; user: string; used: string }[]; knots: { a: string; b: string; one: string; other: string }[] } {
  const added: { after: string; before: string; user: string; used: string }[] = [];
  const knots: { a: string; b: string; one: string; other: string }[] = [];
  if (!uses.size) return { added, knots };
  const production = new Map(slices.map((s) => [s.handle, productionOf(s)]));
  for (let i = 0; i < slices.length; i++)
    for (let j = i + 1; j < slices.length; j++) {
      const a = slices[i];
      const b = slices[j];
      const mine = production.get(a.handle) ?? [];
      const theirs = production.get(b.handle) ?? [];
      const bUsesA = usesAcross(theirs, mine, uses);
      const aUsesB = usesAcross(mine, theirs, uses);
      // Each calling into the other cannot be ordered: whichever goes
      // first is proven against the other's old shape.
      if (bUsesA && aUsesB) {
        knots.push({ a: a.handle, b: b.handle, one: bUsesA.user, other: aUsesB.user });
        continue;
      }
      const join = bUsesA ?? aUsesB;
      if (!join) continue;
      const later = bUsesA ? b : a;
      const earlier = bUsesA ? a : b;
      const unit = (later.workUnits ?? []).find((u) => (u.role ?? "code") !== "test");
      if (!unit) continue;
      // Already ordered by the reading's own `needs` — nothing to add.
      if ((unit.consumes ?? []).includes(join.used)) continue;
      unit.consumes = [...new Set([...(unit.consumes ?? []), join.used])];
      added.push({ after: later.handle, before: earlier.handle, user: join.user, used: join.used });
    }
  return { added, knots };
}
