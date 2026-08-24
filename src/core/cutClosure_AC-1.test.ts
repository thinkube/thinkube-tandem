/**
 * INVARIANT — documentationOf must return exactly the documentation
 * touchpoints of the cut's own promises: not a source touchpoint on one of
 * those promises, and not a documentation touchpoint on a promise outside
 * the cut. A sign gate that trusts this list to decide "did this cut
 * document anything" needs it precise in both directions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { documentationOf } from "./cutClosure";
import type { Change } from "./schema";

const nodes: Change[] = [
  {
    id: "n1",
    sentence: "add a helper",
    serves: [],
    needs: [],
    acceptance: [{ id: "c1", text: "it works" }],
    grounding: {
      touchpoints: [
        { path: "src/helper.ts" },
        { path: "docs/modules/ROOT/pages/helper.adoc" },
      ],
      stamp: [],
    },
  },
  {
    id: "n2",
    sentence: "document something else, outside this cut",
    serves: [],
    needs: [],
    acceptance: [{ id: "c2", text: "it works" }],
    grounding: {
      touchpoints: [{ path: "docs/modules/ROOT/pages/other.adoc" }],
      stamp: [],
    },
  },
];

test("documentationOf returns only the documentation touchpoints of the cut's own promises", () => {
  const result = documentationOf(["n1"], nodes);
  assert.deepEqual(result, ["docs/modules/ROOT/pages/helper.adoc"]);
  assert.ok(!result.includes("src/helper.ts"), "a source touchpoint is not documentation");
  assert.ok(
    !result.includes("docs/modules/ROOT/pages/other.adoc"),
    "a documentation touchpoint on a promise outside the cut is not this cut's documentation",
  );
});

test("documentationOf returns an empty list when the cut's promises land no documentation", () => {
  const sourceOnly: Change = {
    id: "n3",
    sentence: "add another helper",
    serves: [],
    needs: [],
    acceptance: [{ id: "c3", text: "it works" }],
    grounding: { touchpoints: [{ path: "src/other.ts" }], stamp: [] },
  };
  assert.deepEqual(documentationOf(["n3"], [sourceOnly]), []);
});
