// WHY (TRANSITION): the rail cannot show what was said, or that it was
// said at all, unless the push payload carries it — proves spacePush for a
// session holding a documentation exemption carries the reason text.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "../out-test/surfaces/session.js";
import { spacePush } from "../out-test/surfaces/panel.js";
import { emptySpace } from "../out-test/core/schema.js";

const CURRENT = { root: "/repo", head: "h1", dirty: "" };

function bareSession() {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac12-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac12-keys-")),
    now: () => "2026-08-20T10:00:00Z",
    author: "t",
    readCurrentStamp: async () => [CURRENT],
  });
}

test("spacePush for a session holding a documentation exemption carries the reason text", () => {
  const s = bareSession();
  const reason = "internal-only change, nothing to document for users";
  s.space = {
    ...emptySpace(),
    asks: [{ id: "ask-1", text: "add a tiny internal helper", at: "t" }],
    pendingDocException: { reason },
  };
  const push = spacePush(s);
  assert.ok(push.docsException, "the push must carry a docsException field when one is held");
  assert.equal(
    push.docsException.reason,
    reason,
    "the pushed exemption must carry the exact recorded reason text",
  );
});
