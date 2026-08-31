/**
 * TRANSITION — criterionVerdicts is a new export: it must return one entry
 * for EVERY acceptance criterion of every promise in the delivery's cut,
 * and a criterion no proof mentions must come back as "not checked" rather
 * than being silently left off the list. Its job is done once that shape
 * exists and holds; a later regression that drops the export back to
 * "proofs only" is what this pins against.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { criterionVerdicts } from "./render";
import { emptySpace } from "../core/schema";
import type { Delivery, Space } from "../core/schema";

test("criterionVerdicts names every acceptance criterion of the cut, including one no proof mentions", () => {
  const space: Space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "the panel opens once per space",
        serves: [],
        needs: [],
        acceptance: [
          { id: "c1", text: "opening twice reveals the same tab" },
          { id: "c2", text: "closing the panel frees its key" },
        ],
      },
      {
        id: "n2",
        sentence: "the status bar names the chosen repository",
        serves: [],
        needs: [],
        acceptance: [{ id: "c3", text: "the status bar shows the repository name" }],
      },
    ],
    cuts: [{ id: "cut-1", changeIds: ["n1", "n2"] }],
  };
  const delivery: Delivery = {
    id: "d1",
    cutId: "cut-1",
    branch: "b",
    // c2 and c3 are never mentioned by any proof below — c1 is.
    proofs: [{ kind: "probe", label: "opening twice reveals the same tab", verdict: "green", criterionId: "c1" }],
  };

  const rows = criterionVerdicts(space, delivery);

  assert.equal(rows.length, 3, "one row per acceptance criterion across both promises in the cut");
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.equal(byId.get("c1")?.verdict, "green", "the criterion a proof answers carries that proof's verdict");
  assert.equal(byId.get("c2")?.verdict, "not checked", "a criterion no proof mentions is 'not checked', not dropped");
  assert.equal(byId.get("c3")?.verdict, "not checked", "the same holds for a criterion on a different promise");
  assert.equal(byId.get("c2")?.promiseId, "n1", "the row still names which promise the criterion belongs to");
  assert.equal(byId.get("c2")?.text, "closing the panel frees its key", "and carries the criterion's own words");
  assert.equal(byId.get("c2")?.promise, "the panel opens once per space", "and the promise's own sentence");
});
