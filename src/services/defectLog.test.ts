/**
 * Unit tests for the ODC find-time defect log (TEP-22 mechanical half, context tranche):
 * `appendDefect` writes one JSONL line per entry to `defects/{YYYY-MM}.jsonl` (dir created
 * on demand, `ts` auto-filled) and is FAIL-SOFT — any write error returns false, never throws.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { appendDefect, defectLogPath } from "./defectLog";

test("appendDefect: creates defects/{YYYY-MM}.jsonl on demand and appends one JSON line per entry", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-defects-"));
  const ok1 = appendDefect(dir, {
    spec: "1/1",
    slice: "TEP-1_SP-1_SL-1",
    activity: "verification",
    trigger: "gate-verifier",
    type: "code",
    impact: "round lost",
    detail: "AC #2 red: assertion failed",
    refs: ["AC#2"],
  });
  const ok2 = appendDefect(dir, {
    spec: "1/1",
    activity: "dispatch",
    trigger: "preflight",
    impact: "prevented",
    detail: "parent TEP body unresolvable",
  });
  assert.equal(ok1, true);
  assert.equal(ok2, true);

  const file = defectLogPath(dir, new Date());
  const lines = fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].spec, "1/1");
  assert.equal(lines[0].trigger, "gate-verifier");
  assert.equal(lines[0].type, "code");
  assert.deepEqual(lines[0].refs, ["AC#2"]);
  assert.match(String(lines[0].ts), /^\d{4}-\d{2}-\d{2}T/); // ts auto-filled, ISO
  assert.equal(lines[1].trigger, "preflight");
  assert.equal(lines[1].impact, "prevented");
});

test("appendDefect: fail-soft — an unwritable destination returns false and never throws", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-defects-"));
  // Make `defects` an ordinary FILE so mkdir/append under it must fail.
  fs.writeFileSync(path.join(dir, "defects"), "not a dir", "utf8");
  const ok = appendDefect(dir, {
    spec: "1/1",
    activity: "dispatch",
    trigger: "preflight",
    impact: "prevented",
    detail: "x",
  });
  assert.equal(ok, false);
  // And a blank thinkubeDir is a quiet no-op too.
  assert.equal(
    appendDefect("", {
      spec: "1/1",
      activity: "a",
      trigger: "t",
      impact: "i",
      detail: "d",
    }),
    false,
  );
});
