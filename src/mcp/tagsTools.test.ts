/**
 * Handler-level tests for tags through the thinking space tools (SP-tgvil2_SL-2).
 *
 * These exercise the REAL MCP handlers (`createSlice`/`updateSlice`/`listThinkingSpace`/
 * `writeTep`) against a real `ThinkubeStore` on a tmp sidecar — the
 * installVscodeStub pattern: importing the stub FIRST redirects `require('vscode')`
 * so `ThinkubeStore` (and the server module) load outside the extension host.
 * `kanbanMcpServer`'s `main()` is guarded by `require.main === module`, so this
 * import does not boot the stdio server.
 */
import "./installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import {
  createSlice,
  updateSlice,
  listThinkingSpace,
  writeTep,
  aggregateTagsAcrossThinkingSpaces,
} from "./kanbanMcpServer";
import { armApprovalForSlicing } from "./approvalGateTestSupport";

/**
 * A tmp thinking space dir seeded with one Spec that has acceptance criteria. The spec id
 * is the org-scoped composite `<tep>/<spec>` (numeric, so the slice handle/path
 * regexes resolve); defaults to `"1/1"`.
 */
async function seededStore(spec = "1/1"): Promise<ThinkubeStore> {
  const thinkingSpace = fs.mkdtempSync(
    path.join(os.tmpdir(), "tk-tags-thinking space-"),
  );
  const store = new ThinkubeStore(thinkingSpace, thinkingSpace);
  await store.writeFile(
    store.pathForSpecDoc(spec),
    { implements: "TEP-x", ac_verifications: { "1": { run: "npm test" } } },
    "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n",
  );
  return store;
}

/** Read a slice's persisted frontmatter (what `get_slice` returns). The handle
 *  is the tep-qualified `TEP-<tep>_SP-<spec>_SL-<k>` flattening. */
async function sliceFm(store: ThinkubeStore, handle: string) {
  const m = /TEP-(\d+)_SP-(\d+)_SL-(\d+)/.exec(handle)!;
  const parsed = await store.getFile(
    store.pathForSlice(`${m[1]}/${m[2]}`, Number(m[3])),
  );
  return parsed?.frontmatter;
}

/** Find a slice card in a list_thinking_space projection. */
function cardFor(
  thinkingSpace: unknown,
  handle: string,
): { tags?: string[] } | undefined {
  const cols = (
    thinkingSpace as { columns: { cards: { id: string; tags?: string[] }[] }[] }
  ).columns;
  for (const col of cols) {
    const hit = col.cards.find((c) => c.id === handle);
    if (hit) return hit;
  }
  return undefined;
}

test("create_slice persists tags; they appear in get_slice and on the list_thinking_space card", async () => {
  const store = await seededStore();
  await armApprovalForSlicing(store, "1/1");
  const res = (await createSlice(store, {
    spec: "1/1",
    title: "A tagged slice",
    body: "detail",
    tags: ["security", "inference"],
  })) as { slice: string };

  // get_slice equivalent — persisted frontmatter carries the tags.
  assert.deepEqual((await sliceFm(store, res.slice))?.tags, [
    "security",
    "inference",
  ]);

  // list_thinking_space card carries the (effective) tags.
  const card = cardFor(await listThinkingSpace(store), res.slice);
  assert.deepEqual(card?.tags, ["security", "inference"]);
});

test("update_slice replaces tags; omitting them leaves tags unchanged", async () => {
  const store = await seededStore();
  await armApprovalForSlicing(store, "1/1");
  const res = (await createSlice(store, {
    spec: "1/1",
    title: "Slice to retag",
    body: "detail",
    tags: ["old"],
  })) as { slice: string };

  // Body-only update (no tags arg) leaves tags intact.
  await updateSlice(store, res.slice, "# Slice to retag\n\nnew detail\n");
  assert.deepEqual((await sliceFm(store, res.slice))?.tags, ["old"]);

  // Providing tags replaces them.
  await updateSlice(store, res.slice, "# Slice to retag\n\nnew detail\n", [
    "new",
    "fresh",
  ]);
  assert.deepEqual((await sliceFm(store, res.slice))?.tags, ["new", "fresh"]);
});

test("list_thinking_space card folds a legacy `theme` into the card tags (back-compat)", async () => {
  const store = await seededStore();
  await armApprovalForSlicing(store, "1/1");
  const res = (await createSlice(store, {
    spec: "1/1",
    title: "Slice with a legacy theme",
    body: "detail",
  })) as { slice: string };
  // Stamp a legacy `theme` directly (no tool sets it anymore).
  const m = /TEP-(\d+)_SP-(\d+)_SL-(\d+)/.exec(res.slice)!;
  const rel = store.pathForSlice(`${m[1]}/${m[2]}`, Number(m[3]));
  const parsed = await store.getFile(rel);
  await store.writeFile(
    rel,
    { ...parsed!.frontmatter, theme: "legacy" },
    parsed!.body,
  );

  const card = cardFor(await listThinkingSpace(store), res.slice);
  assert.deepEqual(card?.tags, ["legacy"]);
});

test("write_tep persists tags on the TEP frontmatter", async () => {
  const store = await seededStore();
  const res = (await writeTep(store, {
    tep: "demotep",
    title: "Tagged TEP",
    tags: ["platform"],
  })) as { tep: string };
  const parsed = await store.getFile(store.pathForTep("demotep"));
  assert.equal(res.tep, "TEP-demotep");
  assert.deepEqual(parsed?.frontmatter?.tags, ["platform"]);
});

test("list_tags aggregates tagged items across thinkingSpaces (SL-3, AC3+AC4)", async () => {
  const a = await seededStore("1/1");
  const b = await seededStore("2/1");
  await armApprovalForSlicing(a, "1/1");
  await createSlice(a, {
    spec: "1/1",
    title: "A slice",
    body: "d",
    tags: ["security", "auth"],
  });
  await armApprovalForSlicing(b, "2/1");
  await createSlice(b, {
    spec: "2/1",
    title: "B slice",
    body: "d",
    tags: ["security"],
  });
  await writeTep(a, { tep: "atep", tags: ["security"] });

  const agg = await aggregateTagsAcrossThinkingSpaces([
    { thinkingSpaceId: "thinking-space-a", store: a },
    { thinkingSpaceId: "thinking-space-b", store: b },
  ]);

  const security = agg.find((t) => t.tag === "security");
  assert.equal(security?.count, 3); // 2 slices + 1 tep
  // cross-thinking space: items come from both thinkingSpaces
  const thinkingSpaces = new Set(security?.items.map((i) => i.thinking_space));
  assert.ok(
    thinkingSpaces.has("thinking-space-a") &&
      thinkingSpaces.has("thinking-space-b"),
  );
  // an item with N tags appears under all N
  assert.equal(agg.find((t) => t.tag === "auth")?.count, 1);
  // tags are sorted
  assert.deepEqual(
    agg.map((t) => t.tag),
    [...agg.map((t) => t.tag)].sort((x, y) => x.localeCompare(y)),
  );
});
