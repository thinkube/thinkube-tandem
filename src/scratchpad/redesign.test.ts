/**
 * Tests for the 2026-07-16 redesign: rough-request journal, curated intent,
 * cuts (elements ship, context flags), and TEP-protection (flagged/shipped =
 * immutable, supersede-only). Run via the repo recipe (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce, isProtected } from "./model";
import type { Action, WorkingModel } from "./model";
import { projectCut } from "./projection";

/** Build a space: 2 elements, 1 constraint linked to element A, 1 criterion
 *  linked to the constraint (transitive), 1 unrelated constraint. */
function cutScenario(): {
  model: WorkingModel;
  elA: string;
  elB: string;
  conLinked: string;
  criTransitive: string;
  conUnrelated: string;
} {
  let m = emptyModel("tep");
  m = reduce(m, { type: "seedGoal", text: "the space's goal" }).model;
  const sec = (kind: string): string =>
    m.sections.find((s) => s.kind === kind)!.id;
  const propose = (
    sectionId: string,
    text: string,
    requires?: string[],
  ): string => {
    const a: Action = {
      type: "proposeItem",
      actor: "gap-filler",
      sectionId,
      item: { text, modality: "optional", evals: {}, requires },
    };
    m = reduce(m, a).model;
    const items = m.sections.find((s) => s.id === sectionId)!.items;
    return items[items.length - 1].id;
  };
  const elA = propose(sec("elements"), "element A");
  const elB = propose(sec("elements"), "element B");
  const conLinked = propose(sec("constraints"), "constraint on A", [elA]);
  const criTransitive = propose(sec("criteria"), "criterion via constraint", [
    conLinked,
  ]);
  const conUnrelated = propose(sec("constraints"), "unrelated constraint");
  // Settle everything.
  for (const id of [elA, elB, conLinked, criTransitive, conUnrelated]) {
    m = reduce(m, { type: "checkItem", actor: "human", itemId: id }).model;
  }
  return { model: m, elA, elB, conLinked, criTransitive, conUnrelated };
}

test("projectCut: selected elements ship; edge-connected context is pulled transitively; other elements and unrelated context stay out", () => {
  const { model, elA, elB, conLinked, criTransitive, conUnrelated } =
    cutScenario();
  const proj = projectCut(model, { elementIds: [elA] });
  assert.deepEqual(proj.shipIds, [elA]);
  assert.deepEqual(new Set(proj.flagIds), new Set([conLinked, criTransitive]));
  assert.ok(!proj.flagIds.includes(conUnrelated));
  assert.ok(!proj.shipIds.includes(elB));
  assert.ok(proj.body.includes("element A"));
  assert.ok(!proj.body.includes("element B"));
  assert.ok(proj.body.includes("constraint on A"));
});

test("projectCut: unsettled selected elements are reported (freeze must refuse)", () => {
  const { model, elA } = cutScenario();
  const unchecked = reduce(model, {
    type: "uncheckItem",
    actor: "human",
    itemId: elA,
  }).model;
  const proj = projectCut(unchecked, { elementIds: [elA] });
  assert.deepEqual(proj.uncheckedElements, [elA]);
  assert.deepEqual(proj.shipIds, []);
});

test("stampShipped with flagIds: elements ship, context flags and STAYS active", () => {
  const { model, elA, conLinked } = cutScenario();
  const { model: after } = reduce(model, {
    type: "stampShipped",
    itemIds: [elA],
    flagIds: [conLinked],
    tepId: "TEP-99",
  });
  const byId = new Map(
    after.sections.flatMap((s) => s.items.map((it) => [it.id, it] as const)),
  );
  assert.equal(byId.get(elA)!.state, "shipped");
  assert.equal(byId.get(elA)!.shippedIn, "TEP-99");
  assert.equal(byId.get(conLinked)!.state, "active");
  assert.deepEqual(byId.get(conLinked)!.flaggedBy, ["TEP-99"]);
  // Second cut flags again — the list accumulates, no duplicates.
  const { model: again } = reduce(after, {
    type: "stampShipped",
    itemIds: [],
    flagIds: [conLinked],
    tepId: "TEP-100",
  });
  const con = again.sections
    .flatMap((s) => s.items)
    .find((it) => it.id === conLinked)!;
  assert.deepEqual(con.flaggedBy, ["TEP-99", "TEP-100"]);
});

