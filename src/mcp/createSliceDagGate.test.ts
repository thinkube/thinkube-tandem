/**
 * SP-5/1 (TEP-5) AC4: `create_slice` REFUSES an authored `depends_on` — at the
 * slice level OR on a work_unit — because the only dependency language is now
 * `consumes`+footprint (resolved over the GLOBAL set of the Spec's units). The
 * authored `depends_on` form is ungrounded (not an artifact a unit reads) and
 * unauthorable at create time (the slice has no number, so its units have no
 * `#eu-k` node-ids yet — the exact `#27` problem `consumes` solved). To avoid a
 * silent loss of an author's intent, the gate refuses it with a teaching message
 * that NAMES `consumes` as the grounded replacement.
 *
 * These tests drive `dispatchTool` (the layer the live MCP server runs), not the
 * pure helpers, so the gate's WIRING is what's verified. The companion
 * `consumes`-routed acceptances confirm the grounded form is the live path.
 */
import "./installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { dispatchTool } from "./kanbanMcpServer";
import { armApprovalForSlicing } from "./approvalGateTestSupport";

async function seededStore(spec = "1/1"): Promise<ThinkubeStore> {
  const thinkingSpace = fs.mkdtempSync(
    path.join(os.tmpdir(), "tk-dag-thinking space-"),
  );
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

const create = async (store: ThinkubeStore, args: Record<string, unknown>) => {
  const spec = String(args.spec ?? "1/1");
  await armApprovalForSlicing(store, spec);
  return dispatchTool(
    "create_slice",
    // SP-6/3: a multi-unit slice requires a design-time contract — default one so these DAG-gate
    // fixtures exercise the graph checks, not the contract-required refusal.
    {
      spec: "1/1",
      contract: "interface Contract { /* shared seam */ }",
      ...args,
    },
    ctxFor(store),
    () => {},
  );
};

test("create_slice REFUSES a slice-level depends_on, naming consumes", async () => {
  const store = await seededStore();
  await assert.rejects(
    create(store, {
      title: "bad: slice-level dep",
      body: "detail",
      depends_on: ["TEP-1_SP-1_SL-1"], // ungrounded authored slice handle — removed
      files: ["src/x.ts"],
    }),
    (err: Error) => {
      // Refused at the door, AND the teaching message names the grounded
      // replacement so an author isn't left guessing what to write instead.
      assert.match(err.message, /depends_on/);
      assert.match(err.message, /consumes/);
      return true;
    },
  );
});

test("create_slice REFUSES a work_unit depends_on, naming consumes", async () => {
  const store = await seededStore();
  await assert.rejects(
    create(store, {
      title: "bad: work_unit dep",
      body: "detail",
      work_units: [
        { footprint: ["src/a.ts"], execution: "serial" },
        {
          footprint: ["src/a.test.ts"],
          depends_on: ["#eu-1"], // ungrounded authored node-id — removed
          execution: "serial",
        },
      ],
    }),
    (err: Error) => {
      assert.match(err.message, /depends_on/);
      assert.match(err.message, /consumes/);
      return true;
    },
  );
});

test("create_slice ACCEPTS a well-formed slice with disjoint fan-out units", async () => {
  const store = await seededStore();
  const res = (await create(store, {
    title: "good: parallel fan-out",
    body: "detail",
    work_units: [
      { footprint: ["src/a.ts"], execution: "fan-out", note: "a" },
      // One coder per slice (2026-07-08): the sibling is the held-out test author.
      {
        footprint: ["src/a.test.ts"],
        execution: "fan-out",
        role: "test",
        note: "test a",
      },
    ],
  })) as { slice: string };
  assert.match(res.slice, /^TEP-1_SP-1_SL-\d+$/);
});

test("create_slice ACCEPTS a unit dependency expressed via consumes (the grounded replacement)", async () => {
  const store = await seededStore();
  // The grounded form: a slice's coder READS a file a SIBLING SLICE produces, expressed
  // as `consumes` (one coder per slice, 2026-07-08 — intra-slice ordering is moot, and a
  // test unit can never consume the coder's output because tests dispatch first).
  await create(store, {
    title: "producer: the contract module",
    body: "detail",
    work_units: [
      { footprint: ["src/contract.ts"], execution: "serial", note: "contract" },
    ],
  });
  const res = (await create(store, {
    title: "good: consumes a sibling slice's artifact",
    body: "detail",
    work_units: [
      {
        footprint: ["src/impl.ts"],
        consumes: ["src/contract.ts"],
        execution: "serial",
        note: "impl reads the contract",
      },
    ],
  })) as { slice: string };
  assert.match(res.slice, /^TEP-1_SP-1_SL-\d+$/);
});
