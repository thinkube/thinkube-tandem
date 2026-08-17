/**
 * The engine contract test: the adapter's output is the exact shape the
 * imported scheduler consumes, and a golden fixture dispatched through the
 * REAL imported buildUnitDag + batchExecutionUnits yields the expected
 * DAG — nodes, edges, roles, footprints. If enriching the inputs ever
 * requires touching engine code, the engine-hash gate (below) makes that
 * a visible, argued act.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { tepSlices } from "./adapter";
import { isMaintainUnit } from "../run/plan";
import { emptySpace, Space } from "../core/schema";
import { addAsk, addNode } from "../core/intent";
import { buildUnitDag } from "../engine/core/dag";
import { batchExecutionUnits } from "../engine/orchestratorCore";
import { validateDag } from "../engine/methodology/parallelSlices";

function goldenSpace(): { space: Space; ids: string[] } {
  let s = emptySpace();
  const a = addAsk(s, "capture asks from the toolbar and list them", "t");
  assert.ok(a.ok);
  s = a.space;
  const ids: string[] = [];
  const add = (spec: {
    sentence: string;
    claim: string;
    tps: { path: string; symbol?: string; planned?: true }[];
    needs?: string[];
    acs: string[];
  }) => {
    const r = addNode(s, {
      sentence: spec.sentence,
      serves: [a.added.id],
      servesClaim: spec.claim,
      needs: spec.needs ?? [],
      acceptance: spec.acs.map((text, i) => ({ id: `c${ids.length}-${i}`, text })),
      grounding: { touchpoints: spec.tps, stamp: [] },
    });
    assert.ok(r.ok);
    s = r.space;
    ids.push(r.added.id);
  };
  // Slice 1 — the two promises that make ONE claim true.
  add({
    sentence: "a capture box in the toolbar",
    claim: "claim-capture",
    tps: [{ path: "src/toolbar/capture.ts", symbol: "CaptureBox", planned: true }],
    acs: ["typing an ask and pressing Enter records it verbatim"],
  });
  add({
    sentence: "the toolbar mounts the capture box",
    claim: "claim-capture",
    tps: [
      { path: "src/toolbar/index.ts", symbol: "Toolbar" },
      { path: "src/toolbar/capture.ts", symbol: "CaptureBox", planned: true },
    ],
    needs: [ids[0]],
    acs: ["the box is visible on load"],
  });
  // Slice 2 — a different claim, depending on the first.
  add({
    sentence: "captured asks render as a list",
    claim: "claim-list",
    tps: [{ path: "src/list/asks.ts", planned: true }],
    needs: [ids[0]],
    acs: ["a recorded ask appears in the list"],
  });
  return { space: s, ids };
}

test("golden fixture through the REAL engine: two slices, tests-first edges, cross-slice consumes edge, one coder each", () => {
  const { space, ids } = goldenSpace();
  const slices = tepSlices({ space, cut: { id: "cut-1", changeIds: ids }, spaceName: "toolbar space" });

  assert.equal(slices.length, 2, "two claims = two slices");
  const [sl1, sl2] = slices;
  assert.equal(sl1.handle, "SL-1");
  assert.deepEqual(sl1.files.sort(), ["src/toolbar/capture.ts", "src/toolbar/index.ts"]);
  assert.equal(sl1.workUnits[0].role, "code");
  assert.ok(sl1.workUnits[0].note!.includes("lands at src/toolbar/capture.ts › CaptureBox (new file)"));
  assert.ok(sl1.workUnits[0].note!.includes("done when: typing an ask"));
  assert.deepEqual(
    sl1.workUnits.filter((u) => u.role === "test").map((u) => u.footprint[0]),
    ["probes/toolbar_space__SL-1_AC-1.test.mjs", "probes/toolbar_space__SL-1_AC-2.test.mjs"],
  );
  assert.deepEqual(sl1.satisfies, [1, 2]);

  assert.deepEqual(sl2.workUnits[0].consumes, ["src/toolbar/capture.ts"], "the needs edge became the engine's consumes language");

  // Through the REAL imported scheduler machinery, untouched.
  const dag = buildUnitDag(slices);
  const verdict = validateDag(dag) as { ok: boolean };
  assert.equal(verdict.ok, true, `the engine accepts the plan: ${JSON.stringify(verdict)}`);

  const byId = new Map(dag.map((u) => [u.id, u]));
  const sl1code = dag.find((u) => u.slice === "SL-1" && (u.role ?? "code") === "code")!;
  const sl2code = dag.find((u) => u.slice === "SL-2" && (u.role ?? "code") === "code")!;
  // Tests-first: each slice's code unit requires its own test units.
  // ONE test node per slice: the probe units are serial, so the engine
  // batches them into a single warm session. Each criterion still keeps its
  // own probe file — the ordinals downstream are read off these footprints.
  const sl1tests = dag.filter((u) => u.slice === "SL-1" && u.role === "test").map((u) => u.id);
  assert.equal(sl1tests.length, 1, "one tester per slice, not one per check");
  const testNode = dag.find((u) => u.id === sl1tests[0])!;
  assert.deepEqual(
    testNode.footprint,
    [
      "probes/toolbar_space__SL-1_AC-1.test.mjs",
      "probes/toolbar_space__SL-1_AC-2.test.mjs",
    ],
    "every check keeps its own probe file and its ordinal",
  );
  for (const t of sl1tests) assert.ok(sl1code.requires.includes(t), "tests-first edge present");
  // Cross-slice edge: SL-2's coder waits on SL-1's producer.
  assert.ok(
    sl2code.requires.some((r) => byId.get(r)?.slice === "SL-1"),
    "the consumes edge reached the DAG",
  );
  // The contract is Spec-shared (union) on every unit: SL-2's coder is
  // told, BY NAME, what SL-1 introduces — the whole point of a seam.
  assert.match(sl2code.contract!, /SL-1 (INTRODUCES|CHANGES)/);

  // One coder per slice, per the engine's own batching.
  for (const s of slices) {
    const batched = batchExecutionUnits(s.workUnits);
    assert.equal(batched.filter((b: { units: { role?: string }[] }) => (b.units[0].role ?? "code") !== "test").length, 1);
  }
});

test("engine-hash gate: engine sources change only with an ENGINE-CHANGE.md marker", () => {
  const repo = path.resolve(__dirname, "..", "..");
  const engineDir = path.join(repo, "src", "engine");
  const mine = new Set(["importSmoke.test.ts", "splitFidelity.test.ts", "storeSync.test.ts"]);
  const current: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".ts") && !mine.has(name))
        current[path.relative(repo, p)] = createHash("sha256")
          .update(fs.readFileSync(p))
          .digest("hex");
    }
  };
  walk(engineDir);
  const baseline = JSON.parse(
    fs.readFileSync(path.join(engineDir, "engine-hash.json"), "utf8"),
  ) as Record<string, string>;
  const changed = [
    ...Object.keys(baseline).filter((k) => current[k] !== baseline[k]),
    ...Object.keys(current).filter((k) => !(k in baseline)),
  ];
  if (changed.length) {
    assert.ok(
      fs.existsSync(path.join(repo, "ENGINE-CHANGE.md")),
      `engine sources changed without ENGINE-CHANGE.md: ${changed.join(", ")}`,
    );
  } else {
    assert.deepEqual(changed, []);
  }
});

test("repo containment: a touchpoint escaping the repository refuses the plan", () => {
  let s = emptySpace();
  const a = addAsk(s, "escape", "t");
  assert.ok(a.ok);
  s = a.space;
  const n = addNode(s, {
    sentence: "a change pointing outside",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c", text: "x" }],
    grounding: { touchpoints: [{ path: "../outside/evil.ts" }], stamp: [] },
  });
  assert.ok(n.ok);
  assert.throws(
    () =>
      tepSlices({
        space: n.space,
        cut: { id: "c", changeIds: [n.added.id] },
        spaceName: "s",
      }),
    /escape the repository/,
  );
});

test("a dependency names files its producer owns ALONE, so the edge lands on one worker", () => {
  // Two claims both touch the shared file; only the second owns a file of
  // its own. Declaring the shared one would put an edge on both, which is
  // how a plan acquires dependencies nobody wrote — and how it cycles.
  let s = emptySpace();
  const a = addAsk(s, "two claims, one shared file", "t");
  assert.ok(a.ok);
  s = a.space;
  const ids: string[] = [];
  const add = (claim: string, tps: string[], needs: string[] = []) => {
    const r = addNode(s, {
      sentence: `${claim} at ${tps.join(",")}`,
      serves: [a.added.id],
      servesClaim: claim,
      needs,
      acceptance: [{ id: `c${ids.length}`, text: "proved" }],
      grounding: { touchpoints: tps.map((path) => ({ path })), stamp: [] },
    });
    assert.ok(r.ok);
    s = r.space;
    ids.push(r.added.id);
  };
  add("claim-a", ["src/shared.ts", "src/a.ts"]);
  add("claim-b", ["src/shared.ts", "src/b.ts"]);
  add("claim-c", ["src/c.ts"], [ids[0]]);

  const slices = tepSlices({ space: s, cut: { id: "cut-1", changeIds: ids }, spaceName: "x" });
  const consumer = slices.find((sl) =>
    sl.workUnits.some((u) => (u.footprint ?? []).includes("src/c.ts")),
  )!;
  const consumes = consumer.workUnits.find((u) => (u.role ?? "code") === "code")!.consumes ?? [];

  assert.ok(consumes.length, "the dependency is expressed");
  assert.ok(
    !consumes.includes("src/shared.ts"),
    `a file two slices touch is never named as a producer: ${consumes.join(", ")}`,
  );
  assert.deepEqual(consumes, ["src/a.ts"], "only what its producer owns alone");

  // And the whole plan the engine is handed must be acyclic.
  const dag = buildUnitDag(slices);
  assert.equal((validateDag(dag) as { ok: boolean }).ok, true);
});

test("the contract declares the seam by NAME — what a slice introduces, and what it changes", () => {
  const space: Space = {
    ...emptySpace(),
    asks: [{ id: "ask-1", text: "several spaces open at once", at: "t" }],
    subjects: [{ id: "sub-1", name: "the thinking space", from: ["ask-1"] }],
    claims: [{ id: "c1", subjectId: "sub-1", text: "each opens in its own tab", fromAsk: "ask-1" }],
    nodes: [
      {
        id: "n1",
        sentence: "one panel per space",
        serves: ["sub-1"],
        servesClaim: "c1",
        needs: [],
        acceptance: [{ id: "a1", text: "two spaces, two tabs" }],
        grounding: {
          touchpoints: [
            { path: "src/surfaces/panelRegistry.ts", symbol: "panelFor", planned: true },
            { path: "src/extension.ts", symbol: "openSpaceFor" },
          ],
          stamp: [],
        },
      },
    ],
    cuts: [{ id: "cut-1", changeIds: ["n1"] }],
  };

  const [slice] = tepSlices({ space, cut: space.cuts[0], spaceName: "sp" });
  // A name is something another slice can CALL. A description of what a
  // slice is doing is something it must guess at — which is how two
  // slices running in parallel each invent the same missing helper.
  assert.match(slice.contract!, /INTRODUCES/);
  assert.match(slice.contract!, /src\/surfaces\/panelRegistry\.ts › panelFor/);
  assert.match(slice.contract!, /CHANGES \(exists today\)/);
  assert.match(slice.contract!, /src\/extension\.ts › openSpaceFor/);
  assert.ok(
    !slice.contract!.includes("one panel per space"),
    "the sentence is the brief's job — the contract carries names, not prose",
  );
});

test("a promise grounded on files but no symbols declares no seam, rather than a false one", () => {
  const space: Space = {
    ...emptySpace(),
    asks: [{ id: "ask-1", text: "the docs say each space opens in its own tab", at: "t" }],
    subjects: [{ id: "sub-1", name: "the documentation", from: ["ask-1"] }],
    claims: [{ id: "c1", subjectId: "sub-1", text: "says what the tabs do", fromAsk: "ask-1" }],
    nodes: [
      {
        id: "n1",
        sentence: "the page stops describing one panel",
        serves: ["sub-1"],
        servesClaim: "c1",
        needs: [],
        acceptance: [{ id: "a1", text: "the page says tabs" }],
        grounding: { touchpoints: [{ path: "docs/the-space.adoc" }], stamp: [] },
      },
    ],
    cuts: [{ id: "cut-1", changeIds: ["n1"] }],
  };
  const [slice] = tepSlices({ space, cut: space.cuts[0], spaceName: "sp" });
  assert.equal(slice.contract, "", "no symbols, no interface — and nothing invented to fill it");
});

test("roles own paths: the coder's footprint is production-only; probes are the tester's; test homes are the maintainer's", () => {
  let s = emptySpace();
  const a = addAsk(s, "documentation is required to sign", "t");
  assert.ok(a.ok);
  s = a.space;
  const n = addNode(s, {
    sentence: "signing is refused without a documentation touchpoint",
    serves: [a.added.id],
    servesClaim: "claim-sign",
    needs: [],
    acceptance: [{ id: "c1", text: "signCut refuses a cut with no docs touchpoint" }],
    grounding: {
      touchpoints: [
        { path: "src/gates/sign.ts", symbol: "signCut" },
        { path: "src/gates/gates.test.ts", symbol: "signing tests" },
      ],
      stamp: [],
    },
  });
  assert.ok(n.ok);
  s = n.space;
  const slices = tepSlices({ space: s, cut: { id: "cut", changeIds: [n.added.id], tepId: "TEP-1" }, spaceName: "sp" });
  assert.equal(slices.length, 2, "the production slice, and its maintain slice");
  const [slice, maint] = slices;
  const coder = slice.workUnits.find((u) => u.role === "code")!;
  const tester = slice.workUnits.find((u) => u.role === "test")!;
  assert.deepEqual(coder.footprint, ["src/gates/sign.ts"], "the coder holds no test");
  assert.ok(!(coder as { note?: string }).note?.includes("gates.test.ts"), "and its note names no test landing");
  assert.deepEqual(tester.footprint, ["probes/sp__SL-1_AC-1.test.mjs"], "the tester writes probes only");
  assert.deepEqual(slice.files, ["src/gates/sign.ts"], "the production slice commits production");
  assert.equal(maint.maintains, "SL-1");
  const maintainer = maint.workUnits[0];
  assert.ok(isMaintainUnit(maintainer));
  assert.deepEqual(maintainer.footprint, ["src/gates/gates.test.ts"], "the test home is the maintainer's");
  const work = (maintainer as { testHomeWork?: { path: string; sentence: string }[] }).testHomeWork ?? [];
  assert.equal(work[0]?.path, "src/gates/gates.test.ts");
  assert.match(work[0]?.sentence ?? "", /signing is refused/);
  assert.deepEqual(maint.files, ["src/gates/gates.test.ts"], "the maintain slice commits the test home");
});

test("a slice whose every landing is a test home spends no coder — its maintainer brings the homes under", () => {
  let s = emptySpace();
  const a = addAsk(s, "existing tests come under the rule", "t");
  assert.ok(a.ok);
  s = a.space;
  const n = addNode(s, {
    sentence: "every existing signing test lands a documentation touchpoint",
    serves: [a.added.id],
    servesClaim: "claim-under",
    needs: [],
    acceptance: [{ id: "c1", text: "no test keeps signing green by weakening the rule", kind: "assessment" }],
    grounding: {
      touchpoints: [{ path: "src/gates/gates.test.ts" }, { path: "src/surfaces/surfaces.test.ts" }],
      stamp: [],
    },
  });
  assert.ok(n.ok);
  s = n.space;
  const slices = tepSlices({ space: s, cut: { id: "cut", changeIds: [n.added.id], tepId: "TEP-1" }, spaceName: "sp" });
  const [slice, maint] = slices;
  assert.equal(slice.workUnits.filter((u) => u.role === "code").length, 0, "no coder");
  assert.equal(slice.workUnits.filter((u) => u.role === "test").length, 0, "no probes to write");
  assert.ok(maint && isMaintainUnit(maint.workUnits[0]));
  assert.deepEqual(maint.workUnits[0].footprint, ["src/gates/gates.test.ts", "src/surfaces/surfaces.test.ts"]);
});
