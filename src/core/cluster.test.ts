/**
 * Unit formation: one claim, one worker — the methodology's own rule for a
 * slice, sized by coherence and never by a count. These pin what the
 * engine would otherwise refuse a whole plan over: a ring that cannot be
 * ordered, and a dependency whose producer has no way to name itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formUnits } from "./cluster";
import { Change } from "./schema";

function node(
  id: string,
  claim: string | undefined,
  touchpoints: string[],
  needs: string[] = [],
): Change {
  return {
    id,
    sentence: id,
    serves: ["ask-1"],
    needs,
    ...(claim ? { servesClaim: claim } : {}),
    acceptance: [],
    grounding: { touchpoints: touchpoints.map((path) => ({ path })), stamp: [] },
  } as Change;
}

const sizes = (units: { changeIds: string[] }[]): number[] =>
  units.map((u) => u.changeIds.length).sort((a, b) => b - a);

test("the promises that make ONE claim true are one worker's job", () => {
  const units = formUnits([
    node("a", "claim-1", ["src/a.ts"]),
    node("b", "claim-1", ["src/b.ts"]),
    node("c", "claim-1", ["docs/x.adoc"]),
    node("d", "claim-2", ["src/d.ts"]),
  ]);
  assert.deepEqual(sizes(units), [3, 1]);
});

test("a shared file no longer fuses claims — coherence decides, the frontier sequences", () => {
  // Both claims touch the doc page. Under the old rule they became one
  // unit, and a page touched by everything swallowed everything.
  const units = formUnits([
    node("a", "claim-1", ["src/a.ts", "docs/page.adoc"]),
    node("b", "claim-2", ["src/b.ts", "docs/page.adoc"]),
    node("c", "claim-3", ["src/c.ts", "docs/page.adoc"]),
  ]);
  assert.deepEqual(sizes(units), [1, 1, 1], "three claims, three workers");
});

test("a ring of claims that need each other is ONE unit — a cycle cannot be ordered", () => {
  const units = formUnits([
    node("a", "claim-1", ["src/a.ts"], ["b"]),
    node("b", "claim-2", ["src/b.ts"], ["a"]),
    node("c", "claim-3", ["src/c.ts"]),
  ]);
  assert.deepEqual(sizes(units), [2, 1]);
});

test("a longer ring is dissolved too, not just a mutual pair", () => {
  const units = formUnits([
    node("a", "claim-1", ["src/a.ts"], ["c"]),
    node("b", "claim-2", ["src/b.ts"], ["a"]),
    node("c", "claim-3", ["src/c.ts"], ["b"]),
  ]);
  assert.deepEqual(sizes(units), [3]);
});

test("a producer that owns no file alone merges with its consumer, rather than losing the edge", () => {
  // claim-2 touches only a file claim-1 also touches, so it has no file to
  // name itself by. A dependency on it could not be expressed, and work
  // would run in an order nobody declared.
  const units = formUnits([
    node("a", "claim-1", ["src/shared.ts", "src/a.ts"]),
    node("b", "claim-2", ["src/shared.ts"]),
    node("c", "claim-3", ["src/c.ts"], ["b"]),
  ]);
  const together = units.find((u) => u.changeIds.includes("c"))!;
  assert.ok(together.changeIds.includes("b"), "the consumer and the mute producer are one unit");
});

test("a promise serving no claim is its own unit — small and independent", () => {
  const units = formUnits([
    node("a", "claim-1", ["src/a.ts"]),
    node("loose", undefined, ["src/z.ts"]),
  ]);
  assert.deepEqual(sizes(units), [1, 1]);
});

test("the partition is deterministic — the claims' first appearance decides, nothing else", () => {
  const nodes = [
    node("a", "claim-1", ["src/a.ts"]),
    node("b", "claim-2", ["src/b.ts"]),
    node("c", "claim-1", ["src/c.ts"]),
  ];
  const once = formUnits(nodes).map((u) => u.changeIds.join(","));
  const twice = formUnits(nodes).map((u) => u.changeIds.join(","));
  assert.deepEqual(once, twice);
  assert.deepEqual(once, ["a,c", "b"]);
});
