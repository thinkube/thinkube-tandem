/**
 * The two gates: renders inside the size budget, signatures binding the
 * render+grounding pair with drift told apart, acceptance refused without
 * green evidence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace, Space } from "../core/schema";
import { addAsk, addNode } from "../core/intent";
import { RENDER_LINE_BUDGET, renderCutScreen, renderDeliveryPage, renderWeight } from "./render";
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
    {
      id: "d-1",
      cutId: "cut-1",
      branch: "tandem/cut-1",
      // A tick is earned by a green check naming what it proved — the
      // page never grants one for being in the cut.
      proofs: [
        { kind: "probe", label: "scrolls on advance", verdict: "green" },
        { kind: "probe", label: "toggle visible and sticky", verdict: "green" },
        { kind: "suite", label: "suite", verdict: "green" },
      ],
    },
    // Keyed by the promise it belongs to — the way in is shown beside the
    // work it lets you see, not in a list of its own at the foot.
    new Map([[changeIds[1], "the panel header — press Follow"]]),
  );
  assert.ok(page.includes("You asked: make the log panel follow the running step"));
  assert.ok(page.includes("- ✓ the log panel scrolls with the active step"));
  assert.ok(
    page.includes("- ✗ a change with nothing proving it yet"),
    "a promise with no check is never ticked",
  );
  assert.ok(page.includes("## Checks"), "the checks have a section of their own");
  assert.ok(page.includes("- ✓ suite — green"));
  assert.ok(page.includes("- see it: the panel header — press Follow"));
  assert.ok(page.startsWith("# Delivery — `tandem/cut-1`"), "the page names what it is");
  assert.ok(
    renderWeight(page) <= RENDER_LINE_BUDGET,
    `a decision, not homework: ${renderWeight(page)} lines`,
  );
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
  assert.ok(page.includes("## Not delivered"), "the gap has a section of its own");
  assert.ok(page.includes("- ⚠ SL-1:"), "and the gap is on the page");
  assert.ok(page.includes("docs obligation unmet"), "the docs gate speaks on the page");
});

test("what the machine could not verify is on the delivery page, with the reason, apart from the checks", () => {
  const { space, changeIds } = makeSpace();
  const withNote: Space = {
    ...space,
    nodes: space.nodes.map((n) =>
      n.id === changeIds[0]
        ? { ...n, unverified: [{ text: "the cluster shuts down when pressed", why: "acts on the cluster this runs in" }] }
        : n,
    ),
    cuts: [{ id: "cut-1", changeIds }],
  };
  const page = renderDeliveryPage(withNote, {
    id: "d-1",
    cutId: "cut-1",
    branch: "tandem/cut-1",
    proofs: [{ kind: "suite", label: "suite", verdict: "green" }],
  });
  assert.ok(page.includes("## Not verified by the machine"), "its own section, not a red mark");
  assert.ok(page.includes("○ the cluster shuts down when pressed — acts on the cluster this runs in"));
  assert.ok(!/✗.*cluster shuts down/.test(page), "the note is never shown as a failed check");
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

test("the delivery page counts truth in claims, and never calls a half-built one done", () => {
  const space: Space = {
    ...emptySpace(),
    asks: [{ id: "ask-1", text: "the delivery page shows how to see it", at: "t" }],
    subjects: [{ id: "sub-1", name: "the delivery page", from: ["ask-1"] }],
    claims: [
      { id: "c1", subjectId: "sub-1", text: "shows a see-it line per promise", fromAsk: "ask-1" },
      { id: "c2", subjectId: "sub-1", text: "names the check in my words", fromAsk: "ask-1" },
      { id: "c3", subjectId: "sub-1", text: "stays inside its line budget", fromAsk: "ask-1" },
    ],
    nodes: [
      { id: "n1", sentence: "walkthrough from verified doors", serves: ["sub-1"], needs: [], servesClaim: "c1", acceptance: [{ id: "a1", text: "the walkthrough renders" }] },
      { id: "n2", sentence: "labels carry the check's own words", serves: ["sub-1"], needs: [], servesClaim: "c2", acceptance: [{ id: "a2", text: "labels read as written" }] },
      { id: "n3", sentence: "the page truncates long labels", serves: ["sub-1"], needs: [], servesClaim: "c2", acceptance: [{ id: "a3", text: "long labels fit" }] },
    ],
    cuts: [{ id: "cut-1", changeIds: ["n1", "n2"] }],
  };
  const page = renderDeliveryPage(
    space,
    {
      id: "d1",
      cutId: "cut-1",
      branch: "tandem/x",
      // n1's own check came back green; n2's did not run at all.
      proofs: [{ kind: "probe", label: "the walkthrough renders", verdict: "green" }],
    },
    new Map([["n1", "the delivery page — read the walkthrough"]]),
  );

  assert.ok(page.includes("### the delivery page — 1 of 3 now true"), page);
  assert.ok(page.includes("- ✓ shows a see-it line per promise"), "proved, so it is true");
  assert.ok(
    page.includes("- ✗ names the check in my words — **NOT true yet** (1 of 2 parts in this delivery)"),
    "a claim with a part missing is NOT counted as delivered",
  );
  assert.ok(!page.includes("stays inside its line budget"), "a claim nothing touched is not listed");
  assert.ok(page.includes("- see it: the delivery page — read the walkthrough"), "beside its claim");
});

test("a delivery whose checks are red cannot be accepted, and the page says why", () => {
  // The run that produced this failed on every unit: 86 red proofs and
  // twelve workers that never delivered. The gate refuses it — what the
  // surface must never do is offer the press anyway.
  const red = {
    id: "d-1",
    cutId: "cut-1",
    branch: "tandem/TEP-5",
    proofs: [
      { kind: "probe" as const, label: "the report reads as sections", verdict: "red" as const },
      { kind: "suite" as const, label: "suite", verdict: "green" as const },
    ],
    undelivered: ["SL-2#eu-1: worker errored"],
  };
  const r = acceptDelivery(red, "t");
  assert.equal(r.ok, false);
  assert.match(r.reason!, /proof outstanding/);
  assert.match(r.reason!, /the report reads as sections/, "and names the check that is not green");
});

test("a delivery with no proof at all cannot be accepted either", () => {
  const bare = { id: "d-2", cutId: "cut-1", branch: "b", proofs: [] };
  const r = acceptDelivery(bare, "t");
  assert.equal(r.ok, false);
  assert.match(r.reason!, /no proof/);
});
