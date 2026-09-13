/**
 * A repair the reviewers asked for is measured by the tree changing and
 * building, not by the build alone — which already passed when they looked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { measureOnTheProduct, measureTheBuild } from "./repairLive";

test("an untouched tree is red for a repair the reviewers asked for, whatever the build says", () => {
  const m = measureOnTheProduct({ build: { ok: true, output: "" }, changed: false, evidence: "  - the count reads '1 of 2 task'" });
  assert.equal(m.green, false);
  assert.match(m.evidence, /nothing in the tree has changed yet/);
  assert.match(m.evidence, /1 of 2 task/);
});

test("a changed tree that builds is green; a changed tree that does not build says so", () => {
  assert.equal(measureOnTheProduct({ build: { ok: true, output: "" }, changed: true, evidence: "" }).green, true);
  const red = measureOnTheProduct({ build: { ok: false, output: "TS2322: wrong" }, buildCommand: "npm run build", changed: true, evidence: "" });
  assert.equal(red.green, false);
  assert.match(red.evidence, /BUILD FAILS HERE \(npm run build\)/);
});

test("a repair the platform's refusal asked for is measured by the build alone", () => {
  assert.equal(measureTheBuild({ build: { ok: true, output: "" } }).green, true);
  assert.equal(measureTheBuild({ build: { ok: false, output: "boom" } }).green, false);
});
