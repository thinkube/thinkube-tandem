/**
 * The clustering doctrine: the first pass clusters everything cross-ask;
 * assigned members are frozen against machine batches; a new change joins
 * on exactly one edge and otherwise starts its own unit; strong coupling
 * across units stages a proposal (never a silent merge); a rejected pair
 * is vetoed forever; pins stay sovereign.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { advanceMembership, applyMerge, pairKey } from "./membership";
import { Change } from "./schema";

const change = (id: string, file: string, needs: string[] = []): Change => ({
  id,
  sentence: `change ${id}`,
  serves: ["ask-1"],
  needs,
  acceptance: [{ id: `${id}-c`, text: "x" }],
  grounding: { touchpoints: [{ path: file }], stamp: [] },
});

const mint = (n: number) => `unit-u-${n}`;

test("first pass clusters the whole space cross-ask; later passes freeze assigned members", () => {
  const a = change("a", "src/x.ts");
  const b = { ...change("b", "src/x.ts"), serves: ["ask-2"] };
  const c = change("c", "src/y.ts");
  const r1 = advanceMembership({ nodes: [a, b, c], units: [], pins: [], vetoes: [], existingProposals: [], mintUnitId: mint });
  const shared = r1.units.find((u) => u.changeIds.includes("a"))!;
  assert.ok(shared.changeIds.includes("b"), "same file clusters across asks");
  assert.equal(r1.units.length, 2);

  // A malicious second batch with different coupling CANNOT move members.
  const moved = { ...a, grounding: { touchpoints: [{ path: "src/y.ts" }], stamp: [] } };
  const r2 = advanceMembership({ nodes: [moved, b, c], units: r1.units, pins: [], vetoes: [], existingProposals: [], mintUnitId: mint });
  assert.deepEqual(
    r2.units.find((u) => u.changeIds.includes("a"))!.changeIds.sort(),
    shared.changeIds.slice().sort(),
    "assigned membership is append-only",
  );
});

test("growth rule: one resolving unit joins; zero or several starts a new unit", () => {
  const a = change("a", "src/x.ts");
  const c = change("c", "src/y.ts");
  const base = advanceMembership({ nodes: [a, c], units: [], pins: [], vetoes: [], existingProposals: [], mintUnitId: mint });
  const joiner = change("j", "src/x.ts");
  const r = advanceMembership({ nodes: [a, c, joiner], units: base.units, pins: [], vetoes: [], existingProposals: [], mintUnitId: mint });
  assert.ok(
    r.units.find((u) => u.changeIds.includes("a"))!.changeIds.includes("j"),
    "exactly one edge → joins that unit",
  );
  const loner = change("l", "src/z.ts");
  const r2 = advanceMembership({ nodes: [a, c, joiner, loner], units: r.units, pins: [], vetoes: [], existingProposals: [], mintUnitId: mint });
  assert.ok(r2.units.some((u) => u.changeIds.length === 1 && u.changeIds[0] === "l"), "no edge → its own unit");
});

test("strong cross-unit coupling stages a proposal; a veto is permanent", () => {
  // Two established units whose members, after edits, now share files
  // densely (4 crossing edges). The structure must NOT change — a merge is
  // STAGED for the human, and a single crossing edge would never propose.
  const a1 = { ...change("a1", "src/x.ts"), grounding: { touchpoints: [{ path: "src/x.ts" }, { path: "src/y.ts" }], stamp: [] } };
  const a2 = { ...change("a2", "src/x.ts"), grounding: { touchpoints: [{ path: "src/x.ts" }, { path: "src/y.ts" }], stamp: [] } };
  const b1 = change("b1", "src/y.ts");
  const b2 = change("b2", "src/y.ts");
  const units = [
    { id: "unit-u-1", changeIds: ["a1", "a2"] },
    { id: "unit-u-2", changeIds: ["b1", "b2"] },
  ];
  const r = advanceMembership({ nodes: [a1, a2, b1, b2], units, pins: [], vetoes: [], existingProposals: [], mintUnitId: mint });
  assert.equal(r.newProposals.length, 1, "a proposal is staged, nothing merges");
  assert.equal(r.units.length, 2, "the structure is untouched by the suggestion");

  const key = pairKey(r.newProposals[0].a, r.newProposals[0].b);
  const r2 = advanceMembership({ nodes: [a1, a2, b1, b2], units, pins: [], vetoes: [key], existingProposals: [], mintUnitId: mint });
  assert.equal(r2.newProposals.length, 0, "a vetoed pair never re-proposes");
});

test("an accepted merge applies exactly once; pins stay sovereign over machine structure", () => {
  const a = change("a", "src/x.ts");
  const b = change("b", "src/y.ts");
  const base = advanceMembership({ nodes: [a, b], units: [], pins: [], vetoes: [], existingProposals: [], mintUnitId: mint });
  const [ua, ub] = base.units.map((u) => u.id);
  const merged = applyMerge(base.units, ua, ub);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].changeIds.sort(), ["a", "b"]);

  const pinApart = advanceMembership({
    nodes: [a, b],
    units: merged,
    pins: [{ kind: "apart", changeIds: ["a", "b"] }],
    vetoes: [],
    existingProposals: [],
    mintUnitId: mint,
  });
  assert.equal(pinApart.units.length, 2, "the human's apart pin splits the merged unit");
});

test("suggestions around one unit are ONE decision: all fold in, or all are vetoed", async () => {
  const { mergeFamilyVerdict } = await import("./suggestions");
  const { emptySpace } = await import("./schema");
  const nodes = ["big1", "big2", "x", "y", "z"].map((id) => change(id, `src/${id}.ts`));
  const space = {
    ...emptySpace(),
    nodes,
    units: [
      { id: "u-big", changeIds: ["big1", "big2"] },
      { id: "u-x", changeIds: ["x"] },
      { id: "u-y", changeIds: ["y"] },
      { id: "u-z", changeIds: ["z"] },
    ],
    // The machine proposes three separate pairs — all naming the same unit.
    proposals: [
      { id: "p1", a: "u-big", b: "u-x" },
      { id: "p2", a: "u-big", b: "u-y" },
      { id: "p3", a: "u-z", b: "u-big" },
    ],
  };

  const yes = mergeFamilyVerdict(space, "u-big", true);
  assert.ok(!("reason" in yes));
  if ("reason" in yes) return;
  assert.equal(yes.count, 3, "one press answered all three suggestions");
  assert.equal(yes.space.units.length, 1, "everything folded into the one unit");
  assert.deepEqual(
    yes.space.units[0].changeIds.sort(),
    ["big1", "big2", "x", "y", "z"],
    "the anchor keeps its promises and gains every joiner's",
  );
  assert.equal(yes.space.proposals!.length, 0, "no sibling suggestion is left dangling");

  const no = mergeFamilyVerdict(space, "u-big", false);
  assert.ok(!("reason" in no));
  if ("reason" in no) return;
  assert.equal(no.space.units.length, 4, "rejecting merges nothing");
  assert.equal(no.space.vetoes!.length, 3, "every pair in the family is vetoed forever");
  assert.ok(no.space.vetoes!.includes(pairKey("u-z", "u-big")), "a family member listed second is vetoed too");
});

test("suggestions around one unit are ONE decision: all fold in, or all are vetoed", async () => {
  const { mergeFamilyVerdict } = await import("./suggestions");
  const { emptySpace } = await import("./schema");
  const nodes = ["big1", "big2", "x", "y", "z"].map((id) => change(id, `src/${id}.ts`));
  const space = {
    ...emptySpace(),
    nodes,
    units: [
      { id: "u-big", changeIds: ["big1", "big2"] },
      { id: "u-x", changeIds: ["x"] },
      { id: "u-y", changeIds: ["y"] },
      { id: "u-z", changeIds: ["z"] },
    ],
    // The machine proposes three separate pairs — all naming the same unit.
    proposals: [
      { id: "p1", a: "u-big", b: "u-x" },
      { id: "p2", a: "u-big", b: "u-y" },
      { id: "p3", a: "u-z", b: "u-big" },
    ],
  };

  const yes = mergeFamilyVerdict(space, "u-big", true);
  assert.ok(!("reason" in yes));
  if ("reason" in yes) return;
  assert.equal(yes.count, 3, "one press answered all three suggestions");
  assert.equal(yes.space.units.length, 1, "everything folded into the one unit");
  assert.deepEqual(
    yes.space.units[0].changeIds.sort(),
    ["big1", "big2", "x", "y", "z"],
    "the anchor keeps its promises and gains every joiner's",
  );
  assert.equal(yes.space.proposals!.length, 0, "no sibling suggestion is left dangling");

  const no = mergeFamilyVerdict(space, "u-big", false);
  assert.ok(!("reason" in no));
  if ("reason" in no) return;
  assert.equal(no.space.units.length, 4, "rejecting merges nothing");
  assert.equal(no.space.vetoes!.length, 3, "every pair in the family is vetoed forever");
  assert.ok(no.space.vetoes!.includes(pairKey("u-z", "u-big")), "a family member listed second is vetoed too");
});

test("a ruled unit is not offered again: merging never breeds the next dozen suggestions", async () => {
  const { mergeFamilyVerdict, advanceSpaceMembership } = await import("./suggestions");
  const { emptySpace } = await import("./schema");
  // Everything touches the same file, so every pair couples strongly — the
  // shape that made one big unit get proposed against all the rest.
  const nodes = ["a", "b", "c", "d", "e"].map((id) => change(id, "src/shared.ts"));
  let space = {
    ...emptySpace(),
    nodes,
    units: [
      { id: "u-big", changeIds: ["a", "b"] },
      { id: "u-c", changeIds: ["c"] },
      { id: "u-d", changeIds: ["d"] },
      { id: "u-e", changeIds: ["e"] },
    ],
  };
  space = advanceSpaceMembership(space, "me");
  const offered = (space.proposals ?? []).filter((p) => p.a === "u-big" || p.b === "u-big");
  assert.ok(offered.length >= 2, "the big unit is offered against the loose ones");

  const yes = mergeFamilyVerdict(space, "u-big", true);
  assert.ok(!("reason" in yes));
  if ("reason" in yes) return;
  space = advanceSpaceMembership(yes.space, "me");
  assert.equal(
    (space.proposals ?? []).length,
    0,
    "the unit the human ruled on is settled — merging it proposes nothing new",
  );

  // A promise arriving later changes what the unit holds, so it may be asked about again.
  space = advanceSpaceMembership(
    { ...space, nodes: [...space.nodes, change("f", "src/shared.ts")] },
    "me",
  );
  const holder = space.units.find((u) => u.changeIds.includes("f"))!;
  assert.ok(holder, "the new promise landed somewhere");
});
