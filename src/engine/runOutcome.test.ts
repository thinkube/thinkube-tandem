/**
 * What became of a defect, not only that it was found.
 *
 * A row is written the moment something surfaces and never touched again,
 * so three quarters of the ledger is silent about whether the thing was
 * repaired before the person ever saw it. That silence hides the number
 * the methodology most needs: not how many defects there were, but how
 * many the machine healed by itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fateOf, fates, readRunOutcome, saveRunOutcome, slicesOf, type RunOutcome } from "./runOutcome";

const store = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "tandem-fate-"));

const ran = (over: Partial<RunOutcome> = {}): RunOutcome => ({
  run: "TEP-1@abc",
  cutId: "cut-1",
  at: "2026-09-08T10:00:00Z",
  state: "delivered",
  slices: { "slice-a": "done", "slice-b": "not done" },
  ...over,
});

test("a run's ending outlives the space it ran in", () => {
  const dir = store();
  assert.equal(saveRunOutcome(dir, ran()), true);
  assert.deepEqual(readRunOutcome(dir, "TEP-1@abc")?.slices, { "slice-a": "done", "slice-b": "not done" });
  assert.equal(readRunOutcome(dir, "never-ran"), undefined, "a run nobody wrote down is nothing, not a guess");
  // It is kept beside the ledger, which is what makes it survive.
  assert.ok(fs.existsSync(path.join(dir, "defects", "outcomes", "TEP-1@abc.json")));
});

test("a row that already says it was repaired needs no join", () => {
  assert.equal(fateOf({ impact: "the author repaired its own work" } as never), "healed");
  assert.equal(fateOf({ impact: "the closer could not finish it either" } as never), "reached the person");
});

test("otherwise the slice it was found in answers", () => {
  const o = ran();
  assert.equal(fateOf({ impact: "acceptance check red", slice: "slice-a" } as never, o), "healed");
  assert.equal(fateOf({ impact: "acceptance check red", slice: "slice-b" } as never, o), "reached the person");
});

test("a run that never built anything healed nothing", () => {
  assert.equal(fateOf({ impact: "round lost", slice: "slice-a" } as never, ran({ state: "refused" })), "reached the person");
  assert.equal(fateOf({ impact: "round lost", slice: "slice-a" } as never, ran({ state: "halted" })), "reached the person");
});

test("with no slice, the run's own ending answers", () => {
  assert.equal(fateOf({ impact: "round lost" } as never, ran({ state: "delivered" })), "healed");
  assert.equal(fateOf({ impact: "round lost" } as never, ran({ state: "withheld" })), "reached the person");
});

test("a run still going, or one never written down, stays unknown", () => {
  assert.equal(fateOf({ impact: "round lost" } as never, ran({ state: "running" })), "unknown");
  assert.equal(fateOf({ impact: "round lost" } as never, undefined), "unknown", "silence, not a flattering guess");
});

test("a slice is done only when every worker of it is", () => {
  assert.deepEqual(
    slicesOf([
      { slice: "a", state: "done" },
      { slice: "a", state: "done" },
      { slice: "b", state: "done" },
      { slice: "b", state: "failed" },
    ]),
    { a: "done", b: "not done" },
  );
});

test("the whole ledger reads back with what became of each row", () => {
  const dir = store();
  saveRunOutcome(dir, ran());
  const tally = fates(dir, [
    { run: "TEP-1@abc", impact: "acceptance check red", slice: "slice-a" },
    { run: "TEP-1@abc", impact: "acceptance check red", slice: "slice-b" },
    { run: "TEP-1@abc", impact: "the author repaired its own work" },
    { run: "no-outcome-for-this", impact: "round lost" },
  ] as never);
  assert.deepEqual(tally, { healed: 2, "reached the person": 1, unknown: 1 });
});
