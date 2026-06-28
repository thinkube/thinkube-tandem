/**
 * SP-th4wqi — contract-first slicing. `create_slice` must refuse the
 * **unsequenced-integration** shape: a `*.test.*` (or declared-integration)
 * **fan-out** work-unit with **no `consumes`**, sitting beside ≥1 sibling
 * implementation unit. That's the structure where disjoint-footprint siblings
 * each invent the shared contract and diverge (the SP-D/SP-th4wqe AC#3 failure).
 * The remedy is **contract-first**: define the seam as one node up front and have
 * every implementer + test `consumes` that node's file — so the fan-out is preserved
 * (only the contract precedes it) and nobody re-invents the contract.
 *
 * `consumes` is the SINGLE authored dependency language (SP-5/1): the ungrounded
 * `depends_on` form — both slice-level and work_unit-level — was deleted from the
 * schema and `create_slice` (and from `WorkUnit`/`buildUnitDag`). A unit names the
 * file(s) a sibling produces and `buildUnitDag` resolves a real edge to that producer.
 * Because `consumes` is a filename (not the unborn slice's `#eu-k` node-id), it is
 * authorable at create time — the property the contract-first remedy needs.
 *
 * These tests CONSUME the `parallelSlices.ts` contract rather than re-deriving it:
 *   • `CONTRACT_FIRST_RULE_MSG`     — the teaching message the gate refuses with;
 *                                     asserted *via the import*, never a literal,
 *                                     so the test can't drift from the real text.
 *   • `CONTRACT_FIRST_OPTOUT_FIELD` — the per-unit work_unit field that opts a
 *                                     genuinely-independent test out of the gate.
 * Both come from `../methodology/parallelSlices` (the gate's home); `buildUnitDag`
 * (the scheduler's DAG builder) comes from `../services/orchestratorCore`.
 *
 * Verification altitude (spec constraint): drive the **real `create_slice`
 * handler via `dispatchTool`** over a tmp `ThinkubeStore` and assert the
 * refusal / acceptance + message — never a pure predicate in isolation. The
 * buildUnitDag case alone is pure, proving the remedy fans out rather than
 * serializing producer→consumer→test.
 */
import "./installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { dispatchTool } from "./kanbanMcpServer";
import { buildUnitDag } from "../services/orchestratorCore";
import {
  CONTRACT_FIRST_RULE_MSG,
  CONTRACT_FIRST_OPTOUT_FIELD,
} from "../methodology/parallelSlices";

// ── tmp-store scaffolding (mirrors createSliceDagGate.test.ts) ───────────────
// A fresh thinking space + a seeded, Ready-able Spec, so `create_slice` runs end-to-end.
async function seededStore(spec = "1/1"): Promise<ThinkubeStore> {
  const thinkingSpace = fs.mkdtempSync(path.join(os.tmpdir(), "tk-cf-thinking space-"));
  const store = new ThinkubeStore(thinkingSpace, thinkingSpace);
  await store.writeFile(
    store.pathForSpecDoc(spec),
    { implements: "TEP-x", ac_verifications: { "1": { run: "npm test" } } },
    "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n",
  );
  return store;
}

const ctxFor = (store: ThinkubeStore) => ({
  env: {} as never,
  thinkingSpaces: { resolve: () => store } as never,
});

const create = (store: ThinkubeStore, args: Record<string, unknown>) =>
  dispatchTool(
    "create_slice",
    { spec: "1/1", ...args },
    ctxFor(store),
    () => {},
  );

// ── AC1: refuses the unsequenced-integration shape ──────────────────────────
test("create_slice refuses an unsequenced-integration test unit (names the rule + the offending unit)", async () => {
  const store = await seededStore();
  await assert.rejects(
    create(store, {
      title: "bad: test fans out beside an impl with no contract node",
      body: "detail",
      work_units: [
        // ≥2 sibling PRODUCERS sharing a contract — the test integrates both
        { footprint: ["src/widget.ts"], execution: "fan-out", note: "impl" },
        { footprint: ["src/gadget.ts"], execution: "fan-out", note: "impl" },
        // the offending unit: a *.test.* fan-out with NO consumes
        {
          footprint: ["src/widget.test.ts"],
          execution: "fan-out",
          note: "test",
        },
      ],
    }),
    (err: unknown) => {
      const msg = (err as Error).message;
      // assert the refusal via the imported rule message, never a hardcoded copy
      assert.ok(
        msg.includes(CONTRACT_FIRST_RULE_MSG),
        "refusal must quote CONTRACT_FIRST_RULE_MSG (the imported teaching message)",
      );
      // ...and it must name the offending unit so the author knows what to fix
      assert.match(
        msg,
        /widget\.test\.ts/,
        "refusal must name the offending unit by its footprint",
      );
      return true;
    },
  );
});

// ── AC2: accepts the same cluster routed through a shared contract file ──────
test("create_slice accepts contract-file-routed integration (a common `consumes` sequences the test)", async () => {
  const store = await seededStore();

  // The SAME cluster as AC1, but the seam is now defined as its own sibling unit
  // (it PRODUCES `src/widgetContract.ts`) and every implementer + test `consumes`
  // that file — so the test is sequenced behind a real, authorable contract, not
  // an unborn slice's `#eu-k` node-id. `consumes` is the only dependency language
  // (SP-5/1); a filename is authorable at create time, the deleted `depends_on`
  // node-id was not.
  const res = (await create(store, {
    title: "good: cluster routed through the contract file via consumes",
    body: "detail",
    work_units: [
      // the contract seam, defined first as its own producing node
      {
        footprint: ["src/widgetContract.ts"],
        execution: "serial",
        note: "define the widget seam",
      },
      {
        footprint: ["src/widget.ts"],
        execution: "fan-out",
        consumes: ["src/widgetContract.ts"],
        note: "impl",
      },
      {
        footprint: ["src/gadget.ts"],
        execution: "fan-out",
        consumes: ["src/widgetContract.ts"],
        note: "impl",
      },
      {
        footprint: ["src/widget.test.ts"],
        execution: "fan-out",
        consumes: ["src/widgetContract.ts"],
        note: "test",
      },
    ],
  })) as { slice: string };

  assert.match(res.slice, /^TEP-1_SP-1_SL-\d+$/);
});

