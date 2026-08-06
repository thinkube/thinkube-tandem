/**
 * The two gates: renders inside the size budget, signatures binding the
 * render+grounding pair with drift told apart, acceptance refused without
 * green evidence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace, Space } from "../core/schema";
import { addAsk, addNode } from "../core/intent";
import { RENDER_LINE_BUDGET, renderCutScreen, renderDeliveryPage } from "./render";
import { acceptDelivery, signCut, verifyCutSignature } from "./sign";

function makeSpace(): { space: Space; changeIds: string[] } {
  let s = emptySpace();
  const a = addAsk(s, "make the log panel follow the running step", "t");
  assert.ok(a.ok);
  s = a.space;
  const ids: string[] = [];
  const specs = [
    { sentence: "the log panel scrolls with the active step", tp: "src/panel/log.ts", acceptance: [{ id: "c1", text: "scrolls on advance" }] },
    { sentence: "a follow toggle in the panel header", tp: "src/panel/header.ts", acceptance: [{ id: "c2", text: "toggle visible and sticky" }] },
    { sentence: "a change with nothing proving it yet", tp: "src/panel/other.ts", acceptance: [] },
  ];
  for (const sp of specs) {
    const r = addNode(s, {
      sentence: sp.sentence,
      serves: [a.added.id],
      needs: [],
      acceptance: sp.acceptance,
      grounding: { touchpoints: [{ path: sp.tp }], stamp: [] },
    });
    assert.ok(r.ok);
    s = r.space;
    ids.push(r.added.id);
  }
  return { space: s, changeIds: ids };
}

test("the cut screen fits the budget and surfaces what is not provable", () => {
  const { space, changeIds } = makeSpace();
  const screen = renderCutScreen(space, { id: "cut-1", changeIds });
  assert.ok(screen.split("\n").length <= RENDER_LINE_BUDGET, "decision-sized");
  assert.ok(screen.includes("3 promise(s)"));
  assert.ok(screen.includes("Nothing proves these yet:"));
  assert.ok(screen.includes("a change with nothing proving it yet"));
});

test("signing binds the pair; each half's drift is told apart", () => {
  const { space, changeIds: all } = makeSpace();
  const changeIds = all.slice(0, 2); // the third is unprovable — refused below
  const signed = signCut(space, { id: "cut-1", changeIds }, "t1");
  assert.ok(signed.ok);
  assert.equal(verifyCutSignature(space, signed.cut).ok, true);

  const groundMoved: Space = {
    ...space,
    nodes: space.nodes.map((n) =>
      n.id === changeIds[0]
        ? { ...n, grounding: { touchpoints: [{ path: "src/panel/moved.ts" }], stamp: [] } }
        : n,
    ),
  };
  const v = verifyCutSignature(groundMoved, signed.cut);
  assert.ok(!v.ok && v.drift === "grounding", "grounding drift named as such");

  assert.equal(signCut(space, signed.cut, "t2").ok, false, "no double signing");
  assert.equal(signCut(space, { id: "cut-2", changeIds: [] }, "t").ok, false, "empty cut refused");
});

test("acceptance is refused without green evidence, and records the moment", () => {
  const base = { id: "d-1", cutId: "cut-1", branch: "tandem/cut-1", proofs: [] };
  assert.equal(acceptDelivery(base, "t").ok, false, "no proof, no acceptance");

  const pending = { ...base, proofs: [{ kind: "suite" as const, label: "suite", verdict: "pending" as const }] };
  const p = acceptDelivery(pending, "t");
  assert.ok(!p.ok && p.reason.includes("suite (pending)"));

  const green = { ...base, proofs: [
    { kind: "suite" as const, label: "suite", verdict: "green" as const },
    { kind: "ci" as const, label: "image build", verdict: "green" as const },
  ] };
  const accepted = acceptDelivery(green, "2026-08-05T18:00:00Z");
  assert.ok(accepted.ok);
  assert.equal(accepted.delivery.acceptedAt, "2026-08-05T18:00:00Z");
  assert.equal(acceptDelivery(accepted.delivery, "t2").ok, false, "no double acceptance");
});

test("the delivery page speaks in the asks' words with proof and gestures beside", () => {
  const { space, changeIds } = makeSpace();
  const s2: Space = { ...space, cuts: [{ id: "cut-1", changeIds }] };
  const page = renderDeliveryPage(
    s2,
    { id: "d-1", cutId: "cut-1", branch: "tandem/cut-1", proofs: [{ kind: "suite", label: "suite", verdict: "green" }] },
    new Map([["the follow toggle", "open the panel and press Follow"]]),
  );
  assert.ok(page.includes("You asked: make the log panel follow the running step"));
  assert.ok(page.includes("✓ the log panel scrolls with the active step"));
  assert.ok(page.includes("check: suite — green"));
  assert.ok(page.includes("see it: the follow toggle — open the panel and press Follow"));
  assert.ok(page.split("\n").length <= RENDER_LINE_BUDGET);
});

test("what did NOT arrive is on the delivery page's face", () => {
  const { space, changeIds } = makeSpace();
  const s2: Space = { ...space, cuts: [{ id: "cut-1", changeIds }] };
  const page = renderDeliveryPage(s2, {
    id: "d-1",
    cutId: "cut-1",
    branch: "tandem/cut-1",
    proofs: [{ kind: "suite", label: "suite", verdict: "green" }],
    undelivered: ["SL-1: docs obligation unmet: declared doc-module path(s) not present in the landed tree: docs/guide.md. The documentation must land with the slice before it can reach Done."],
  });
  assert.ok(page.includes("⚠ undelivered:"), "the gap is visible on the page");
  assert.ok(page.includes("docs obligation unmet"), "the docs gate speaks on the page");
});

test("the freeze refusals: unprovable, ungrounded, and open questions refuse the sign", () => {
  const { space, changeIds } = makeSpace();
  const unprovable = signCut(space, { id: "c", changeIds }, "t");
  assert.ok(!unprovable.ok && unprovable.reason.includes("no check yet"), "no check, no signature");

  const ungroundedSpace: Space = {
    ...space,
    nodes: space.nodes.map((n) =>
      n.id === changeIds[0] ? { ...n, grounding: undefined } : n,
    ),
  };
  const ungrounded = signCut(ungroundedSpace, { id: "c", changeIds: changeIds.slice(0, 2) }, "t");
  assert.ok(!ungrounded.ok && ungrounded.reason.includes("not placed these promises"));

  const asked: Space = {
    ...space,
    questions: [
      { id: "q-1", askId: space.asks[0].id, text: "which panel?", recommendation: "the log panel" },
    ],
  };
  const open = signCut(asked, { id: "c", changeIds: changeIds.slice(0, 2) }, "t");
  assert.ok(!open.ok && open.reason.includes("which panel?"), "the refusal names the question");
});

test("the docs gate blocks an accept by default; advisory is the explicit escape hatch", () => {
  const d = {
    id: "d-1",
    cutId: "cut-1",
    branch: "tandem/cut-1",
    proofs: [{ kind: "suite" as const, label: "suite", verdict: "green" as const }],
    undelivered: ["SL-1: docs obligation unmet: declared doc-module path(s) not present in the landed tree: docs/x.md. The documentation must land with the slice before it can reach Done."],
  };
  const blocked = acceptDelivery(d, "t");
  assert.ok(!blocked.ok && blocked.reason.includes("docs gate"), "blocking by default");
  assert.ok(acceptDelivery(d, "t", "advisory").ok, "advisory lets it through, on the record");
});
