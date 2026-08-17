import { test } from "node:test";
import assert from "node:assert/strict";
import { bindTestHomeConsumes, importersIn } from "./needs";
import type { SliceForDag } from "../engine/core/dag";

const AFFECTED = [
  "Affected nodes for session.ts",
  "- extension.ts [imports_from] src/extension.ts:L10",
  "- surfaces.test.ts [imports_from] src/surfaces/surfaces.test.ts:L13",
  "- .constructor() [references] src/surfaces/panel.ts:L447",
].join("\n");

test("the graph's importer listing yields the paths that import a node — imports only, not references", () => {
  assert.deepEqual(importersIn(AFFECTED), ["src/extension.ts", "src/surfaces/surfaces.test.ts"]);
});

test("a slice's maintainer consumes the production its test homes import — read from the graph, not guessed", async () => {
  const slices: SliceForDag[] = [
    {
      handle: "SL-1",
      status: "ready",
      files: ["src/surfaces/session.ts"],
      workUnits: [{ footprint: ["src/surfaces/session.ts"], execution: "serial", role: "code" }],
    },
    {
      handle: "SL-2",
      status: "ready",
      files: ["src/gates/sign.ts", "src/surfaces/surfaces.test.ts"],
      workUnits: [
        { footprint: ["src/gates/sign.ts"], execution: "serial", role: "code" },
        { footprint: ["src/surfaces/surfaces.test.ts"], execution: "fan-out", role: "code" },
      ],
    },
  ];
  const asked: string[] = [];
  await bindTestHomeConsumes(slices, async (p) => {
    asked.push(p);
    return p === "src/surfaces/session.ts" ? AFFECTED : "";
  });
  const maintainer = slices[1].workUnits[1] as { consumes?: string[] };
  assert.deepEqual(maintainer.consumes, ["src/surfaces/session.ts"], "the maintainer runs after the code its test home imports — in another slice");
  assert.ok(!asked.includes("src/surfaces/surfaces.test.ts"), "only production paths are asked about");
});
