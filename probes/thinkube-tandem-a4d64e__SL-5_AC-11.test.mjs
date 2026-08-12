// WHY (TRANSITION): importSmoke.test.ts's docblock claimed defectStats,
// rtkRewrite, workerModel and approvalStore had product callers "arriving in
// later surgery steps" — those callers now exist (src/extension.ts,
// src/run/worker.ts, src/surfaces/sessionDeps.ts and src/gates/approval.ts /
// src/surfaces/session.ts respectively), so the docblock must stop claiming
// their product callers are still pending. Its job is done once the stale
// claim is removed.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const importSmokePath = path.join(repoRoot, "src", "engine", "importSmoke.test.ts");

test("importSmoke.test.ts's docblock no longer claims a pending product caller for the four now-wired modules", () => {
  const text = fs.readFileSync(importSmokePath, "utf8");
  const docblockMatch = text.match(/\/\*\*[\s\S]*?\*\//);
  assert.ok(docblockMatch, "importSmoke.test.ts must open with a docblock");
  const docblock = docblockMatch[0];

  assert.ok(
    !/product callers?\s+(whose|arrive|arriving).*later surgery/i.test(docblock),
    "the docblock must not claim modules' product callers are still pending in a later surgery step",
  );
  for (const mod of ["defectStats", "rtkRewrite", "workerModel", "approvalStore"]) {
    assert.ok(
      !new RegExp(`${mod}[\\s\\S]{0,80}(pending|later|arrive)`, "i").test(docblock),
      `the docblock must not claim ${mod} still has a pending product caller`,
    );
  }
});
