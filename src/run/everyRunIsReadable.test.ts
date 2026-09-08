/**
 * Every run a space has run is readable afterwards, not only the newest.
 *
 * The page that draws a run — what the workers did, what each step
 * logged, the pictures its reviewers took — is the page a person returns
 * to, to check a translation against last month's screenshot or to pull
 * one into the documentation. Reading only the last run put every earlier
 * cut's account out of reach the moment the next one started.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readRun, readRunOf, runsOnFile, saveRun } from "./record";
import { RunState } from "./state";

/** A space that has run three cuts, each leaving its own account. */
function threeRuns(): string {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-runs-"));
  ["cut-1", "cut-2", "cut-3"].forEach((cutId, i) => {
    const st = new RunState(() => {});
    st.seed(`u-${i}`, "slice", "code", [], `the promise of ${cutId}`, []);
    st.looked(`u-${i}`, [`/looks/${cutId}/1-what-it-saw.png`]);
    st.log(`${cutId}: the door opened`);
    st.log(`${cutId}: the gate closed`, "gate");
    saveRun(storeDir, { cutId, tepId: `TEP-${i + 1}`, at: `2026-09-0${i + 1}T00:00:00Z`, state: "done" } as never, st);
  });
  return storeDir;
}

test("a run from an earlier cut is read back whole, long after the next one ran", () => {
  const storeDir = threeRuns();
  const all = runsOnFile(storeDir);
  assert.deepEqual(all.map((r) => r.cutId), ["cut-3", "cut-2", "cut-1"], "every run is on file, newest first");

  const first = readRunOf(storeDir, "cut-1", () => {});
  assert.ok(first, "the first cut's run is still readable");
  const unit = [...first.state.units.values()][0];
  assert.equal(unit.id, "u-0", "with the workers it ran");
  assert.deepEqual(unit.looks, ["/looks/cut-1/1-what-it-saw.png"], "and the pictures they took");
  assert.ok(
    first.state.logs.some((l) => /cut-1: the door opened/.test(l)),
    `and what it said: ${first.state.logs.join(" · ")}`,
  );
  assert.equal(first.running, false, "a run that has ended is not running");
});

test("reading without naming a cut still gives the newest, as it always did", () => {
  const storeDir = threeRuns();
  const last = readRun(storeDir, () => {});
  assert.ok(last);
  assert.equal([...last.state.units.values()][0].id, "u-2");
});

test("a cut that never ran is nothing, not the newest run wearing its name", () => {
  assert.equal(readRunOf(threeRuns(), "cut-never", () => {}), undefined);
});
