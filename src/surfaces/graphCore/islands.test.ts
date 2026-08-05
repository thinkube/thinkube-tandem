/** Islands: connected components over undirected dependency edges (AC #10 seam). */
import { test } from "node:test";
import assert from "node:assert/strict";

import { islandsOf } from "./islands";

test("disconnected groups get different island ids; every edge is intra-island", () => {
  const nodes = ["a", "b", "c", "d", "e"];
  const edges = [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "d", to: "e" },
  ];
  const island = islandsOf(nodes, edges);
  assert.equal(island.get("a"), island.get("b"));
  assert.equal(island.get("b"), island.get("c"));
  assert.equal(island.get("d"), island.get("e"));
  assert.notEqual(island.get("a"), island.get("d"), "two components → two islands");
  for (const e of edges)
    assert.equal(island.get(e.from), island.get(e.to), "edges never cross islands");
  const lone = islandsOf(["x"], []);
  assert.equal(lone.size, 1);
});
