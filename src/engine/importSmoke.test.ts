/**
 * Real-behavior smoke coverage for imported engine modules whose product
 * callers arrive in later surgery steps — each asserts the module's actual
 * contract, so reachability is earned, not waived.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createApprovalStore } from "./approvalStore";
import { parseDefectLog, typeByMonth, integrityList, TRIGGER_ORDER } from "./defectStats";
import { rtkRewrite } from "./rtkRewrite";
import { verificationRunnable, repoStateFromTsconfig } from "./verificationRunnable";
import { resolveWorkerModel } from "./workerModel";

test("approvalStore: put/get round-trip; unreadable ≡ absent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "appr-"));
  const store = createApprovalStore(dir);
  assert.equal(store.get("cut:TEP-user-1"), undefined);
  store.put("cut:TEP-user-1", "opaque.token");
  assert.equal(store.get("cut:TEP-user-1"), "opaque.token");
});

test("defectStats: rows parse fail-soft; integrity isolated; trigger order canonical", () => {
  const raw =
    JSON.stringify({ ts: "2026-08-01T00:00:00Z", spec: "1/1", activity: "gate", trigger: "preflight", type: "machinery", qualifier: "missing", impact: "prevented", detail: "d" }) +
    "\nnot json\n" +
    JSON.stringify({ ts: "2026-08-02T00:00:00Z", spec: "1/2", activity: "gate", trigger: "gate-verifier", type: "assignment", qualifier: "wrong", impact: "integrity", detail: "false green" });
  const { rows, parseErrors } = parseDefectLog(raw);
  assert.equal(rows.length, 2);
  assert.equal(parseErrors, 1);
  assert.equal(integrityList(rows).length, 1);
  assert.ok(typeByMonth(rows).size >= 1);
  assert.equal(TRIGGER_ORDER[0], "authoring-time audit");
});

test("rtkRewrite: simple listed commands rewritten; compound/pipelines untouched; idempotent", () => {
  assert.equal(rtkRewrite("git status"), "rtk git status");
  assert.equal(rtkRewrite("rtk git status"), undefined);
  assert.equal(rtkRewrite("git status && ls"), undefined);
  assert.equal(rtkRewrite("npm test"), undefined);
});

test("verificationRunnable: unregistered file-pinned target is named; suite commands impose nothing", () => {
  const state = repoStateFromTsconfig({ include: ["src/registered.test.ts"] });
  assert.equal(verificationRunnable({ run: "npm test" }, state).ok, true);
  const bad = verificationRunnable({ run: "node --test out-test/missing.test.js" }, state);
  assert.equal(bad.ok, false);
  assert.equal(verificationRunnable({ run: "node --test out-test/registered.test.js" }, state).ok, true);
});

test("workerModel: base sonnet, per-role override raises", () => {
  assert.equal(resolveWorkerModel({}, "code"), "sonnet");
  assert.equal(resolveWorkerModel({ workerModel: "haiku" }, "code"), "haiku");
  assert.equal(resolveWorkerModel({ workerModel: "sonnet", workerModelByRole: { judge: "opus" } }, "judge"), "opus");
});
