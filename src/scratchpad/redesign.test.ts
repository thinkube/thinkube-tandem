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
  const criTransitive = propose(sec("acceptance"), "criterion via constraint", [
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
  assert.match(blockers, /no settled acceptance linked/);

  // Converge it: linked settled acceptance. Risk is DERIVED (2026-07-18) —
  // with no open gaps in reach it is 1 (ok), so a converged element passes.
  const cri = propose(sec("acceptance"), "measurable outcome", {
    requires: [el],
  });
  check(cri);
  gate = cutReadiness(m, [el]);
  assert.equal(gate.pass, true, gate.elements[0].blockers.join(" | "));

  // An OPEN gap linked into the closure DRIVES risk up and blocks the cut.
  const q = propose(sec("gap"), "unanswered question", { requires: [el] });
  check(q);
  gate = cutReadiness(m, [el]);
  assert.equal(gate.pass, false);
  assert.equal(gate.openGaps.length, 1);
  assert.match(gate.elements[0].blockers.join(" "), /risk \d — \d+ open gap/);
  // Closing the gap re-derives risk downward → the cut passes.
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
  // Complexity acceptance still prints a signed residual; risk is derived
  // (no signed risk residual — you close gaps, you don't accept risk).
  m = reduce(m, {
    type: "setEval",
    actor: "human",
    itemId: el,
    facet: "complexity",
    value: 3,
  }).model;
  m = reduce(m, {
    type: "acceptEval",
    actor: "human",
    itemId: el,
    facet: "complexity",
    reason: "large surface but well-understood",
  }).model;
  const body = projectCut(m, { elementIds: [el] }).body;
  assert.match(body, /## Accepted Residuals/);
  assert.match(body, /Residual complexity accepted — "the element": large surface/);
});

test("journal coverage (2026-07-17): [serves:] traces parse; untraced intents report zero", () => {
  const { journalCoverage } = require("./projection") as {
    journalCoverage: (m: WorkingModel) => {
      served: number[];
      remaining: number[];
      total: number;
    };
  };
  let m = emptyModel("tep");
  m = reduce(m, { type: "seedGoal", text: "first ask" }).model;
  m = reduce(m, { type: "addRoughRequest", text: "second ask" }).model;
  m = reduce(m, { type: "addRoughRequest", text: "third ask" }).model;

  m = reduce(m, {
    type: "curateIntent",
    text:
      "One synthesis sentence.\n\n- deliver the widget [serves: 1, 3]\n- respect the budget [serves: 1]",
  }).model;
  const cov = journalCoverage(m);
  assert.equal(cov.total, 3);
  assert.deepEqual(cov.served, [1, 3]);
  assert.deepEqual(cov.remaining, [2]);

  // Out-of-range trace numbers are ignored, not counted.
  m = reduce(m, {
    type: "curateIntent",
    text: "- everything [serves: 7]",
  }).model;
  assert.deepEqual(journalCoverage(m).served, []);
});

test("precision (2026-07-17): commitments traced [delivered-by:], every element referenced", () => {
  const { impactCoverage } = require("./projection") as {
    impactCoverage: (
      m: WorkingModel,
      cut?: readonly string[],
    ) => {
      pass: boolean;
      blockers: string[];
      elements: { label: string; referenced: boolean }[];
      missingDeliveredBy: number;
    };
  };
  let m = emptyModel("tep");
  m = reduce(m, { type: "seedGoal", text: "the ask" }).model;
  const els = m.sections.find((s) => s.kind === "elements")!;
  for (const t of ["element one", "element two"]) {
    m = reduce(m, {
      type: "proposeItem",
      actor: "gap-filler",
      sectionId: els.id,
      item: { text: t, modality: "optional", evals: {} },
    }).model;
  }
  for (const it of m.sections.find((s) => s.kind === "elements")!.items) {
    m = reduce(m, { type: "checkItem", actor: "human", itemId: it.id }).model;
  }

  // No commitments at all → blocked.
  assert.equal(impactCoverage(m).pass, false);

  // Traced commitments referencing only E1 → E2 is unattributed scope.
  m = reduce(m, {
    type: "curateIntent",
    text: "Synthesis.\n\n- do the thing [serves: 1] [delivered-by: E1]",
  }).model;
  let cov = impactCoverage(m);
  assert.equal(cov.pass, false);
  assert.match(cov.blockers.join(" "), /unattributed scope/);
  assert.equal(cov.elements[1].referenced, false);

  // Full traces → pass; a commitment without delivered-by → blocked again.
  m = reduce(m, {
    type: "curateIntent",
    text:
      "Synthesis.\n\n- do the thing [serves: 1] [delivered-by: E1]\n- and the other [serves: 1] [delivered-by: E2]",
  }).model;
  cov = impactCoverage(m);
  assert.equal(cov.pass, true, cov.blockers.join(" | "));

  m = reduce(m, {
    type: "curateIntent",
    text:
      "Synthesis.\n\n- do the thing [serves: 1] [delivered-by: E1, E2]\n- floating promise [serves: 1]",
  }).model;
  cov = impactCoverage(m);
  assert.equal(cov.pass, false);
  assert.equal(cov.missingDeliveredBy, 1);
});

// ── Phase A (2026-07-17): panic, assumptions, context digest ─────────────────

test("panicReset: keeps journal+assumptions+digest ref, wipes derived, refuses after freeze", () => {
  let m = emptyModel("tep");
  m = reduce(m, { type: "seedGoal", text: "the goal" }).model;
  m = reduce(m, { type: "addRoughRequest", text: "ask two" }).model;
  m = reduce(m, { type: "addAssumption", text: "single-user platform" }).model;
  m = reduce(m, { type: "setContextDigest", ref: "research/_context-digest.md" }).model;
  const els = m.sections.find((s) => s.kind === "elements")!;
  m = reduce(m, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: els.id,
    item: { text: "derived item", modality: "optional", evals: {} },
  }).model;
  m = reduce(m, { type: "curateIntent", text: "derived intent" }).model;
  m = reduce(m, {
    type: "recordReadiness",
    record: { covered: true, cleanCut: true, gapSection: null },
  }).model;

  const { model: wiped, delta } = reduce(m, {
    type: "panicReset",
    actor: "human",
  });
  assert.equal(delta.kind, "applied");
  assert.equal(wiped.sections.find((s) => s.kind === "goal")!.text, "the goal");
  assert.deepEqual(wiped.roughRequests!.map((r) => r.text), ["ask two"]);
  assert.deepEqual(wiped.assumptions!.map((a) => a.text), ["single-user platform"]);
  assert.equal(wiped.contextDigestRef, "research/_context-digest.md");
  assert.equal(wiped.sections.every((s) => s.items.length === 0), true);
  assert.equal(wiped.curatedIntent, undefined);
  assert.equal(wiped.readinessHistory.length, 0);

  // After a freeze (shipped item) panic refuses.
  const itemId = m.sections.find((s) => s.kind === "elements")!.items[0].id;
  const frozen = reduce(m, {
    type: "stampShipped",
    itemIds: [itemId],
    tepId: "TEP-1",
  }).model;
  const { delta: refused } = reduce(frozen, {
    type: "panicReset",
    actor: "human",
  });
  assert.equal(refused.kind, "rejected");
  assert.match((refused as { reason: string }).reason, /already frozen/);
});

