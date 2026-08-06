/**
 * Scope planning (§7quater), pure: changes group by their touchpoints'
 * scope, a mixed-scope change refuses, cross-scope needs order the
 * batches, and a scope cycle refuses with the reason named.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { planScopes, qualifySpace } from "./scopes";
import { emptySpace, Space } from "../core/schema";

function spaceWith(nodes: Space["nodes"]): Space {
  return { ...emptySpace(), nodes };
}

const node = (id: string, scope: string | undefined, needs: string[] = []) => ({
  id,
  sentence: `change ${id}`,
  serves: ["ask-1"],
  needs,
  acceptance: [{ id: "c", text: "x" }],
  grounding: {
    touchpoints: [{ path: `src/${id}.ts`, ...(scope ? { scope } : {}) }],
    stamp: [],
  },
});

test("changes group by scope; cross-scope needs order the batches (producer first)", () => {
  const s = spaceWith([
    node("a", undefined),
    node("b", "member-1", ["a"]),
    node("c", "member-1"),
  ]);
  const plan = planScopes(s, { id: "cut", changeIds: ["a", "b", "c"] });
  assert.ok(plan.ok);
  assert.deepEqual(plan.order, ["", "member-1"], "the anchor (producer) dispatches first");
  assert.deepEqual(plan.groups.get("member-1"), ["b", "c"]);
});

test("a change mixing scopes refuses with the change named", () => {
  const mixed = {
    ...node("a", undefined),
    grounding: {
      touchpoints: [{ path: "src/a.ts" }, { path: "src/b.ts", scope: "member-1" }],
      stamp: [],
    },
  };
  const plan = planScopes(spaceWith([mixed]), { id: "cut", changeIds: ["a"] });
  assert.ok(!plan.ok && plan.reason.includes("mixes scopes"));
});

test("a scope cycle refuses instead of picking a winner", () => {
  const s = spaceWith([
    node("a", undefined, ["b"]),
    node("b", "member-1", ["a"]),
  ]);
  const plan = planScopes(s, { id: "cut", changeIds: ["a", "b"] });
  assert.ok(!plan.ok && plan.reason.includes("cycle"));
});

test("qualifySpace prefixes every grounded path and nothing else", () => {
  const s = spaceWith([node("a", undefined)]);
  const q = qualifySpace(s, "extensions/alpha");
  assert.equal(q.nodes[0].grounding!.touchpoints[0].path, "extensions/alpha/src/a.ts");
  assert.equal(qualifySpace(s, ""), s, "no prefix, no copy");
});
