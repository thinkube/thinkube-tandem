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
    tps: { path: string; symbol?: string; planned?: true }[];
    needs?: string[];
    acs: string[];
  }) => {
    const r = addNode(s, {
      sentence: spec.sentence,
      serves: [a.added.id],
      needs: spec.needs ?? [],
      acceptance: spec.acs.map((text, i) => ({ id: `c${ids.length}-${i}`, text })),
      grounding: { touchpoints: spec.tps, stamp: [] },
    });
    assert.ok(r.ok);
    s = r.space;
    ids.push(r.added.id);
  };
  // Slice 1 (two coupled changes: same planned module + edge)
  add({
    sentence: "a capture box in the toolbar",
    tps: [{ path: "src/toolbar/capture.ts", planned: true }],
    acs: ["typing an ask and pressing Enter records it verbatim"],
  });
  add({
    sentence: "the toolbar mounts the capture box",
    tps: [{ path: "src/toolbar/index.ts" }, { path: "src/toolbar/capture.ts", planned: true }],
    needs: [ids[0]],
    acs: ["the box is visible on load"],
  });
  // Slice 2 (depends on slice 1's produced file)
  add({
    sentence: "captured asks render as a list",
    tps: [{ path: "src/list/asks.ts", planned: true }],
    needs: [ids[0]],
    acs: ["a recorded ask appears in the list"],
  });
  return { space: s, ids };
}

test("golden fixture through the REAL engine: two slices, tests-first edges, cross-slice consumes edge, one coder each", () => {
  const { space, ids } = goldenSpace();
  const slices = tepSlices({ space, cut: { id: "cut-1", changeIds: ids }, spaceName: "toolbar space" });

  assert.equal(slices.length, 2, "coupled pair + dependent = two slices");
  const [sl1, sl2] = slices;
  assert.equal(sl1.handle, "SL-1");
  assert.deepEqual(sl1.files.sort(), ["src/toolbar/capture.ts", "src/toolbar/index.ts"]);
  assert.equal(sl1.workUnits[0].role, "code");
  assert.ok(sl1.workUnits[0].note!.includes("lands at src/toolbar/capture.ts (new file)"));
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
  const sl1tests = dag.filter((u) => u.slice === "SL-1" && u.role === "test").map((u) => u.id);
  assert.equal(sl1tests.length, 2);
  for (const t of sl1tests) assert.ok(sl1code.requires.includes(t), "tests-first edge present");
  // Cross-slice edge: SL-2's coder waits on SL-1's producer.
  assert.ok(
    sl2code.requires.some((r) => byId.get(r)?.slice === "SL-1"),
    "the consumes edge reached the DAG",
  );
  // Contract is Spec-shared (union) on every unit.
  assert.ok(sl2code.contract!.includes("a capture box in the toolbar"));

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