test("TEP-protection: flagged items reject edits, reclassification, and drop — supersede stays open; checking stays open", () => {
  const { model, conLinked } = cutScenario();
  const { model: flagged } = reduce(model, {
    type: "stampShipped",
    itemIds: [],
    flagIds: [conLinked],
    tepId: "TEP-99",
  });
  const item = flagged.sections
    .flatMap((s) => s.items)
    .find((it) => it.id === conLinked)!;
  assert.ok(isProtected(item));

  const rejects: Action[] = [
    { type: "editItemText", actor: "human", itemId: conLinked, text: "rewrite" },
    { type: "setModality", actor: "human", itemId: conLinked, modality: "mandatory" },
    { type: "setEval", actor: "human", itemId: conLinked, facet: "risk", value: 3 },
    { type: "dropItem", actor: "human", itemId: conLinked },
    {
      type: "proposeEdit",
      actor: "integrator",
      itemId: conLinked,
      newText: "worker rewrite",
    },
  ];
  for (const a of rejects) {
    const { delta } = reduce(flagged, a);
    assert.equal(delta.kind, "rejected", `${a.type} must be rejected`);
    assert.match(
      (delta as { reason: string }).reason,
      /TEP-protected/,
      `${a.type} rejection names the protection`,
    );
  }

  // Un/checking stays allowed (settling for a FUTURE cut).
  const { delta: uncheck } = reduce(flagged, {
    type: "uncheckItem",
    actor: "human",
    itemId: conLinked,
  });
  assert.equal(uncheck.kind, "applied");
  // Supersede stays allowed: a new item may supersede the protected one.
  const constraints = flagged.sections.find((s) => s.kind === "constraints")!;
  const { model: withNew } = reduce(flagged, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: constraints.id,
    item: { text: "refined constraint", modality: "optional", evals: {} },
  });
  const newId = withNew.sections
    .find((s) => s.kind === "constraints")!
    .items.find((it) => it.text === "refined constraint")!.id;
  const { delta: sup } = reduce(withNew, {
    type: "supersedeItem",
    actor: "human",
    itemId: newId,
    supersedes: conLinked,
  });
  assert.equal(sup.kind, "applied");
});

test("rough requests: append-only journal; empty refused; entries never mutate the goal", () => {
  let m = emptyModel("tep");
  m = reduce(m, { type: "seedGoal", text: "original goal" }).model;
  const { model: m1, delta: d1 } = reduce(m, {
    type: "addRoughRequest",
    text: "also handle X",
  });
  assert.equal(d1.kind, "applied");
  const { model: m2 } = reduce(m1, {
    type: "addRoughRequest",
    text: "and Y as well",
  });
  assert.deepEqual(
    m2.roughRequests!.map((r) => r.text),
    ["also handle X", "and Y as well"],
  );
  assert.equal(
    m2.sections.find((s) => s.kind === "goal")!.text,
    "original goal",
  );
  const { delta: empty } = reduce(m2, { type: "addRoughRequest", text: "  " });
  assert.equal(empty.kind, "rejected");
});

test("curated intent: set by curateIntent; empty-over-nonempty refused; freeze title prefers it", () => {
  const { model } = cutScenario();
  const { model: curated, delta } = reduce(model, {
    type: "curateIntent",
    text: "Deliver element A under its constraint",
  });
  assert.equal(delta.kind, "applied");
  assert.equal(curated.curatedIntent, "Deliver element A under its constraint");

  const { delta: erased } = reduce(curated, { type: "curateIntent", text: "" });
  assert.equal(erased.kind, "rejected");

  const proj = projectCut(curated, {
    elementIds: [
      curated.sections.find((s) => s.kind === "elements")!.items[0].id,
    ],
  });
  assert.equal(proj.title, "Deliver element A under its constraint");
});

test("gap closure (2026-07-17): resolveItem closes a question; coverage rewards attended gaps", () => {
  let m = emptyModel("tep");
  m = reduce(m, { type: "seedGoal", text: "goal" }).model;
  const gapSec = m.sections.find((s) => s.kind === "gap")!;
  m = reduce(m, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: gapSec.id,
    item: { text: "an open question", modality: "optional", evals: {} },
  }).model;
  const qId = m.sections.find((s) => s.kind === "gap")!.items[0].id;

  // Unattended open question → gap uncovered.
  const { uncoveredSections } = require("./coverage") as {
    uncoveredSections: (mm: WorkingModel) => string[];
  };
  assert.ok(uncoveredSections(m).includes("gap"));

  // Resolving the answered question covers the gap section (no open items).
  m = reduce(m, { type: "resolveItem", actor: "human", itemId: qId }).model;
  const item = m.sections.find((s) => s.kind === "gap")!.items[0];
  assert.equal(item.state, "resolved");
  assert.ok(!uncoveredSections(m).includes("gap"));

  // Resolved items never enter a projection.
  m = reduce(m, { type: "checkItem", actor: "human", itemId: qId }).model;
  const { projectDelta } = require("./projection") as {
    projectDelta: (mm: WorkingModel) => { itemIds: string[] };
  };
  assert.ok(!projectDelta(m).itemIds.includes(qId));
});

