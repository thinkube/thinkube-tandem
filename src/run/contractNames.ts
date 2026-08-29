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

/**
 * Existing tests that exercise the files a slice is about to change.
 *
 * The same relation as above, read the other way. A slice that changes a
 * file inherits every test already pinning that file's behaviour: some
 * written for an earlier ask, some for a fix nobody wrote an ask for. The
 * tester is the only actor allowed to touch a test, and the only one
 * holding the criteria that say what the behaviour becomes — so the
 * reconciliation belongs to it, while it writes the new checks, not to a
 * finisher cleaning up at the end of a seventy-minute run.
 */
async function testsTouching(a: {
  tree: string;
  /** The production files this slice changes. */
  files: readonly string[];
  /** Every test file in the repository, repository-relative. */
  tests: readonly string[];
}): Promise<Map<string, string[]>> {
  const byTest = new Map<string, string[]>();
  for (const test of a.tests) {
    let src = "";
    try {
      src = await fs.readFile(path.join(a.tree, test), "utf8");
    } catch {
      continue;
    }
    const hit: string[] = [];
    for (const m of src.matchAll(IMPORT)) {
      const file = pointsAt(test, m[2], a.files);
      if (file && !hit.includes(file)) hit.push(file);
    }
    if (hit.length) byTest.set(test, hit.sort());
  }
  return byTest;
}

/**
 * What the tester is told about them.
 *
 * The moment matters: a tester runs BEFORE the code exists, so it cannot
 * run these and see what happens. What it has is the criteria — which
 * already say what the behaviour becomes. A test pinning something the
 * criteria contradict is superseded by intent, and that is decidable now,
 * without waiting for anyone to build anything.
 */
function inheritedTestsBrief(byTest: ReadonlyMap<string, string[]>): string {
  if (!byTest.size) return "";
  const lines = [...byTest]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([test, files]) => `  ${test} — pins behaviour of ${files.join(", ")}`);
  return (
    "──── TESTS THAT ALREADY PIN THE FILES YOU CHANGE ────\n" +
    "These exist and are green today. They were written for earlier work — some for an ask, some\n" +
    "for a fix nobody wrote an ask for. Read each one before you write anything new.\n" +
    lines.join("\n") +
    "\n\nFor each scenario in them, compare what it pins against YOUR criteria:\n" +
    "  · your criteria say nothing about it — leave it exactly as it is. Do not touch a test you\n" +
    "    did not need to touch, and do not tidy one.\n" +
    "  · your criteria CONTRADICT what it pins — that behaviour has been overruled by what the\n" +
    "    person asked for. Bring the scenario under the new rule, or delete it if nothing is left\n" +
    "    for it to pin, and name in your DECISION lines which behaviour it used to pin.\n" +
    "  · a scenario may already have been brought under a rule by ANOTHER unit of this same cut,\n" +
    "    minutes ago, in this same file. Leave it alone unless your own criteria contradict it.\n" +
    "You are never making these agree with code — no code exists yet. You are saying which of them\n" +
    "the person has just overruled."
  );
}

/**
 * The tester's brief with the tests it inherits appended — the ones
 * already pinning the files its slice changes.
 */
export async function briefWithInherited(
  brief: string,
  a: { role: "code" | "test"; tree: string; files: readonly string[]; tests: readonly string[] },
): Promise<string> {
  if (a.role !== "test") return brief;
  const inherited = inheritedTestsBrief(await testsTouching(a));
  return inherited ? `${brief}\n\n${inherited}` : brief;
}
