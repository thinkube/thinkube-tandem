/**
 * The names a check will import from the code it judges.
 *
 * A check is written before the code, by a different actor, and it fixes
 * exact identifiers: a field name, an exported constant, a constructor's
 * shape. The coder is told the intent in prose and is blind to the check.
 * In a typed language the two must agree on the identifier to compile at
 * all — so the coder is not being asked to write good code, it is being
 * asked to guess a word somebody else already wrote down in the one file
 * it may not open.
 *
 * It fails, twice, and then the supervisor reads both sides and discloses
 * the word. That is the most frequent defect this machine records, in
 * every version of it, and it costs a worker session every time.
 *
 * A name is not an answer. It is the seam between two units, and it
 * belongs in the contract like any other part of a seam. So the names the
 * checks import are read from the checks and handed to the coder before it
 * starts. What the check ASSERTS never crosses; only what it calls things.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

/** An import of production code from inside a check. */
const IMPORT = /import\s+(?:type\s+)?(\{[^}]*\}|[A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']/g;

/** `{ a, b as c, type D }` → the names as the SOURCE module must export them. */
function exportedNames(clause: string): string[] {
  if (!clause.startsWith("{")) return [clause.trim()].filter(Boolean);
  return clause
    .slice(1, -1)
    .split(",")
    .map((p) => p.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim())
    .filter(Boolean);
}

/** Does this import specifier point at one of the unit's own files? */
function pointsAt(fromProbe: string, spec: string, owned: readonly string[]): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromProbe), spec));
  const bare = resolved.replace(/\.(m|c)?[jt]sx?$/, "");
  return owned.find((f) => f.replace(/\.(m|c)?[jt]sx?$/, "") === bare);
}

/**
 * What the checks require the coder's own files to hand out, per file.
 *
 * Read from the checks' import lines only. An assertion is a judgement and
 * never crosses the wall; an import is the name of a door, and a coder
 * that does not know where the door is cannot build the room.
 */
export async function namesTheChecksRequire(a: {
  tree: string;
  /** The checks written for this slice, repository-relative. */
  probes: readonly string[];
  /** The production files this slice's coder owns. */
  owned: readonly string[];
}): Promise<Map<string, string[]>> {
  const byFile = new Map<string, Set<string>>();
  for (const probe of a.probes) {
    let src = "";
    try {
      src = await fs.readFile(path.join(a.tree, probe), "utf8");
    } catch {
      continue;
    }
    for (const m of src.matchAll(IMPORT)) {
      const file = pointsAt(probe, m[2], a.owned);
      if (!file) continue;
      const set = byFile.get(file) ?? new Set<string>();
      for (const n of exportedNames(m[1])) set.add(n);
      byFile.set(file, set);
    }
  }
  return new Map([...byFile].map(([f, s]) => [f, [...s].sort()]));
}

/**
 * The paragraph a coder is given, or nothing when the checks import
 * nothing from its files — a slice whose checks drive it through some
 * other seam has no names to agree on.
 */
export function namesBrief(byFile: ReadonlyMap<string, string[]>): string {
  if (!byFile.size) return "";
  const lines = [...byFile]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, names]) => `  ${file} must export: ${names.join(", ")}`);
  return (
    "──── NAMES THE CHECKS WILL IMPORT FROM YOUR FILES ────\n" +
    "These are the exact identifiers the checks that judge you import. Export\n" +
    "them with these spellings; a different name does not fail an assertion,\n" +
    "it stops the check compiling. Nothing here says what the checks assert,\n" +
    "and matching a name proves nothing on its own — build what the promise\n" +
    "says, and hand it out under these names.\n" +
    lines.join("\n")
  );
}

/**
 * A coder's brief with the names its checks will import appended.
 *
 * A tester's brief is unchanged: the tester chose the names, and telling
 * it its own choices teaches nothing.
 */
export async function briefWithNames(
  baseBrief: string,
  a: { role: "code" | "test"; tree: string; probes: readonly string[]; owned: readonly string[] },
): Promise<string> {
  if (a.role === "test") return baseBrief;
  const names = namesBrief(await namesTheChecksRequire(a));
  return names ? `${baseBrief}\n\n${names}` : baseBrief;
}
