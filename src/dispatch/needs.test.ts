import { test } from "node:test";
import assert from "node:assert/strict";
import { importersIn, testHomeNeeds } from "./needs";
import type { Change } from "../core/schema";

const AFFECTED = [
  "Affected nodes for session.ts",
  "- extension.ts [imports_from] src/extension.ts:L10",
  "- surfaces.test.ts [imports_from] src/surfaces/surfaces.test.ts:L13",
  "- .constructor() [references] src/surfaces/panel.ts:L447",
].join("\n");

test("the graph's importer listing yields the paths that import a node — imports only, not references", () => {
  assert.deepEqual(importersIn(AFFECTED), ["src/extension.ts", "src/surfaces/surfaces.test.ts"]);
});

test("a promise bringing a test home under needs the promise whose code that test imports — read from the graph, not guessed", async () => {
  const nodes: Change[] = [
    {
      id: "waive",
      sentence: "the person can waive documentation",
      serves: [],
      needs: [],
      acceptance: [],
      grounding: { touchpoints: [{ path: "src/surfaces/session.ts" }], stamp: [] },
    },
    {
      id: "under",
      sentence: "bring the signing tests under the rule",
      serves: [],
      needs: [],
      acceptance: [],
      grounding: { touchpoints: [{ path: "src/surfaces/surfaces.test.ts" }], stamp: [] },
    },
    {
      id: "other",
      sentence: "unrelated",
      serves: [],
      needs: [],
      acceptance: [],
      grounding: { touchpoints: [{ path: "src/other.ts" }], stamp: [] },
    },
  ];
  const asked: string[] = [];
  const needs = await testHomeNeeds(nodes, async (p) => {
    asked.push(p);
    return p === "src/surfaces/session.ts" ? AFFECTED : "";
  });
  assert.deepEqual(needs, [
    { from: "under", to: "waive", via: { testHome: "src/surfaces/surfaces.test.ts", imports: "src/surfaces/session.ts" } },
  ]);
  assert.ok(!asked.includes("src/surfaces/surfaces.test.ts"), "only production paths are asked about");
});
