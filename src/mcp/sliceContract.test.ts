/**
 * SP-6/3 — the slice's design-time CONTRACT. The slicer writes the shared interface WHEN THE
 * SLICE IS CREATED; it is (a) injected into EVERY worker prompt — code and held-out test alike —
 * so units agree on the seam without consuming each other, and (b) it satisfies the contract-first
 * gate (a contract-defined slice's test unit legitimately carries no `consumes`). installVscodeStub
 * first — create_slice builds a ThinkubeStore.
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
import { buildUnitDag, buildWorkerPrompt } from "../services/orchestratorCore";

const CONTRACT =
  "ApprovalToken.mint(subjectKey, contentHash, issuedAt, secret) -> string\n" +
  "ApprovalToken.verify(token, {subjectKey, contentHash, now, secret}) -> boolean";

// ── the contract reaches BOTH the code and the held-out test worker ───────────
test("buildWorkerPrompt injects the slice contract into BOTH code and test units", () => {
  const dag = buildUnitDag([
    {
      handle: "TEP-6_SP-3_SL-1",
      status: "ready",
      requires: [],
      files: [],
      contract: CONTRACT,
      workUnits: [
        {
          footprint: ["src/approvalToken.ts"],
          execution: "fan-out",
          note: "impl",
        },
        {
          footprint: ["src/acceptance/SP-6_3_AC-1.test.ts"],
          execution: "fan-out",
          role: "test",
          note: "probe",
        },
      ],
      satisfies: [1],
    },
  ]);
  const code = dag.find((u) => u.footprint.includes("src/approvalToken.ts"));
  const testU = dag.find((u) => u.role === "test");
  assert.ok(code && testU, "both units are in the DAG");
  // Both units carry the contract, and its text is surfaced in each prompt.
  for (const [label, u] of [
    ["code", code!],
    ["test", testU!],
  ] as const) {
    assert.equal(u.contract, CONTRACT, `${label} unit carries the contract`);
    const prompt = buildWorkerPrompt(u, "6/3");
    assert.match(
      prompt,
      /SPEC CONTRACT/,
      `${label} prompt frames the contract`,
    );
    assert.match(
      prompt,
      /ApprovalToken\.mint/,
      `${label} prompt has the contract text`,
    );
  }
});

test("the contract is Spec-wide: a unit in one slice sees a contract another slice declares (cross-slice)", () => {
  // SL-1 declares the token/store seam; SL-2 (the webview) declares its own — each unit must build
  // against the UNION, so SL-2's worker sees SL-1's ApprovalToken interface (cross-slice agreement).
  const dag = buildUnitDag([
    {
      handle: "TEP-6_SP-3_SL-1",
      status: "ready",
      requires: [],
      files: [],
      contract: "ApprovalToken.verify(token, ctx) -> boolean",
      workUnits: [
        { footprint: ["src/approvalToken.ts"], execution: "fan-out" },
      ],
      satisfies: [1],
    },
    {
      handle: "TEP-6_SP-3_SL-2",
      status: "ready",
      requires: [],
      files: [],
      contract: "ReviewPanel.open(subjectKey) -> void",
      workUnits: [{ footprint: ["src/ReviewPanel.ts"], execution: "fan-out" }],
    },
  ]);
  const sl2 = dag.find((u) => u.slice === "TEP-6_SP-3_SL-2")!;
  const prompt = buildWorkerPrompt(sl2, "6/3");
  // SL-2's worker sees BOTH its own contract AND SL-1's (the union).
  assert.match(prompt, /ReviewPanel\.open/, "SL-2 sees its own contract");
  assert.match(
    prompt,
    /ApprovalToken\.verify/,
    "SL-2 sees SL-1's contract — cross-slice interface agreement",
  );
});

// ── a contract-defined slice's test unit needs no `consumes` (gate exempt) ─────
async function seededStore(spec: string): Promise<ThinkubeStore> {
  const ts = fs.mkdtempSync(path.join(os.tmpdir(), "tk-contract-"));
  const store = new ThinkubeStore(ts, ts);
  await store.writeFile(
    store.pathForSpecDoc(spec),
    { implements: "TEP-6", ac_verifications: { "1": { run: "npm test" } } },
    "# Demo\n\n## Acceptance Criteria\n\n- [ ] something\n",
  );
  return store;
}
const ctxFor = (store: ThinkubeStore) => ({
  env: {} as never,
  thinkingSpaces: { resolve: () => store } as never,
});
const create = async (store: ThinkubeStore, args: Record<string, unknown>) => {
  await armApprovalForSlicing(store, String(args.spec));
  return dispatchTool("create_slice", args, ctxFor(store), () => {});
};

const UNITS = [
  { footprint: ["src/gate.ts"], execution: "fan-out", note: "impl" },
  {
    footprint: ["src/acceptance/SP-6_3_AC-1.test.ts"],
    execution: "fan-out",
    role: "test",
    note: "held-out probe (drives the contract)",
  },
];

test("a multi-unit slice with NO contract is REFUSED — there is no no-contract fallback", async () => {
  const store = await seededStore("6/3");
  await assert.rejects(
    create(store, {
      spec: "6/3",
      title: "no contract",
      body: "detail",
      satisfies: [1],
      work_units: UNITS, // 2 units, no contract
    }),
    (err: unknown) => {
      const msg = (err as Error).message;
      assert.match(msg, /must declare a `contract`/i);
      return true;
    },
  );
});

test("WITH a contract, the same slice is accepted and the contract is stored in frontmatter", async () => {
  const store = await seededStore("6/3");
  const res = (await create(store, {
    spec: "6/3",
    title: "contract-defined slice",
    body: "detail",
    contract: CONTRACT,
    satisfies: [1],
    work_units: UNITS,
  })) as { slice: string; relativePath: string };
  assert.match(res.slice, /^TEP-6_SP-3_SL-\d+$/);

  const parsed = await store.getFile(res.relativePath);
  assert.equal(
    parsed?.frontmatter?.contract,
    CONTRACT,
    "the design-time contract round-trips into slice frontmatter",
  );
});
