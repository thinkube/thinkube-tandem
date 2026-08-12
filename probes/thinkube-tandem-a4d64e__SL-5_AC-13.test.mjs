// WHY (INVARIANT): correcting the docblock must not narrow, widen, or
// retarget any of importSmoke.test.ts's five tests — only prose changes.
// This must keep holding: the five behavioural assertions (approvalStore
// round-trip, defectStats parsing, rtkRewrite rewriting, verificationRunnable
// naming, workerModel resolution) are the actual coverage; a docblock edit
// must never be a cover for silently changing what they check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const importSmokePath = path.join(repoRoot, "src", "engine", "importSmoke.test.ts");

const EXPECTED_ASSERTION_TARGETS = [
  /store\.get\("cut:TEP-user-1"\)/,
  /parseDefectLog\(raw\)/,
  /rtkRewrite\("git status"\)/,
  /verificationRunnable\(\{ run: "npm test" \}, state\)\.ok/,
  /resolveWorkerModel\(\{\}, "code"\)/,
];

test("importSmoke.test.ts keeps its five tests' original assertion targets, and npm test reports all five passing", () => {
  const text = fs.readFileSync(importSmokePath, "utf8");
  const testCount = (text.match(/^test\(/gm) ?? []).length;
  assert.equal(testCount, 5, "importSmoke.test.ts must still declare exactly five tests");
  for (const re of EXPECTED_ASSERTION_TARGETS) {
    assert.match(text, re, `importSmoke.test.ts must keep asserting against ${re}`);
  }

  let output;
  let failed = false;
  try {
    output = execFileSync("npm", ["test"], { cwd: repoRoot, encoding: "utf8", stdio: "pipe" });
  } catch (err) {
    failed = true;
    output = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
  }
  assert.equal(failed, false, `npm test must pass:\n${output}`);
});
