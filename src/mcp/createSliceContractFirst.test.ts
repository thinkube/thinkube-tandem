/**
 * SP-th4wqi — contract-first slicing. `create_slice` must refuse the
 * **unsequenced-integration** shape: a `*.test.*` (or declared-integration)
 * **fan-out** work-unit with **no `depends_on`**, sitting beside ≥1 sibling
 * implementation unit. That's the structure where disjoint-footprint siblings
 * each invent the shared contract and diverge (the SP-D/SP-th4wqe AC#3 failure).
 * The remedy is **contract-first**: define the seam as one node up front and have
 * every implementer + test `depends_on` that node — so the fan-out is preserved
 * (only the contract precedes it) and nobody re-invents the contract.
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
 * refusal / acceptance + message — never a pure predicate in isolation. AC#4
 * alone is pure (`buildUnitDag`), proving the remedy fans out rather than
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
// A fresh board + a seeded, Ready-able Spec, so `create_slice` runs end-to-end.
async function seededStore(spec = "demo"): Promise<ThinkubeStore> {
  const board = fs.mkdtempSync(path.join(os.tmpdir(), "tk-cf-board-"));
  const store = new ThinkubeStore(board, board);
  await store.writeFile(
    store.pathForSpecDoc(spec),
    { implements: "TEP-x", ac_verifications: { "1": { run: "npm test" } } },
    "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n",
  );
  return store;
}

const ctxFor = (store: ThinkubeStore) => ({
  env: {} as never,
  boards: { resolve: () => store } as never,
});

const create = (store: ThinkubeStore, args: Record<string, unknown>) =>
  dispatchTool(
    "create_slice",
    { spec: "demo", ...args },
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
        // the offending unit: a *.test.* fan-out with NO depends_on
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

// ── AC2: accepts the same cluster routed through a shared contract node ──────
test("create_slice accepts contract-node-routed integration (a common depends_on sequences the test)", async () => {
  const store = await seededStore();

  // Define the contract seam first, as its own node (a real, resolvable handle).
  const contract = (await create(store, {
    title: "contract: define the widget seam",
    body: "detail",
    work_units: [
      {
        footprint: ["src/widgetContract.ts"],
        execution: "serial",
        note: "define",
      },
    ],
  })) as { slice: string };

  // The SAME cluster as AC1, but every implementer + test now shares a
  // `depends_on` on the contract node — so the test is sequenced, not unsequenced.
  const res = (await create(store, {
    title: "good: cluster routed through the contract node",
    body: "detail",
    work_units: [
      {
        footprint: ["src/widget.ts"],
        execution: "fan-out",
        depends_on: [contract.slice],
        note: "impl",
      },
      {
        footprint: ["src/gadget.ts"],
        execution: "fan-out",
        depends_on: [contract.slice],
        note: "impl",
      },
      {
        footprint: ["src/widget.test.ts"],
        execution: "fan-out",
        depends_on: [contract.slice],
        note: "test",
      },
    ],
  })) as { slice: string };

  assert.match(res.slice, /^SP-demo_SL-\d+$/);
});

// ── AC3: the opt-out escape hatch accepts a genuinely-independent test ───────
test("create_slice honors the opt-out flag: an unsequenced test is accepted when it opts out", async () => {
  const store = await seededStore();

  // Same shape AC1 refuses (test fan-out, no depends_on, beside an impl), but the
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

  assert.match(res.slice, /^SP-demo_SL-\d+$/);
});

// ── AC4: the remedy preserves parallelism (pure buildUnitDag) ────────────────
test("buildUnitDag keeps contract-node implementers parallel — they share the dep, not each other", () => {
  // Two implementers + the contract node in one slice. The contract unit is
  // `serial` → eu-0 (`SP-1_SL-1#eu-0`); each fan-out implementer depends_on THAT
  // node, never on the sibling. Explicit handle ⇒ the eu ids are deterministic.
  const dag = buildUnitDag([
    {
      handle: "SP-1_SL-1",
      status: "ready",
      dependsOn: [],
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
          depends_on: ["SP-1_SL-1#eu-0"],
          note: "A",
        },
        {
          footprint: ["src/implB.ts"],
          execution: "fan-out",
          depends_on: ["SP-1_SL-1#eu-0"],
          note: "B",
        },
      ],
    },
  ]);

  const contract = dag.find((u) => u.footprint.includes("src/contract.ts"))!;
  const implA = dag.find((u) => u.footprint.includes("src/implA.ts"))!;
  const implB = dag.find((u) => u.footprint.includes("src/implB.ts"))!;
  assert.ok(contract && implA && implB, "all three nodes are present");

  // Both implementers depend on the shared contract node...
  assert.ok(
    implA.dependsOn.includes(contract.id),
    "implA waits on the contract node",
  );
  assert.ok(
    implB.dependsOn.includes(contract.id),
    "implB waits on the contract node",
  );

  // ...but NOT on each other → mutually independent, parallel-eligible. This is
  // the proof contract-first is not a covert producer→consumer→test serialization.
  assert.ok(
    !implA.dependsOn.includes(implB.id),
    "implA must not depend on its sibling implementer",
  );
  assert.ok(
    !implB.dependsOn.includes(implA.id),
    "implB must not depend on its sibling implementer",
  );
});
