/**
 * Regression test (SP-tgs8gb): a `create_slice` TOOL CALL — i.e. through `dispatchTool`,
 * the layer the live MCP server actually runs — must persist `work_units`.
 *
 * The bug this guards: the dispatcher built the `createSlice` args object and forwarded
 * depends_on / files / satisfies / … but NOT `work_units`, so every created slice silently
 * lost its units (the param was in the schema and `createSlice` could serialize it, but the
 * two were never wired). The existing tests called `createSlice()` *directly*, bypassing the
 * dispatcher, so the gap was invisible. This test drives `dispatchTool` so it can't happen
 * again.
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
    path.join(os.tmpdir(), "tk-wu-thinking space-"),
  );
  const store = new ThinkubeStore(thinkingSpace, thinkingSpace);
  await store.writeFile(
    store.pathForSpecDoc(spec),
    { implements: "TEP-x", ac_verifications: { "1": { run: "npm test" } } },
    "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n",
  );
  return store;
}

test("create_slice through the dispatcher persists work_units", async () => {
  const store = await seededStore();
  // Minimal HandlerContext: create_slice only touches ctx.thinkingSpaces.resolve.
  const ctx = {
    env: {} as never,
    thinkingSpaces: { resolve: () => store } as never,
  };

  await armApprovalForSlicing(store, "1/1");
  const res = (await dispatchTool(
    "create_slice",
    {
      spec: "1/1",
      title: "A multi-file component",
      body: "detail",
      // SP-6/3: a multi-unit slice requires a design-time contract.
      contract: "interface Contract { /* shared seam */ }",
      work_units: [
        // One coder per slice (2026-07-08): one code unit + a test-role sibling.
        { footprint: ["a.yaml"], execution: "fan-out", note: "author a" },
        {
          footprint: ["a.test.ts"],
          execution: "fan-out",
          role: "test",
          note: "assert a",
        },
      ],
    },
    ctx,
    () => {},
  )) as { slice: string };

  const m = /TEP-([^_]+)_SP-([^_]+)_SL-(\d+)/.exec(res.slice)!;
  const parsed = await store.getFile(
    store.pathForSlice(`${m[1]}/${m[2]}`, Number(m[3])),
  );
  const wu = parsed?.frontmatter?.work_units as
    { footprint: string[]; execution: string; note?: string }[] | undefined;

  assert.equal(
    wu?.length,
    2,
    "both work units must persist through the dispatcher",
  );
  assert.deepEqual(wu![0].footprint, ["a.yaml"]);
  assert.equal(wu![0].execution, "fan-out");
  assert.equal(wu![0].note, "author a");
  assert.equal(wu![1].footprint[0], "a.test.ts");
});