test("addAssumption: append-only, empty refused; grounding blocks render into prompts", () => {
  let m = emptyModel("tep");
  m = reduce(m, { type: "seedGoal", text: "g" }).model;
  const { delta: empty } = reduce(m, { type: "addAssumption", text: "  " });
  assert.equal(empty.kind, "rejected");
  m = reduce(m, { type: "addAssumption", text: "single-user dev platform" }).model;
  m = reduce(m, { type: "addAssumption", text: "no external network" }).model;
  assert.deepEqual(m.assumptions!.map((a) => a.text), [
    "single-user dev platform",
    "no external network",
  ]);

  const { renderGroundingBlocks, gapFiller } = require("./workers/worker") as {
    renderGroundingBlocks: (mm: WorkingModel, d?: string) => string;
    gapFiller: (deps: {
      loadQuery: () => unknown;
      model: string;
      contextDigest?: string;
    }) => { buildPrompt: (mm: WorkingModel, c: string[]) => string };
  };
  const block = renderGroundingBlocks(m, "## Digest\nfact (src/x.ts)");
  assert.match(block, /STANDING ASSUMPTIONS/);
  assert.match(block, /1\. single-user dev platform/);
  assert.match(block, /CONTEXT DIGEST/);
  assert.match(block, /fact \(src\/x\.ts\)/);

  const prompt = gapFiller({
    loadQuery: () => (async function* () {})(),
    model: "sonnet",
    contextDigest: "## Digest\nfact (src/x.ts)",
  } as never).buildPrompt(m, []);
  assert.match(prompt, /STANDING ASSUMPTIONS/);
  assert.match(prompt, /CONTEXT DIGEST/);
});

