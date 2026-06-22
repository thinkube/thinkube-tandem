/**
 * Handler-level tests for tags through the board tools (SP-tgvil2_SL-2).
 *
 * These exercise the REAL MCP handlers (`createSlice`/`updateSlice`/`listBoard`/
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
  listBoard,
  writeTep,
  aggregateTagsAcrossBoards,
} from "./kanbanMcpServer";

/** A tmp board dir seeded with one Spec that has acceptance criteria. */
async function seededStore(spec = "demo"): Promise<ThinkubeStore> {
  const board = fs.mkdtempSync(path.join(os.tmpdir(), "tk-tags-board-"));
  const store = new ThinkubeStore(board, board);
  await store.writeFile(
    store.pathForSpecDoc(spec),
    { implements: "TEP-x", ac_verifications: { "1": { run: "npm test" } } },
    "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n",
  );
  return store;
}

/** Read a slice's persisted frontmatter (what `get_slice` returns). */
async function sliceFm(store: ThinkubeStore, handle: string) {
  const m = /SP-([^_]+)_SL-(\d+)/.exec(handle)!;
  const parsed = await store.getFile(store.pathForSlice(m[1], Number(m[2])));
  return parsed?.frontmatter;
}

/** Find a slice card in a list_board projection. */
function cardFor(
  board: unknown,
  handle: string,
): { tags?: string[] } | undefined {
  const cols = (
    board as { columns: { cards: { id: string; tags?: string[] }[] }[] }
  ).columns;
  for (const col of cols) {
    const hit = col.cards.find((c) => c.id === handle);
    if (hit) return hit;
  }
  return undefined;
}

test("create_slice persists tags; they appear in get_slice and on the list_board card", async () => {
  const store = await seededStore();
  const res = (await createSlice(store, {
    spec: "demo",
    title: "A tagged slice",
    body: "detail",
    tags: ["security", "inference"],
  })) as { slice: string };

  // get_slice equivalent — persisted frontmatter carries the tags.
  assert.deepEqual((await sliceFm(store, res.slice))?.tags, [
    "security",
    "inference",
  ]);

  // list_board card carries the (effective) tags.
  const card = cardFor(await listBoard(store), res.slice);
  assert.deepEqual(card?.tags, ["security", "inference"]);
});

test("update_slice replaces tags; omitting them leaves tags unchanged", async () => {
  const store = await seededStore();
  const res = (await createSlice(store, {
    spec: "demo",
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

test("list_board card folds a legacy `theme` into the card tags (back-compat)", async () => {
  const store = await seededStore();
  const res = (await createSlice(store, {
    spec: "demo",
    title: "Slice with a legacy theme",
    body: "detail",
  })) as { slice: string };
  // Stamp a legacy `theme` directly (no tool sets it anymore).
  const m = /SP-([^_]+)_SL-(\d+)/.exec(res.slice)!;
  const rel = store.pathForSlice(m[1], Number(m[2]));
  const parsed = await store.getFile(rel);
  await store.writeFile(
    rel,
    { ...parsed!.frontmatter, theme: "legacy" },
    parsed!.body,
  );

  const card = cardFor(await listBoard(store), res.slice);
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

test("list_tags aggregates tagged items across boards (SL-3, AC3+AC4)", async () => {
  const a = await seededStore("aaa");
  const b = await seededStore("bbb");
  await createSlice(a, {
    spec: "aaa",
    title: "A slice",
    body: "d",
    tags: ["security", "auth"],
  });
  await createSlice(b, {
    spec: "bbb",
    title: "B slice",
    body: "d",
    tags: ["security"],
  });
  await writeTep(a, { tep: "atep", tags: ["security"] });

  const agg = await aggregateTagsAcrossBoards([
    { boardId: "board-a", store: a },
    { boardId: "board-b", store: b },
  ]);

  const security = agg.find((t) => t.tag === "security");
  assert.equal(security?.count, 3); // 2 slices + 1 tep
  // cross-board: items come from both boards
  const boards = new Set(security?.items.map((i) => i.board));
  assert.ok(boards.has("board-a") && boards.has("board-b"));
  // an item with N tags appears under all N
  assert.equal(agg.find((t) => t.tag === "auth")?.count, 1);
  // tags are sorted
  assert.deepEqual(
    agg.map((t) => t.tag),
    [...agg.map((t) => t.tag)].sort((x, y) => x.localeCompare(y)),
  );
});
