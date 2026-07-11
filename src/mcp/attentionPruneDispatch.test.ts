/**
 * move_slice → Ready hygiene (2026-07-11): returning a slice to Ready prunes
 * its resolved `## ⚑ Requires attention` block(s) + ⛔ markers (collapsed to
 * `attention_history`), clears the `escalated` hold and `last_fault`, and
 * resets `rework_attempts` — a hand-back restarts the bounded loop instead of
 * instantly re-escalating on the old counter. `last_evidence_hash` survives:
 * the same failure after a "fix" should trip the circuit breaker immediately.
 */
import "./installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { dispatchTool } from "./kanbanMcpServer";

const BODY = `# the slice title

Its own prose.

## ⚑ Requires attention

Closing gate: AC #5 red. Judged fault: gate — probe cannot run.

⛔ ESCALATED — bounded rework attempts exhausted`;

async function seeded() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-attn-prune-"));
  const store = new ThinkubeStore(dir, dir);
  await store.writeFile(
    store.pathForSlice("1/4", 1),
    {
      uid: "u",
      parent: "SP-4",
      status: "requires-attention",
      escalated: true,
      rework_attempts: 3,
      last_fault: "gate",
      last_evidence_hash: "abc123",
    },
    BODY,
  );
  return store;
}

const ctx = (store: ThinkubeStore) =>
  ({ env: {} as never, thinkingSpaces: { resolve: () => store } as never }) as never;
const ALLOW = () => {};

test("move_slice → Ready prunes attention artifacts and resets the bounded loop", async () => {
  const store = await seeded();
  await dispatchTool(
    "move_slice",
    { slice: "TEP-1_SP-4_SL-1", status: "Ready" },
    ctx(store),
    ALLOW,
  );
  const parsed = await store.getFile(store.pathForSlice("1/4", 1));
  const fm = parsed!.frontmatter!;
  assert.equal(fm.status, "ready");
  assert.equal(fm.escalated, undefined, "escalated hold cleared");
  assert.equal(fm.rework_attempts, undefined, "bounded loop restarted");
  assert.equal(fm.last_fault, undefined, "fault route cleared");
  assert.equal(fm.last_evidence_hash, "abc123", "circuit-breaker memory KEPT");
  const history = fm.attention_history as string[];
  assert.equal(history.length, 1);
  assert.match(history[0], /^\d{4}-\d{2}-\d{2}: Closing gate: AC #5 red/);
  assert.doesNotMatch(parsed!.body, /Requires attention/);
  assert.doesNotMatch(parsed!.body, /⛔/);
  assert.match(parsed!.body, /Its own prose\./);
});

test("move_slice → Doing does NOT prune (only the Ready hand-back does)", async () => {
  const store = await seeded();
  await dispatchTool(
    "move_slice",
    { slice: "TEP-1_SP-4_SL-1", status: "Doing" },
    ctx(store),
    ALLOW,
  );
  const parsed = await store.getFile(store.pathForSlice("1/4", 1));
  assert.match(parsed!.body, /Requires attention/);
  assert.equal(parsed!.frontmatter!.escalated, true);
});
