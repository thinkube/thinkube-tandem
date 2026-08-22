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

/** Files a test runner can execute — any ecosystem, never one language's.
 *  A configuration or a document is never a test, whatever its name says:
 *  `tsconfig.test.json` is a compiler's config, not a check. */
const RUNNABLE = /\.(m|c)?[jt]sx?$|\.(py|rb|go|rs|java|kt|kts|php|cs|swift|scala|ex|exs|sh|bash|lua|dart|pl|pm)$/i;

/** Any test-shaped path — by the conventions test files are named and
 *  housed under across ecosystems, never by one language's extension: a
 *  `.test`/`.spec` file, a `test_*`/`*_test` file, anything under a tests
 *  directory, a probe, held-out acceptance. Only a file a runner could
 *  execute qualifies — a name is not enough. */
export function isTestPath(rel: string): boolean {
  const t = rel.replace(/\\/g, "/");
  if (/(^|[\s/])probes\//.test(t) || /(^|\/)acceptance\//.test(t)) return true;
  if (!RUNNABLE.test(t)) return false;
  return (
    /(^|\/)(tests?|__tests__|spec)\//.test(t) ||
    /\.(test|spec)[._-][^/]*$/.test(t) ||
    /(^|\/)test_[^/]*$/.test(t) ||
    /_test\.[^/.]+$/.test(t)
  );
}

/**
 * A check this run authored — held-out evidence, never a test home the
 * repository maintains.
 *
 * A check is known by the criterion in its name (`_AC-3`), not by the
 * directory it sits in, because a check is now born beside the module it
 * drives (src/run/checkHomes.ts). The old `probes/` coordinate still reads
 * as a check, so a branch an earlier run left half-finished still parses.
 */
export function isProbePath(rel: string): boolean {
  const t = rel.replace(/\\/g, "/");
  if (/(^|[\s/])probes\//.test(t) || /(^|\/)acceptance\//.test(t)) return true;
  return /_AC-\d+/.test(t) && isTestPath(t);
}

/** Every existing test home a slice's tester owns — test-shaped, not a probe. */
export function testHomesOf(footprint: readonly string[]): string[] {
  return footprint.filter((p) => isTestPath(p) && !isProbePath(p));
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

/** A tester's turn budget scales with what it must write. */
export function testerTurns(files: number): number {
  return Math.min(300, 40 + 12 * files);
}

/** Declared probes not yet on disk — what a tester that stopped short still owes. */
export async function missingProbes(tree: string, footprint: readonly string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const rel of footprint.filter(isProbePath))
    if (!(await fs.access(path.join(tree, rel)).then(() => true, () => false))) missing.push(rel);
  return missing;
}

/** The brief for a tester's continuation: what is written stays, what is left is named. */
export function continuationBrief(brief: string, footprint: readonly string[], missing: readonly string[]): string {
  const written = footprint.filter((r) => isProbePath(r) && !missing.includes(r));
  return (
    brief +
    "\n\nCONTINUE — your previous session ended before every declared probe was written. " +
    `Already written (do not rewrite): ${written.join(", ") || "none"}.\n` +
    "STILL TO WRITE — write exactly these, one criterion each, then end with your DECISION lines:\n" +
    missing.map((m) => `- ${m}`).join("\n")
  );
}
