/**
 * The closer is shown the checks its brief says it is shown.
 *
 * The brief prints a heading — "THE CHECKS, IN FULL" — and then whatever
 * `probeSources` holds. Both gate call sites passed an empty list, so the
 * last and most expensive actor read a heading, found nothing under it, and
 * concluded the checks lived somewhere it could not see. It then spent its
 * rounds reconstructing the harness from directory listings and timestamps
 * instead of answering the criteria, while the answer sat in the tree it
 * already had open.
 *
 * `restored` guards its own heading and is tested for it. This one is now
 * guarded the same way, and both call sites are read at source: a required
 * field that accepts `[]` gives no signal at the call site that empty is
 * wrong, so the type cannot catch this and a reader must.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { closerBrief, probesForClosing } from "./closer";

const SOURCE = `import { PAGES } from "./pages";
test("every handle appears", () => assert.match(src, /data-work-page/));`;

function brief(probeSources: { path: string; source: string }[], checks?: { root: string; paths: string[] }): string {
  return closerBrief({
    subject: "TEP-1 (the unkept promises)",
    worktree: "/wt",
    footprint: ["src/run/gate.ts"],
    probeSources,
    history: ["a promise: still red"],
    criteria: [{ id: "c1", text: "the page names every criterion" }],
    state: { evidence: "1 red", green: false, score: 4 },
    ...(checks ? { checks } : {}),
  } as never);
}

test("the checks are in the brief, whole, not named and withheld", () => {
  const b = brief([{ path: "src/surfaces/pages_AC-1.test.ts", source: SOURCE }]);
  assert.match(b, /THE CHECKS, IN FULL/);
  assert.match(b, /src\/surfaces\/pages_AC-1\.test\.ts/);
  assert.match(b, /data-work-page/, "the check's own text, not a summary of it");
});

test("no checks in hand says nothing, rather than promising them", () => {
  assert.doesNotMatch(brief([]), /THE CHECKS, IN FULL/, "a heading over nothing sends the reader looking");
});

test("one tree is not described as two", () => {
  const b = brief([{ path: "p_AC-1.test.ts", source: SOURCE }], { root: "/wt", paths: ["p_AC-1.test.ts"] });
  assert.doesNotMatch(b, /A SEPARATE TREE/, "the checks sit beside the code; sending the closer elsewhere sends it nowhere");
  assert.match(b, /in the tree above/);
  assert.match(b, /RULING:/, "correcting a check still costs a ruling");
});

test("the checks behind the promises still open lead — the brief keeps only twelve", () => {
  const all = Array.from({ length: 20 }, (_, i) => `p${i}_AC-1.test.ts`);
  const criterionByProbe = new Map(all.map((p, i) => [p, `ac-${i}`]));
  const ordered = probesForClosing(all, criterionByProbe, new Set(["ac-17", "ac-19"]));

  assert.deepEqual(ordered.slice(0, 2), ["p17_AC-1.test.ts", "p19_AC-1.test.ts"], "the open ones survive the cut");
  assert.equal(ordered.length, all.length, "and nothing is dropped — the rest follow for context");
  assert.equal(new Set(ordered).size, ordered.length, "no check is shown twice");
});

/**
 * Read at source, because the type cannot say it: `probeSources` is
 * required, so `[]` satisfies the compiler at every call site while
 * emptying the brief.
 */
test("no gate call site hands the closer an empty set of checks", () => {
  const src = path.resolve(__dirname, "..", "..", "src", "run");
  const guilty: string[] = [];
  for (const name of ["gate.ts", "unkept.ts", "closeUnit.ts"]) {
    const text = fs.readFileSync(path.join(src, name), "utf8");
    text.split("\n").forEach((line, i) => {
      if (/probeSources:\s*\[\s*\]/.test(line)) guilty.push(`${name}:${i + 1}`);
    });
  }
  assert.deepEqual(guilty, [], "a closer handed no checks rebuilds them from the tree instead of answering them");
});
