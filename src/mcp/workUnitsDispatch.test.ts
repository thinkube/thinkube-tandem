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

async function seededStore(spec = "demo"): Promise<ThinkubeStore> {
  const board = fs.mkdtempSync(path.join(os.tmpdir(), "tk-wu-board-"));
  const store = new ThinkubeStore(board, board);
  await store.writeFile(
    store.pathForSpecDoc(spec),
    { implements: "TEP-x" },
    "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n",
  );
  return store;
}

test("create_slice through the dispatcher persists work_units", async () => {
  const store = await seededStore();
  // Minimal HandlerContext: create_slice only touches ctx.boards.resolve.
  const ctx = {
    env: {} as never,
    boards: { resolve: () => store } as never,
  };

  const res = (await dispatchTool(
    "create_slice",
    {
      spec: "demo",
      title: "A multi-file component",
      body: "detail",
      work_units: [
        { footprint: ["a.yaml"], execution: "fan-out", note: "author a" },
        { footprint: ["b.yaml"], execution: "fan-out", note: "author b" },
      ],
    },
    ctx,
    () => {},
  )) as { slice: string };

  const m = /SP-([^_]+)_SL-(\d+)/.exec(res.slice)!;
  const parsed = await store.getFile(store.pathForSlice(m[1], Number(m[2])));
  const wu = parsed?.frontmatter?.work_units as
    | { footprint: string[]; execution: string; note?: string }[]
    | undefined;

  assert.equal(wu?.length, 2, "both work units must persist through the dispatcher");
  assert.deepEqual(wu![0].footprint, ["a.yaml"]);
  assert.equal(wu![0].execution, "fan-out");
  assert.equal(wu![0].note, "author a");
  assert.equal(wu![1].footprint[0], "b.yaml");
});
