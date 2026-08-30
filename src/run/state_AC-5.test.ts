/**
 * TRANSITION — sliceChecks is a new field on the run record: saveRun must
 * write it to disk alongside the units and logs, and RunState.from must
 * restore it into view() — otherwise a window reopened after the run ends
 * would show every slice as ungraded, even one this run actually graded.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { RunState } from "./state";
import { saveRun, readRun } from "./record";

test("saveRun writes sliceChecks into the run record and RunState.from restores them", () => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-run-record-"));
  const st = new RunState(() => {});
  st.seed("SL-1#eu-1", "SL-1", "code");
  st.gradeSlice("SL-1", [
    { ac: 1, pass: true },
    { ac: 2, pass: false, text: "the check that did not pass" },
  ]);

  saveRun(storeDir, { cutId: "cut-1", at: new Date().toISOString(), state: "delivered" }, st);

  const reopened = readRun(storeDir, () => {});
  assert.ok(reopened, "the run record must be read back");
  assert.deepEqual(
    reopened.state.view().sliceChecks["SL-1"],
    [
      { ac: 1, pass: true },
      { ac: 2, pass: false, text: "the check that did not pass" },
    ],
    "the restored view carries the same per-slice grading the live run held",
  );
});
