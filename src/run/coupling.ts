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
 * Whether two sets of files are joined by use, in either direction — the
 * question is symmetric, because it does not matter which of the two
 * cannot see the other.
 *
 * Returns the pair that joins them, for the sentence a person reads.
 */
export function joinedByUse(
  a: readonly string[],
  b: readonly string[],
  uses: Map<string, Set<string>>,
): { user: string; used: string } | undefined {
  const inB = new Set(b);
  for (const f of a) {
    for (const used of uses.get(f) ?? []) if (inB.has(used)) return { user: f, used };
  }
  const inA = new Set(a);
  for (const f of b) {
    for (const used of uses.get(f) ?? []) if (inA.has(used)) return { user: f, used };
  }
  return undefined;
}