// ── AC3: the opt-out escape hatch accepts a genuinely-independent test ───────
test("create_slice honors the opt-out flag: an unsequenced test is accepted when it opts out", async () => {
  const store = await seededStore();

  // Same shape AC1 refuses (test fan-out, no consumes, beside an impl), but the
  // test unit carries the imported opt-out flag → a genuinely-independent test is
  // not blocked by the heuristic (the escape hatch against false positives).
  const res = (await create(store, {
    title: "ok: independent test opts out of contract-first",
    body: "detail",
    work_units: [
      { footprint: ["src/widget.ts"], execution: "fan-out", note: "impl" },
      { footprint: ["src/gadget.ts"], execution: "fan-out", note: "impl" },
      {
        footprint: ["src/widget.test.ts"],
        execution: "fan-out",
        note: "independent test",
        [CONTRACT_FIRST_OPTOUT_FIELD]: true,
      },
    ],
  })) as { slice: string };

  assert.match(res.slice, /^TEP-1_SP-1_SL-\d+$/);
});

// ── AC4: the remedy preserves parallelism (pure buildUnitDag) ────────────────
test("buildUnitDag keeps contract-consuming implementers parallel — they share the producer, not each other", () => {
  // Two implementers + the contract node in one slice. The contract unit is
  // `serial` → eu-0 (`TEP-1_SP-1_SL-1#eu-0`); each fan-out implementer `consumes`
  // THAT unit's file (`src/contract.ts`), so `buildUnitDag` resolves an edge onto
  // the producer — never onto the sibling implementer.
  const dag = buildUnitDag([
    {
      handle: "TEP-1_SP-1_SL-1",
      status: "ready",
      requires: [],
      files: [],
      workUnits: [
        {
          footprint: ["src/contract.ts"],
          execution: "serial",
          note: "contract",
        },
        {
          footprint: ["src/implA.ts"],
          execution: "fan-out",
          consumes: ["src/contract.ts"],
          note: "A",
        },
        {
          footprint: ["src/implB.ts"],
          execution: "fan-out",
          consumes: ["src/contract.ts"],
          note: "B",
        },
      ],
    },
  ]);

  const contract = dag.find((u) => u.footprint.includes("src/contract.ts"))!;
  const implA = dag.find((u) => u.footprint.includes("src/implA.ts"))!;
  const implB = dag.find((u) => u.footprint.includes("src/implB.ts"))!;
  assert.ok(contract && implA && implB, "all three nodes are present");

  // Both implementers depend on the shared contract producer...
  assert.ok(
    implA.requires.includes(contract.id),
    "implA waits on the contract producer it consumes",
  );
  assert.ok(
    implB.requires.includes(contract.id),
    "implB waits on the contract producer it consumes",
  );

  // ...but NOT on each other → mutually independent, parallel-eligible. This is
  // the proof contract-first is not a covert producer→consumer→test serialization.
  assert.ok(
    !implA.requires.includes(implB.id),
    "implA must not depend on its sibling implementer",
  );
  assert.ok(
    !implB.requires.includes(implA.id),
    "implB must not depend on its sibling implementer",
  );
});

// ── consumes: the authorable contract-first remedy (the SL-new deadlock fix) ──
test("create_slice accepts an integration test that `consumes` a sibling contract (no node-id needed)", async () => {
  const store = await seededStore();
  // 2 producers + a test that would trip the gate — but the test declares it
  // `consumes` the contract producer's file. That's authorable at create time
  // (a filename, not the unborn slice's `#eu-0`), so the gate is satisfied.
  const res = (await create(store, {
    title: "good: test consumes the contract file",
    body: "detail",
    work_units: [
      {
        footprint: ["src/contract.ts"],
        execution: "fan-out",
        note: "contract+impl",
      },
      { footprint: ["src/widget.ts"], execution: "fan-out", note: "impl" },
      {
        footprint: ["src/flow.test.ts"],
        execution: "fan-out",
        consumes: ["src/contract.ts"],
        note: "test",
      },
    ],
  })) as { slice: string };
  assert.match(res.slice, /^TEP-1_SP-1_SL-\d+$/);
});

test("buildUnitDag resolves `consumes` to a real edge on the producing sibling", () => {
  const dag = buildUnitDag([
    {
      handle: "TEP-1_SP-1_SL-1",
      status: "ready",
      requires: [],
      files: [],
      workUnits: [
        {
          footprint: ["src/contract.ts"],
          execution: "fan-out",
          note: "contract",
        },
        {
          footprint: ["src/flow.test.ts"],
          execution: "fan-out",
          consumes: ["src/contract.ts"],
          note: "test",
        },
      ],
    },
  ]);
  const contract = dag.find((u) => u.footprint.includes("src/contract.ts"))!;
  const test = dag.find((u) => u.footprint.includes("src/flow.test.ts"))!;
  assert.ok(contract && test, "both nodes present");
  assert.ok(
    test.requires.includes(contract.id),
    "`consumes` resolves to a dependency on the producing unit",
  );
});
