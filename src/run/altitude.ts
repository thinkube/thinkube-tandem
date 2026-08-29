/**
 * Altitude: whether a promise can be observed from outside the product.
 *
 * The failure this exists for is the one the whole methodology was built
 * against: **you ask for a car and you get a tricycle.** A set of parts,
 * each correct, each proven by a check that builds the part and calls it,
 * and no product. Every check green.
 *
 * A criterion pitched at a class does that on its own. Its check has no
 * choice but to construct the class and call the method, so the check
 * passes whether or not anything else in the product ever calls it — and
 * the wiring trace cannot help, because the class really did execute.
 *
 * The fact needed to catch it is not a guess about wording: it is whether
 * the name the criterion leans on is a METHOD OF A CLASS rather than
 * something the module hands out. The code map the machine already builds
 * says exactly that, for every language it maps.
 *
 * The rule is deliberately narrow. It fires only when a criterion names a
 * class method and names nothing the module exports — so "greet() returns
 * hello" is untouched, "the panel opens once per space" is untouched, and
 * only "SpacePanel.reveal() sets the active tab" is sent back.
 */
import * as fs from "node:fs";

/** A method of a class, as the code map records it. */
export interface ClassMethod {
  /** The class it belongs to. */
  className: string;
  /** The method's bare name, without punctuation. */
  method: string;
  file: string;
}

interface GraphNode {
  id?: string;
  label?: string;
  source_file?: string;
}
interface GraphLink {
  relation?: string;
  source?: string;
  target?: string;
}

/**
 * Every class method this repository has, from the map. Absent or
 * unreadable map → nothing, and the rule simply does not fire: an
 * unavailable reading is never a refusal.
 */
export function classMethodsIn(graphPath: string): ClassMethod[] {
  let parsed: { nodes?: GraphNode[]; links?: GraphLink[] };
  try {
    parsed = JSON.parse(fs.readFileSync(graphPath, "utf8")) as { nodes?: GraphNode[]; links?: GraphLink[] };
  } catch {
    return [];
  }
  const byId = new Map((parsed.nodes ?? []).map((n) => [n.id ?? "", n]));
  const out: ClassMethod[] = [];
  for (const l of parsed.links ?? []) {
    if (l.relation !== "method") continue;
    const cls = byId.get(l.source ?? "");
    const m = byId.get(l.target ?? "");
    const method = (m?.label ?? "").replace(/^\./, "").replace(/\(\)$/, "");
    if (!cls?.label || !method || method === "constructor") continue;
    out.push({ className: cls.label, method, file: m?.source_file ?? cls.source_file ?? "" });
  }
  return out;
}

/** The names a criterion's own words lean on. */
function symbolsNamed(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/`([A-Za-z_$][\w$.]*)(?:\(\))?`/g)) out.add(m[1]);
  for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*\(/g)) out.add(m[1]);
  for (const m of text.matchAll(/\b([a-z][a-zA-Z0-9]*)\s*\(/g)) out.add(m[1]);
  return [...out];
}

/**
 * Why this criterion cannot be observed from outside the product, or
 * nothing.
 *
 * `exported` answers whether a name is something a module hands out — a
 * criterion that leans on one of those is at the product's seam, whatever
 * else it also mentions.
 */
export function wrongAltitude(a: {
  criterion: string;
  methods: readonly ClassMethod[];
  exported: (symbol: string) => boolean;
}): string | undefined {
  const named = symbolsNamed(a.criterion);
  if (!named.length) return undefined;
  if (named.some((n) => a.exported(n.split(".").pop() ?? n))) return undefined;
  for (const n of named) {
    const bare = n.includes(".") ? (n.split(".").pop() ?? n) : n;
    const hit = a.methods.find(
      (m) => m.method === bare && (!n.includes(".") || n.split(".")[0] === m.className),
    );
    if (hit)
      return (
        `it can only be checked by building ${hit.className} and calling ${hit.method} on it. ` +
        `A check written that way passes whether or not anything in the product ever calls it — which is how a set of ` +
        `correct parts adds up to something that does not work. Say what the product must DO when this is true, ` +
        `from where a person meets it.`
      );
  }
  return undefined;
}

/**
 * Whether a name is something these files hand out — read from the files
 * themselves, in the forms every language writes an export in that this
 * repository can see.
 *
 * A file that IS NOT THERE hands out nothing, and that is a fact: a
 * promise plans files that do not exist yet. A file that is there and
 * cannot be READ is not a fact about anything — it is a fault here, and
 * answering "hands out nothing" for it removes the exemption that keeps
 * the altitude rule from firing, so the person's plan is refused for a
 * failed read. Those files are named instead, and the caller stops.
 */
export function exportedIn(
  repoRoot: string,
  files: readonly string[],
): { exported: (symbol: string) => boolean; unreadable: string[] } {
  const unreadable: string[] = [];
  const sources = files
    .map((f) => {
      try {
        return fs.readFileSync(`${repoRoot}/${f}`, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") unreadable.push(f);
        return "";
      }
    })
    .filter(Boolean);
  const exported = (symbol: string): boolean => {
    const s = symbol.replace(/[$]/g, "\\$&");
    return sources.some(
      (src) =>
        new RegExp(`export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const|let|var|class|interface|type|enum)\\s+${s}\\b`).test(src) ||
        new RegExp(`export\\s*\\{[^}]*\\b${s}\\b[^}]*\\}`).test(src) ||
        new RegExp(`\\bdef\\s+${s}\\b`).test(src) ||
        new RegExp(`\\bfunc\\s+${s}\\b`).test(src),
    );
  };
  return { exported, unreadable };
}