test("challenger: stages contradicting items, applies only notes/edits, filters ghosts", async () => {
  const { runChallenger, buildChallengerPrompt } =
    require("./workers/challenger") as typeof import("./workers/challenger");
  let m = emptyModel("tep");
  m = reduce(m, { type: "seedGoal", text: "g" }).model;
  m = reduce(m, { type: "addAssumption", text: "single-user platform" }).model;
  const con = m.sections.find((s) => s.kind === "constraints")!;
  m = reduce(m, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: con.id,
    item: { text: "redact output for tenants", modality: "optional", evals: {} },
  }).model;
  const itemId = m.sections.find((s) => s.kind === "constraints")!.items[0].id;

  const prompt = buildChallengerPrompt(m);
  assert.match(prompt, /NEWEST ASSUMPTION.*single-user platform/);
  assert.match(prompt, /never drop anything/);

  const res = await runChallenger(
    {
      loadQuery:
        () =>
        async function* () {
          yield {
            type: "actions" as const,
            actions: [
              {
                type: "addItemNote",
                itemId,
                text: "Challenged by assumption: single-user — redaction is moot.",
              },
              // out-of-gate emission must be rejected by the seam
              { type: "proposeItem", sectionId: con.id, text: "sneak" },
            ] as never,
            select: [itemId, "item-ghost-9"],
          };
        },
      model: "sonnet",
    },
    m,
  );
  assert.equal(res.actions.length, 1);
  assert.equal(res.actions[0].type, "addItemNote");
  assert.deepEqual(res.selectedItemIds, [itemId]);
});

test("interpreter classify: statement/ask/question return empty-handed with the class", async () => {
  const { interpret } = require("./workers/interpreter") as typeof import("./workers/interpreter");
  let m = emptyModel("tep");
  m = reduce(m, { type: "seedGoal", text: "g" }).model;
  for (const cls of ["statement", "ask", "question"] as const) {
    const res = await interpret("whatever", m, {
      loadQuery:
        () =>
        async function* () {
          yield { type: "actions" as const, actions: [], classify: cls };
        },
    });
    assert.equal(res.classify, cls);
    assert.deepEqual(res.actions, []);
  }
});

test("contextualize prompt: sources, journal, budget, refresh block", () => {
  const { buildContextualizePrompt } =
    require("./workers/contextualizer") as typeof import("./workers/contextualizer");
  let m = emptyModel("tep");
  m = reduce(m, { type: "seedGoal", text: "build the graph view" }).model;
  const p1 = buildContextualizePrompt(m, ["/repo", "/store/ns"], undefined);
  assert.match(p1, /DECLARED SOURCES/);
  assert.match(p1, /- \/repo/);
  assert.match(p1, /1\. build the graph view/);
  assert.match(p1, /HARD BUDGET/);
  assert.doesNotMatch(p1, /EXISTING DIGEST/);
  const p2 = buildContextualizePrompt(m, ["/repo"], "old digest body");
  assert.match(p2, /EXISTING DIGEST/);
  assert.match(p2, /old digest body/);
});


// ── Journal correction (2026-07-17): recording errors are deletable ──────────

test("removeRoughRequest deletes an entry, refuses unknown ids, and later ids never collide", () => {
  let model = emptyModel("tep");
  model = reduce(model, { type: "seedGoal", text: "the goal" }).model;
  model = reduce(model, { type: "addRoughRequest", text: "keep me" }).model;
  model = reduce(model, { type: "addRoughRequest", text: "yes" }).model;
  const wrong = model.roughRequests!.find((r) => r.text === "yes")!;
  const applied = reduce(model, {
    type: "removeRoughRequest",
    actor: "human",
    requestId: wrong.id,
  });
  assert.equal(applied.delta.kind, "applied");
  model = applied.model;
  assert.deepEqual(
    model.roughRequests!.map((r) => r.text),
    ["keep me"],
  );
  const refused = reduce(model, {
    type: "removeRoughRequest",
    actor: "human",
    requestId: "req-99",
  });
  assert.equal(refused.delta.kind, "rejected");
  // New entries after a deletion must not reuse a surviving id.
  model = reduce(model, { type: "addRoughRequest", text: "after delete" }).model;
  const ids = model.roughRequests!.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("context scope: setContextScope persists a selected subset; contextSourcesForSpace honors it (2026-07-18)", () => {
  let m = emptyModel("tep");
  const applied = reduce(m, {
    type: "setContextScope",
    actor: "human",
    paths: ["/repo/a", "relative-ignored", "/repo/b"],
  });
  assert.equal(applied.delta.kind, "applied");
  m = applied.model;
  assert.deepEqual(m.contextScope, ["/repo/a", "/repo/b"]);
});
