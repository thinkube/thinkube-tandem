/**
 * Test-side ownership in a run.
 *
 * Every test-shaped path a plan names — a probe, an existing test home a
 * promise lands in, a test the change would break — belongs to the tester,
 * who works from the criteria before the code exists. The coder's footprint
 * holds production paths only, and never sees a test. One rule decides what
 * "test-shaped" means, read by the adapter, the write fence, the read block,
 * the blast-radius fold and re-homing alike.
 *
 * What the tester decides where the contract was silent — a name, a literal,
 * a rule — is contract for the coder and lands on the delivery: flowed to the
 * actor that needs it, recorded for the reader, never asked of the human.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Any test-shaped path — by the conventions test files are named and
 *  housed under across ecosystems, never by one language's extension: a
 *  `.test`/`.spec` file, a `test_*`/`*_test` file, anything under a tests
 *  directory, a probe, held-out acceptance. */
export function isTestPath(rel: string): boolean {
  const t = rel.replace(/\\/g, "/");
  return (
    /(^|[\s/])probes\//.test(t) ||
    /(^|\/)acceptance\//.test(t) ||
    /(^|\/)(tests?|__tests__|spec)\//.test(t) ||
    /\.(test|spec)[._-][^/]*$/.test(t) ||
    /(^|\/)test_[^/]*$/.test(t) ||
    /_test\.[^/.]+$/.test(t)
  );
}

/** A probe: held-out evidence authored by this run, never a test home. */
export function isProbePath(rel: string): boolean {
  const t = rel.replace(/\\/g, "/");
  return /(^|[\s/])probes\//.test(t) || /(^|\/)acceptance\//.test(t);
}

/** Every existing test home a slice's tester owns — test-shaped, not a probe. */
export function testHomesOf(footprint: readonly string[]): string[] {
  return footprint.filter((p) => isTestPath(p) && !isProbePath(p));
}

/** Test homes an edit may have touched in the tester snapshot, restored from
 *  the oracle store OVER what the branch holds: a snapshot reset returns the
 *  file to its committed state, and the store's copy is the tester's work. */
export async function restoreTestHomes(
  storeDir: string,
  toRoot: string,
  homes: readonly string[],
): Promise<string[]> {
  const restored: string[] = [];
  for (const rel of homes) {
    const src = path.join(storeDir, "files", rel);
    try {
      await fs.access(src);
    } catch {
      continue;
    }
    const dst = path.join(toRoot, rel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(src, dst);
    restored.push(rel);
  }
  return restored;
}

/** The tester's contract-completing choices, from its final words. */
export function extractDecisions(finalText: string): string[] {
  return (finalText ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])?\s*/, "").trim())
    .filter((l) => /^DECISION:/i.test(l))
    .map((l) => l.replace(/^DECISION:\s*/i, "").trim())
    .filter(Boolean);
}

/** What the tester decided, as the coder's contract. */
export function decisionsStanza(decisions: readonly string[]): string {
  if (!decisions.length) return "";
  return (
    "\n\n──── THE TESTER'S DECISIONS (contract-completing choices — the names, literals and rules the checks are written to; build to these exactly) ────\n" +
    decisions.map((d) => `- ${d}`).join("\n")
  );
}

/** The tester's brief for the existing test homes it owns in this slice. */
export function testHomesStanza(
  homes: readonly string[],
  work: readonly { path: string; sentence: string; criteria: string[] }[],
): string {
  if (!homes.length) return "";
  const byPath = new Map<string, { sentence: string; criteria: string[] }[]>();
  for (const w of work) {
    const list = byPath.get(w.path) ?? [];
    list.push({ sentence: w.sentence, criteria: w.criteria });
    byPath.set(w.path, list);
  }
  const lines = homes.map((h) => {
    const items = byPath.get(h) ?? [];
    return (
      `- ${h}` +
      (items.length
        ? "\n" +
          items
            .map(
              (i) =>
                `    · ${i.sentence}` +
                (i.criteria.length ? `\n      done when: ${i.criteria.join("; ")}` : ""),
            )
            .join("\n")
        : "\n    · a test here exercises code this slice changes — bring it under the new behavior or retire what it pinned")
    );
  });
  return (
    "\n\n──── EXISTING TEST HOMES YOU OWN IN THIS SLICE (bring under — NEVER overwrite) ────\n" +
    "These files EXIST. Read each one first. Edit it in place: sharpen the scenario that owns the promise, " +
    "bring fixtures under the new rule, delete a scenario whose pinned behavior the criteria retire — " +
    "never appease a scenario to keep it green, never rewrite the file wholesale, never add a block for this " +
    "delivery. Work from the criteria and the contract: the implementation does not exist yet.\n" +
    lines.join("\n") +
    "\n\nEnd your final summary with one line per choice the contract forced on you (an exact name, literal, " +
    'or rule), each starting exactly with "DECISION: " — the coder builds to these without ever seeing your tests.'
  );
}