test("curated title (2026-07-17): stored ≤80, used by projections; long first lines clip", () => {
  let m = emptyModel("tep");
  m = reduce(m, { type: "seedGoal", text: "g" }).model;
  m = reduce(m, {
    type: "curateIntent",
    text: "A long intent statement that describes everything the space wants to deliver in detail across many words.",
    title: "Orchestration graph: auditors, gate, and live logs",
  }).model;
  assert.equal(
    m.curatedTitle,
    "Orchestration graph: auditors, gate, and live logs",
  );
  const { projectDelta } = require("./projection") as {
    projectDelta: (mm: WorkingModel) => { title: string };
  };
  assert.equal(
    projectDelta(m).title,
    "Orchestration graph: auditors, gate, and live logs",
  );

  // Without a title: first line clipped to 80.
  m = reduce(m, {
    type: "curateIntent",
    text: "x".repeat(200),
  }).model;
  assert.equal(m.curatedTitle, undefined);
  const t = projectDelta(m).title;
  assert.ok(t.length <= 80, `title too long: ${t.length}`);
});

test("three-dimension gate (2026-07-17): convergence, complexity, risk — evaluated AND mitigated", () => {
  const { cutReadiness } = require("./projection") as {
    cutReadiness: (
      m: WorkingModel,
      ids: readonly string[],
    ) => {
      pass: boolean;
      openGaps: string[];
      elements: { blockers: string[]; complexity: string; risk: string }[];
    };
  };
  let m = emptyModel("tep");
  m = reduce(m, { type: "seedGoal", text: "goal" }).model;
  const sec = (kind: string): string =>
    m.sections.find((s) => s.kind === kind)!.id;
  const propose = (
    sectionId: string,
    text: string,
    extra?: Partial<{
      requires: string[];
      evals: { complexity?: 1 | 2 | 3; risk?: 1 | 2 | 3 };
    }>,
  ): string => {
    m = reduce(m, {
      type: "proposeItem",
      actor: "gap-filler",
      sectionId,
      item: {
        text,
        modality: "optional",
        evals: extra?.evals ?? {},
        requires: extra?.requires,
      },
    }).model;
    const items = m.sections.find((s) => s.id === sectionId)!.items;
    return items[items.length - 1].id;
  };
  const check = (id: string): void => {
    m = reduce(m, { type: "checkItem", actor: "human", itemId: id }).model;
  };

  // A bare element: checked but unlinked, unevaluated → many blockers.
  const el = propose(sec("elements"), "the element", {
    evals: { complexity: 2 },
  });
  check(el);
  let gate = cutReadiness(m, [el]);
  assert.equal(gate.pass, false);
  const blockers = gate.elements[0].blockers.join(" | ");
  assert.match(blockers, /no settled criteria linked/);
  assert.match(blockers, /no settled verification linked/);
  assert.match(blockers, /risk never evaluated/);

  // Converge it: linked settled criteria + verification; evaluate risk 3.
  const cri = propose(sec("criteria"), "measurable outcome", {
    requires: [el],
  });
  check(cri);
  const ver = propose(sec("verification"), "how it is checked", {
    requires: [el],
  });
  check(ver);
  m = reduce(m, {
    type: "setEval",
    actor: "human",
    itemId: el,
    facet: "risk",
    value: 3,
  }).model;
  gate = cutReadiness(m, [el]);
  assert.equal(gate.pass, false);
  assert.match(gate.elements[0].blockers.join(" "), /risk 3 unmitigated/);

  // Mitigate by SIGNED acceptance (empty reason refused first).
  const { delta: refused } = reduce(m, {
    type: "acceptEval",
    actor: "human",
    itemId: el,
    facet: "risk",
    reason: "   ",
  });
  assert.equal(refused.kind, "rejected");
  m = reduce(m, {
    type: "acceptEval",
    actor: "human",
    itemId: el,
    facet: "risk",
    reason: "single-tenant tool; worst case is a re-run",
  }).model;
  gate = cutReadiness(m, [el]);
  assert.equal(gate.pass, true, gate.elements[0].blockers.join(" | "));

  // An OPEN question linked into the closure blocks the whole cut.
  const q = propose(sec("gap"), "unanswered question", { requires: [el] });
  check(q);
  gate = cutReadiness(m, [el]);
  assert.equal(gate.pass, false);
  assert.equal(gate.openGaps.length, 1);
  m = reduce(m, { type: "resolveItem", actor: "human", itemId: q }).model;
  gate = cutReadiness(m, [el]);
  assert.equal(gate.pass, true);

  // The signed residual prints into the projection body.
  const { projectCut } = require("./projection") as {
    projectCut: (
      mm: WorkingModel,
      c: { elementIds: readonly string[] },
    ) => { body: string };
  };
  const body = projectCut(m, { elementIds: [el] }).body;
  assert.match(body, /## Accepted Residuals/);
  assert.match(body, /Residual risk accepted — "the element": single-tenant tool/);
});

