/**
 * TRANSITION — the documentation refusal must not break the sign gate's
 * own standing scenarios: the proof-anchor-drift cut, the repository-moved
 * cut, and the observation-only cut each promised only source, with no
 * reason recorded. Brought under the new rule — documentation landed or a
 * reason recorded — each must still sign, proving the refusal was added
 * without weakening it to let the suite's own fixtures slide through.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut } from "../gates/sign";
import { emptySpace } from "./schema";
import type { Space, Change } from "./schema";

function spaceWith(nodes: Change[]): Space {
  return { ...emptySpace(), nodes };
}

test("the proof-anchor drift scenario's cut signs under the documentation refusal", () => {
  const space = spaceWith([
    {
      id: "n1",
      sentence: "greet the user",
      serves: [],
      needs: [],
      acceptance: [{ id: "c1", text: "greet() returns hello" }],
      grounding: { touchpoints: [{ path: "src/greet.ts", planned: true }], stamp: [] },
    },
  ]);
  const r = signCut(
    space,
    { id: "cut-1", changeIds: ["n1"], docsNotNeeded: "a fixture proving proof anchors survive re-runs; nothing user-facing to document" },
    "2026-08-22T00:00:00Z",
    "t",
  );
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
});

test("the repository-moved scenario's cut signs under the documentation refusal", () => {
  const space = spaceWith([
    {
      id: "n1",
      sentence: "greet the user",
      serves: [],
      needs: [],
      acceptance: [{ id: "c1", text: "greet() returns hello" }],
      grounding: {
        touchpoints: [{ path: "src/greet.ts", planned: true, evidence: "read at aaa" }],
        stamp: [{ root: "/repo", head: "aaa", dirty: "" }],
      },
    },
  ]);
  const r = signCut(
    space,
    { id: "cut-1", changeIds: ["n1"], docsNotNeeded: "a fixture proving signatures survive the repository moving; nothing user-facing to document" },
    "2026-08-22T00:00:00Z",
    "t",
  );
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
});

test("the observation-only scenario's cut signs under the documentation refusal", () => {
  const space = spaceWith([
    {
      id: "n1",
      sentence: "say plainly what the machine cannot see about the tabs",
      serves: [],
      needs: [],
      acceptance: [],
      unverified: [{ text: "the tab strip shows two tabs", why: "only the running product can show it" }],
      grounding: { touchpoints: [{ path: "src/x.ts", planned: false }], stamp: [] },
    },
  ]);
  const r = signCut(
    space,
    { id: "cut-1", changeIds: ["n1"], docsNotNeeded: "a fixture proving an observation-only promise still signs; nothing user-facing to document" },
    "2026-08-23T00:00:00Z",
    "t",
  );
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
});
