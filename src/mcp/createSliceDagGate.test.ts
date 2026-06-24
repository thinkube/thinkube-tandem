/**
 * SP-A / TEP-th3i18 #17–#18: `create_slice` must validate the work-unit DAG **at
 * creation** and refuse a malformed one — a footprint-path `depends_on`, a
 * dangling slice handle, or a cycle — instead of letting it serialize to the
 * board and explode later at orchestrate time as "malformed DAG." These tests
 * drive `dispatchTool` (the layer the live MCP server runs), not the pure
 * helpers, so the gate's WIRING is what's verified.
 */
import "./installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { dispatchTool } from "./kanbanMcpServer";

async function seededStore(spec = "demo"): Promise<ThinkubeStore> {
  const board = fs.mkdtempSync(path.join(os.tmpdir(), "tk-dag-board-"));
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
  dispatchTool("create_slice", { spec: "demo", ...args }, ctxFor(store), () => {});

test("create_slice REFUSES a work_unit depends_on that is a footprint path (teaching message)", async () => {
  const store = await seededStore();
  await assert.rejects(
    create(store, {
      title: "bad: file-path dep",
      body: "detail",
      work_units: [
        { footprint: ["src/a.ts"], execution: "serial" },
        {
          footprint: ["src/a.test.ts"],
          depends_on: ["src/a.ts"], // ← a footprint path, not a node-id (the exact bug)
          execution: "serial",
        },
      ],
    }),
    /not a node-id|shared footprint/i,
  );
});

test("create_slice REFUSES a dangling slice-handle depends_on (DAG unresolved)", async () => {
  const store = await seededStore();
  await assert.rejects(
    create(store, {
      title: "bad: dangling dep",
      body: "detail",
      depends_on: ["SP-demo_SL-99"], // no such sibling
      files: ["src/x.ts"],
    }),
    /malformed|unresolved/i,
  );
});

test("create_slice ACCEPTS a well-formed slice with disjoint fan-out units", async () => {
  const store = await seededStore();
  const res = (await create(store, {
    title: "good: parallel fan-out",
    body: "detail",
    work_units: [
      { footprint: ["src/a.ts"], execution: "fan-out", note: "a" },
      { footprint: ["src/a.test.ts"], execution: "fan-out", note: "test a" },
    ],
  })) as { slice: string };
  assert.match(res.slice, /^SP-demo_SL-\d+$/);
});

test("create_slice ACCEPTS an inter-slice dep on a UNIT-BEARING slice (the #18 win)", async () => {
  const store = await seededStore();
  const first = (await create(store, {
    title: "first unit-bearing slice",
    body: "detail",
    work_units: [
      { footprint: ["src/core.ts"], execution: "fan-out", note: "core" },
      { footprint: ["src/core.test.ts"], execution: "fan-out", note: "test" },
    ],
  })) as { slice: string };

  // SL-2 depends on the unit-bearing SL-1. Before the #18 fix this would be
  // rejected as "malformed" (the bare handle resolved to no node); now it passes.
  const res = (await create(store, {
    title: "second slice depends on the first",
    body: "detail",
    depends_on: [first.slice],
    work_units: [
      { footprint: ["src/extra.ts"], execution: "fan-out", note: "extra" },
    ],
  })) as { slice: string };
  assert.match(res.slice, /^SP-demo_SL-\d+$/);
});
