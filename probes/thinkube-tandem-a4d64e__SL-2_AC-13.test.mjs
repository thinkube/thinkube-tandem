// WHY (INVARIANT): a session with no documentation exemption must never
// carry an exemption field in its push — this holds forever, so the rail
// cannot mistake absence for an unexplained empty exemption.
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
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac13-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac13-keys-")),
    now: () => "2026-08-20T10:00:00Z",
    author: "t",
    readCurrentStamp: async () => [CURRENT],
  });
}

test("spacePush for a session with no exemption carries no exemption field", () => {
  const s = bareSession();
  s.space = {
    ...emptySpace(),
    asks: [{ id: "ask-1", text: "add a tiny internal helper", at: "t" }],
  };
  const push = spacePush(s);
  assert.equal(
    push.docsException,
    undefined,
    "the push must carry no exemption field when the session holds none",
  );
});
