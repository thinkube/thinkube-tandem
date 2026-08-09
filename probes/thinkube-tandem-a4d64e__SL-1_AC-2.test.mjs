// SL-1 AC-2 — the delivery page's walkthrough lines sit directly under the
// claim/ask they prove, all before the proofs block, and are never also
// dumped as a second batch keyed by promise id underneath the proofs.
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace } from "../out-test/core/schema.js";
import { RENDER_LINE_BUDGET, renderDeliveryPage } from "../out-test/gates/render.js";

// A space with a subject/claim pair (the shape renderDeliveryPage groups
// promises under) plus a loose, ask-served promise with no claim, so both
// walkthrough call sites in the page (claim-scoped and ask-scoped) are
// exercised.
function makeSpace() {
  return {
    ...emptySpace(),
    asks: [{ id: "ask-1", text: "make the log panel follow the running step", at: "t" }],
    subjects: [{ id: "sub-1", name: "the log panel", from: ["ask-1"] }],
    claims: [
      { id: "c1", subjectId: "sub-1", text: "the panel scrolls with the active step", fromAsk: "ask-1" },
    ],
    nodes: [
      {
        id: "n1",
        sentence: "the log panel scrolls with the active step",
        serves: ["sub-1"],
        needs: [],
        servesClaim: "c1",
        acceptance: [],
      },
      {
        id: "n2",
        sentence: "a follow toggle in the panel header",
        serves: ["ask-1"],
        needs: [],
        acceptance: [],
      },
    ],
    cuts: [{ id: "cut-1", changeIds: ["n1", "n2"] }],
  };
}

function baseDelivery(extra = {}) {
  return {
    id: "d-1",
    cutId: "cut-1",
    branch: "tandem/cut-1",
    proofs: [
      { kind: "suite", label: "scrolls on advance", verdict: "green" },
      { kind: "suite", label: "toggle visible and sticky", verdict: "green" },
    ],
    ...extra,
  };
}

// TRANSITION — pins that every "see it:" line now precedes the first
// "check:" line on the page; this proves the walkthrough moved above the
// proofs block instead of trailing after it.
test("every see-it line renders before the first check line", () => {
  const space = makeSpace();
  const experience = new Map([
    ["n1", "open the panel and watch it scroll"],
    ["n2", "open the panel and press Follow"],
  ]);
  const page = renderDeliveryPage(space, baseDelivery(), experience);
  const lines = page.split("\n");

  const seeItIndexes = lines
    .map((l, i) => (l.includes("see it:") ? i : -1))
    .filter((i) => i >= 0);
  const firstCheckIndex = lines.findIndex((l) => l.includes("check:"));

  assert.ok(seeItIndexes.length >= 2, "at least the two walkthrough lines are present");
  assert.ok(firstCheckIndex >= 0, "a check line is present");
  for (const i of seeItIndexes) {
    assert.ok(
      i < firstCheckIndex,
      `see-it line at ${i} ("${lines[i]}") must come before the first check line at ${firstCheckIndex}`,
    );
  }
});

// TRANSITION — pins that the old trailing dump (a second batch of see-it
// lines, keyed by promise id, printed after the proofs) is gone: each
// promise's line appears exactly once on the whole page.
test("no see-it line appears after the proofs block, and none repeats", () => {
  const space = makeSpace();
  const experience = new Map([
    ["n1", "open the panel and watch it scroll"],
    ["n2", "open the panel and press Follow"],
  ]);
  const page = renderDeliveryPage(space, baseDelivery(), experience);
  const lines = page.split("\n");

  const lastCheckIndex = lines.reduce(
    (last, l, i) => (l.includes("check:") ? i : last),
    -1,
  );
  assert.ok(lastCheckIndex >= 0, "a check line is present");

  const seeItAfterProofs = lines
    .slice(lastCheckIndex + 1)
    .filter((l) => l.includes("see it:"));
  assert.deepEqual(seeItAfterProofs, [], "no see-it line trails after the proofs block");

  // Each experienced promise's gesture text appears exactly once anywhere
  // on the page — a repeated trailing dump would double this count.
  for (const gesture of experience.values()) {
    const occurrences = lines.filter((l) => l.includes(gesture)).length;
    assert.equal(occurrences, 1, `"${gesture}" must appear exactly once, not repeated in a trailing dump`);
  }
});

// INVARIANT — each see-it line must sit under the claim (or ask sentence)
// of the promise it belongs to, not in a separate list keyed by id; this
// must hold every time the page is rendered, not just once at migration.
test("each see-it line sits directly under the claim or ask sentence it belongs to", () => {
  const space = makeSpace();
  const experience = new Map([
    ["n1", "open the panel and watch it scroll"],
    ["n2", "open the panel and press Follow"],
  ]);
  const page = renderDeliveryPage(space, baseDelivery(), experience);
  const lines = page.split("\n");

  // n1 serves claim c1 ("the panel scrolls with the active step") — its
  // see-it line must be the line immediately after that claim's line (or
  // within the same claim's block), not detached elsewhere.
  const claimLineIndex = lines.findIndex((l) => l.includes("the panel scrolls with the active step"));
  assert.ok(claimLineIndex >= 0, "the claim line is rendered");
  const seeItForN1Index = lines.findIndex((l) => l.includes("open the panel and watch it scroll"));
  assert.equal(
    seeItForN1Index,
    claimLineIndex + 1,
    "n1's see-it line is the line immediately under its claim line, not detached elsewhere",
  );

  // n2 serves the ask directly (no claim) — its see-it line must follow
  // the "You asked:" sentence for ask-1, not the claim's block.
  const askLineIndex = lines.findIndex((l) => l.includes("You asked: make the log panel follow the running step"));
  assert.ok(askLineIndex >= 0, "the ask sentence is rendered for the loose promise");
  const seeItForN2Index = lines.findIndex((l) => l.includes("open the panel and press Follow"));
  assert.ok(seeItForN2Index > askLineIndex, "n2's see-it line comes after its ask sentence");
});

// INVARIANT — the render line budget must still be respected once
// walkthrough lines are included; a page that grows past the budget stops
// being a one-decision page.
test("a delivery page carrying walkthrough lines still fits the render line budget", () => {
  const space = makeSpace();
  const experience = new Map([
    ["n1", "open the panel and watch it scroll"],
    ["n2", "open the panel and press Follow"],
  ]);
  const page = renderDeliveryPage(space, baseDelivery(), experience);
  assert.ok(
    page.split("\n").length <= RENDER_LINE_BUDGET,
    "the walkthrough must not push the page past its decision-sized budget",
  );
});

// TRANSITION — with no experience recorded at all (the degenerate case of
// removing the trailing dump), the page must render with no see-it lines
// whatsoever rather than falling back to the old dump.
test("with no experience map, the page carries no see-it lines and no dump", () => {
  const space = makeSpace();
  const page = renderDeliveryPage(space, baseDelivery());
  assert.ok(!page.includes("see it:"), "no walkthrough line is invented when nothing was experienced");
});
