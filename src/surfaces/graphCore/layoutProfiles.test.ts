/** ELK inputs: layered flat graph; islands as one nested container per component. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildElkGraph, elkOptions } from "./layoutProfiles";

test("layered profile: flat children + edges, RIGHT direction", () => {
  const g = buildElkGraph(
    [
      { id: "a", w: 100, h: 40 },
      { id: "b", w: 100, h: 40 },
    ],
    [{ from: "a", to: "b" }],
    "layered",
  ) as { layoutOptions: Record<string, string>; children: unknown[]; edges: { sources: string[]; targets: string[] }[] };
  assert.equal(g.layoutOptions["elk.algorithm"], "layered");
  assert.equal(g.layoutOptions["elk.direction"], "RIGHT");
  assert.equal(g.children.length, 2);
  assert.deepEqual(g.edges[0].sources, ["a"]);
  assert.deepEqual(g.edges[0].targets, ["b"]);
});

test("islands profile: one container per island, edges kept inside their container", () => {
  const g = buildElkGraph(
    [
      { id: "a", w: 100, h: 40, island: 0 },
      { id: "b", w: 100, h: 40, island: 0 },
      { id: "c", w: 100, h: 40, island: 1 },
    ],
    [{ from: "a", to: "b" }],
    "islands",
  ) as { children: { id: string; children: { id: string }[]; edges: unknown[] }[] };
  assert.deepEqual(g.children.map((c) => c.id).sort(), ["island-0", "island-1"]);
  const island0 = g.children.find((c) => c.id === "island-0")!;
  const island1 = g.children.find((c) => c.id === "island-1")!;
  assert.deepEqual(island0.children.map((c) => c.id).sort(), ["a", "b"]);
  assert.deepEqual(island1.children.map((c) => c.id), ["c"]);
  assert.equal(island0.edges.length, 1);
  assert.equal(island1.edges.length, 0);
  assert.equal(elkOptions("islands")["elk.algorithm"], "box", "containers packed apart");
});
