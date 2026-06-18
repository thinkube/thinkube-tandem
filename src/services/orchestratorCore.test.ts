/**
 * Unit tests for the orchestrator's pure core (SP-tgs8nz_SL-1) — the slice picker and the
 * stream-json parser. node:test + node:assert; run via `npm test`. The live spawn / verify
 * / advance is a human verdict (low AI-testability), not covered here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  pickNextSlice,
  pickFrontier,
  selectDisjoint,
  runWithConcurrency,
  batchExecutionUnits,
  StreamJsonBuffer,
  summarizeEvent,
  isResultSuccess,
  type SliceRow,
  type WorkUnit,
} from "./orchestratorCore";

test("pickNextSlice: first ready slice with all deps done is picked", () => {
  const rows: SliceRow[] = [
    { handle: "SP-1_SL-1", status: "done", dependsOn: [] },
    { handle: "SP-1_SL-2", status: "ready", dependsOn: ["SP-1_SL-1"] },
    { handle: "SP-1_SL-3", status: "ready", dependsOn: [] },
  ];
  assert.equal(pickNextSlice(rows), "SP-1_SL-2");
});

test("pickNextSlice: a ready slice with an unfinished dep is skipped", () => {
  const rows: SliceRow[] = [
    { handle: "SP-1_SL-1", status: "doing", dependsOn: [] },
    { handle: "SP-1_SL-2", status: "ready", dependsOn: ["SP-1_SL-1"] },
    { handle: "SP-1_SL-3", status: "ready", dependsOn: [] },
  ];
  // SL-2 blocked (dep doing); SL-3 free → SL-3.
  assert.equal(pickNextSlice(rows), "SP-1_SL-3");
});

test("pickNextSlice: a missing dep counts as not-done (blocks)", () => {
  const rows: SliceRow[] = [
    { handle: "SP-1_SL-2", status: "ready", dependsOn: ["SP-1_SL-99"] },
  ];
  assert.equal(pickNextSlice(rows), null);
});

test("pickNextSlice: nothing ready → null", () => {
  const rows: SliceRow[] = [
    { handle: "SP-1_SL-1", status: "done", dependsOn: [] },
    { handle: "SP-1_SL-2", status: "doing", dependsOn: [] },
  ];
  assert.equal(pickNextSlice(rows), null);
});

test("StreamJsonBuffer: reassembles lines split across chunks, skips blanks/garbage", () => {
  const b = new StreamJsonBuffer();
  assert.deepEqual(b.push('{"type":"sys'), []); // partial line held
  const evs = b.push(
    'tem","subtype":"init"}\n\nnot json\n{"type":"result","subtype":"success"}\n',
  );
  assert.equal(evs.length, 2);
  assert.equal(evs[0].type, "system");
  assert.equal(evs[1].type, "result");
});

test("StreamJsonBuffer: holds a trailing partial line until completed", () => {
  const b = new StreamJsonBuffer();
  assert.equal(b.push('{"type":"assistant"}\n{"type":"resu').length, 1);
  assert.equal(b.push('lt","subtype":"success"}\n').length, 1);
});

test("summarizeEvent: tool_use and text render; non-display events skip", () => {
  assert.equal(
    summarizeEvent({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Bash" }] },
    }),
    "▸ Bash",
  );
  assert.equal(
    summarizeEvent({ type: "user", message: { content: [] } }),
    null,
  );
  assert.equal(
    summarizeEvent({ type: "result", subtype: "success" }),
    "✓ result: success",
  );
});

test("isResultSuccess: success vs error", () => {
  assert.equal(isResultSuccess({ type: "result", subtype: "success" }), true);
  assert.equal(
    isResultSuccess({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
    }),
    false,
  );
  assert.equal(isResultSuccess({ type: "assistant" }), false);
});

test("pickFrontier: returns ALL dispatchable slices in order (not just the head)", () => {
  const rows: SliceRow[] = [
    { handle: "SP-1_SL-1", status: "done", dependsOn: [] },
    { handle: "SP-1_SL-2", status: "ready", dependsOn: ["SP-1_SL-1"] },
    { handle: "SP-1_SL-3", status: "ready", dependsOn: ["SP-1_SL-99"] }, // blocked
    { handle: "SP-1_SL-4", status: "ready", dependsOn: [] },
  ];
  assert.deepEqual(pickFrontier(rows), ["SP-1_SL-2", "SP-1_SL-4"]);
  assert.equal(pickNextSlice(rows), "SP-1_SL-2"); // still the head
});

test("selectDisjoint: skips a candidate whose footprint overlaps an earlier pick", () => {
  const picked = selectDisjoint([
    { handle: "A", footprint: ["src/a.ts"] },
    { handle: "B", footprint: ["src/a.ts", "src/b.ts"] }, // overlaps A
    { handle: "C", footprint: ["src/c.ts"] },
  ]);
  assert.deepEqual(picked, ["A", "C"]);
});

test("runWithConcurrency: never exceeds the cap, processes all, preserves order", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const worker = async (n: number) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setImmediate(r));
    inFlight--;
    return n * 2;
  };
  const out = await runWithConcurrency([0, 1, 2, 3, 4], 2, worker);
  assert.deepEqual(out, [0, 2, 4, 6, 8]);
  assert.ok(maxInFlight <= 2, `maxInFlight ${maxInFlight} should be ≤ 2`);
});

test("runWithConcurrency: cap floors to ≥1 and handles empty input", async () => {
  assert.deepEqual(await runWithConcurrency([], 4, async (x) => x), []);
  assert.deepEqual(
    await runWithConcurrency([1, 2], 0, async (x) => x * 10),
    [10, 20],
  );
});

test("batchExecutionUnits: serial units collapse to one; mechanize/fan-out stay separate", () => {
  const units: WorkUnit[] = [
    { footprint: ["a"], execution: "serial" },
    { footprint: ["b"], execution: "serial" },
    { footprint: ["c"], execution: "mechanize" },
    { footprint: ["d"], execution: "fan-out" },
    { footprint: ["e"], execution: "fan-out" },
  ];
  const eu = batchExecutionUnits(units);
  assert.equal(eu.length, 4); // 1 serial batch + 1 mechanize + 2 fan-out
  assert.equal(eu[0].shape, "serial");
  assert.equal(eu[0].units.length, 2);
  assert.deepEqual(eu.filter((u) => u.shape === "fan-out").length, 2);
});
