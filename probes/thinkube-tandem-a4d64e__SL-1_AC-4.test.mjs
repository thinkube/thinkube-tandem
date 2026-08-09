// Proves SL-1 AC-4: the delivery page's "see it" lines sit directly under
// the claim each belongs to, all of them above the first proof line, and
// never repeated as a batch underneath the proofs.
import { test } from "node:test";
import assert from "node:assert/strict";

import { RENDER_LINE_BUDGET, renderDeliveryPage } from "../out/gates/render.js";

// Builds a space with one subject, two claims (each with a built promise)
// and a signed cut, so renderDeliveryPage has claims to hang see-it lines
// under and proofs to render beneath the walkthrough.
function makeDeliverySpace() {
  return {
    asks: [{ id: "ask-1", text: "make the delivery page trustworthy", at: "t" }],
    nodes: [
      {
        id: "n1",
        sentence: "the follow toggle sticks the panel",
        serves: ["sub-1"],
        needs: [],
        servesClaim: "c1",
        acceptance: [],
      },
      {
        id: "n2",
        sentence: "the log panel scrolls with the active step",
        serves: ["sub-1"],
        needs: [],
        servesClaim: "c2",
        acceptance: [],
      },
    ],
    units: [],
    cuts: [{ id: "cut-1", changeIds: ["n1", "n2"] }],
    deliveries: [],
    questions: [],
    pins: [],
    subjects: [{ id: "sub-1", name: "the log panel", from: ["ask-1"] }],
    claims: [
      { id: "c1", subjectId: "sub-1", text: "a follow toggle in the panel header", fromAsk: "ask-1" },
      { id: "c2", subjectId: "sub-1", text: "the panel follows the running step", fromAsk: "ask-1" },
    ],
  };
}

function makeDelivery() {
  return {
    id: "d-1",
    cutId: "cut-1",
    branch: "tandem/cut-1",
    proofs: [
      { kind: "suite", label: "scrolls on advance", verdict: "green" },
      { kind: "suite", label: "toggle visible and sticky", verdict: "green" },
    ],
  };
}

// TRANSITION: proves the trailing batch of "see it:" lines keyed by promise
// id — rendered after the proofs block in the pre-AC-4 page — is gone.
test("no see-it line appears after the proofs block", () => {
  const space = makeDeliverySpace();
  const experience = new Map([
    ["n1", "the panel header — press Follow"],
    ["n2", "the log panel — advance a step"],
  ]);
  const page = renderDeliveryPage(space, makeDelivery(), experience);
  const lines = page.split("\n");

  const firstCheck = lines.findIndex((l) => l.trim().startsWith("check:"));
  assert.notEqual(firstCheck, -1, "the page carries at least one check line");
  const seeItAfterChecks = lines
    .slice(firstCheck)
    .some((l) => l.trim().startsWith("see it:"));
  assert.ok(!seeItAfterChecks, "no see-it line trails the proofs block");
});

// INVARIANT: every "see it:" line the page carries renders before the first
// "check:" line — the walkthrough always precedes the proofs.
test("every see-it line precedes the first check line", () => {
  const space = makeDeliverySpace();
  const experience = new Map([
    ["n1", "the panel header — press Follow"],
    ["n2", "the log panel — advance a step"],
  ]);
  const page = renderDeliveryPage(space, makeDelivery(), experience);
  const lines = page.split("\n");

  const seeItIndices = lines
    .map((l, i) => (l.trim().startsWith("see it:") ? i : -1))
    .filter((i) => i !== -1);
  const firstCheck = lines.findIndex((l) => l.trim().startsWith("check:"));

  assert.ok(seeItIndices.length >= 2, "the walkthrough produced its lines");
  assert.notEqual(firstCheck, -1);
  for (const i of seeItIndices)
    assert.ok(i < firstCheck, `see-it line at ${i} must precede the first check line at ${firstCheck}`);
});

// INVARIANT: each see-it line sits directly under the claim it belongs to —
// keyed by adjacency to that claim's own line, not gathered in a separate
// list elsewhere on the page.
test("each see-it line sits directly under the claim it makes true", () => {
  const space = makeDeliverySpace();
  const experience = new Map([
    ["n1", "the panel header — press Follow"],
    ["n2", "the log panel — advance a step"],
  ]);
  const page = renderDeliveryPage(space, makeDelivery(), experience);
  const lines = page.split("\n");

  const claim1 = lines.findIndex((l) => l.includes("a follow toggle in the panel header"));
  const claim2 = lines.findIndex((l) => l.includes("the panel follows the running step"));
  assert.notEqual(claim1, -1, "claim c1 is rendered");
  assert.notEqual(claim2, -1, "claim c2 is rendered");

  // The see-it line for the promise under c1 must appear before c2's claim
  // line (i.e. it sits within c1's own block, not batched after c2 or the
  // proofs), and must name that promise's own experience text.
  const seeIt1 = lines.findIndex(
    (l, i) => i > claim1 && l.trim().startsWith("see it:") && l.includes("press Follow"),
  );
  assert.notEqual(seeIt1, -1, "n1's see-it line is present");
  assert.ok(seeIt1 > claim1, "n1's see-it line sits after n1's claim line");
  assert.ok(seeIt1 < claim2, "n1's see-it line sits before the next claim's line, not batched later");

  const seeIt2 = lines.findIndex(
    (l, i) => i > claim2 && l.trim().startsWith("see it:") && l.includes("advance a step"),
  );
  assert.notEqual(seeIt2, -1, "n2's see-it line is present");
  assert.ok(seeIt2 > claim2, "n2's see-it line sits after n2's claim line");
});

// INVARIANT: a delivery page carrying walkthrough lines still fits inside
// the render's decision-sized line budget.
test("a delivery page carrying walkthrough lines still fits the render line budget", () => {
  const space = makeDeliverySpace();
  const experience = new Map([
    ["n1", "the panel header — press Follow"],
    ["n2", "the log panel — advance a step"],
  ]);
  const page = renderDeliveryPage(space, makeDelivery(), experience);
  assert.ok(
    page.split("\n").length <= RENDER_LINE_BUDGET,
    "the walkthrough must not push the page past its decision-sized budget",
  );
});
