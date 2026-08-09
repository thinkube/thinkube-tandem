/**
 * Unit formation on real coupling: what merges, what stays a dependency,
 * and what never merges on its own.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { couplingOf, formUnits, unitEdges } from "./cluster";
import { Change } from "./schema";

function node(
  id: string,
  touchpoints: string[],
  needs: string[] = [],
): Change {
  return {
    id,
    sentence: id,
    serves: ["ask-1"],
    needs,
    acceptance: [],
    grounding: {
      touchpoints: touchpoints.map((path) => ({ path })),
      stamp: [],
    },
  };
}

test("prose-distinct nodes that are structurally one thing form ONE unit", () => {
  // Three sentences, one module: the second depends into the first, the
  // third shares a file with it. Coupling, not wording, decides units.
  const trio = [
    node("n-substrate", ["webview/src/graph-core/Canvas.tsx", "webview/src/graph-core/NodeFrame.tsx"]),
    node("n-lod", ["webview/src/graph-core/lod.ts"], ["n-substrate"]),
    node("n-expander", ["webview/src/graph-core/expander.ts", "webview/src/graph-core/NodeFrame.tsx"]),
  ];
  const units = formUnits(trio);
  assert.equal(units.length, 1, "one dense thing, one unit");
  assert.deepEqual(units[0].changeIds.sort(), ["n-expander", "n-lod", "n-substrate"]);
});

test("same file is decisive; a single needs-edge alone is a dependency, not a merge", () => {
  const a = node("a", ["src/map/render.ts"]);
  const b = node("b", ["src/map/render.ts"]);
  assert.equal(formUnits([a, b]).length, 1, "same file → same unit");

  const c = node("c", ["src/capture/input.ts"]);
  const d = node("d", ["src/gates/accept.ts"], ["c"]);
  const units = formUnits([c, d]);
  assert.equal(units.length, 2, "one edge → two units");
  assert.deepEqual(unitEdges([c, d], units), [
    { from: units.find((u) => u.changeIds.includes("d"))!.id, to: units.find((u) => u.changeIds.includes("c"))!.id },
  ]);
});

test("dense coupling merges: shared module + a needs-edge reach the threshold", () => {
  const a = node("a", ["src/dispatch/orders.ts"]);
  const b = node("b", ["src/dispatch/resolve.ts"], ["a"]);
  assert.equal(couplingOf(a, b), 2, "module overlap + edge = 2 signals");
  assert.equal(formUnits([a, b]).length, 1);

  const far = node("far", ["docs/terms.md"]);
  assert.equal(formUnits([a, far]).length, 2, "no signals → separate");
});

test("module overlap ALONE never merges — a directory is not a unit", () => {
  // A whole codebase can live under one directory; if a shared module were
  // decisive on its own, everything would collapse into one unit.
  const nodes = [node("x", ["src/a/one.ts"]), { ...node("y", []), grounding: undefined }, node("z", ["src/a/two.ts"])];
  const u1 = formUnits(nodes);
  const u2 = formUnits(nodes.map((n) => ({ ...n })));
  assert.deepEqual(u1, u2, "deterministic");
  assert.equal(u1.length, 3, "one shared module is a neighborhood, not a unit; ungrounded y stands alone");
});

test("changes that need each other end up in ONE unit — the engine never sees a cycle", () => {
  // A needs B, B needs A, and they share nothing else. Split across units
  // their needs become dependencies in both directions, and the engine
  // refuses the whole plan rather than one unit.
  const a = node("a", ["src/a.ts"], ["b"]);
  const b = node("b", ["src/b.ts"], ["a"]);
  const c = node("c", ["src/c.ts"]);
  const units = formUnits([a, b, c]);
  assert.equal(units.length, 2, "the pair is one unit, the loner another");
  assert.equal(units.find((u) => u.changeIds.includes("a"))!.changeIds.length, 2);
});

test("a longer ring is dissolved too, not just a mutual pair", () => {
  // Each pair carries a single needs-edge — below the coupling threshold —
  // so nothing merges them, and the ring only shows up at the engine.
  const units = formUnits([
    node("a", ["src/a.ts"], ["c"]),
    node("b", ["src/b.ts"], ["a"]),
    node("c", ["src/c.ts"], ["b"]),
  ]);
  assert.equal(units.length, 1, "a ring cannot be ordered, so it is one unit");
  assert.equal(units[0].changeIds.length, 3);
});

test("changes touching the same file are one unit, whatever the unit grows to", () => {
  const units = formUnits([
    node("a", ["src/x.ts"]),
    node("b", ["src/x.ts"]),
    node("c", ["src/y.ts"]),
  ]);
  assert.equal(units.length, 2);
  assert.equal(units.find((u) => u.changeIds.includes("a"))!.changeIds.length, 2);
});
