// WHY (INVARIANT): the push payload must carry no exemption field when the
// session holds none — otherwise the rail could not tell "nothing was said"
// from "something was said but is missing".
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "../out-test/surfaces/session.js";
import { spacePush } from "../out-test/surfaces/panel.js";

function bareSession() {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac13-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac13-keys-")),
    now: () => "2026-08-18T10:00:00Z",
    author: "t",
    readCurrentStamp: async () => [],
    knowledge: async () => ({
      repoRoot: "/repo",
      graph: { graphPath: "/g.json", stamp: { root: "/repo", head: "h", dirty: "" } },
      map: "",
      digest: "",
      provision: "",
      prepare: "",
      resetup: async () => ({ provision: "", prepare: "", runOne: "" }),
      proveSetup: () => {},
      decisions: [],
      ask: async () => "",
      affected: async () => "",
    }),
  });
}

test("spacePush carries no exemption field when the session holds none", () => {
  const s = bareSession();
  const push = spacePush(s);
  const raw = JSON.stringify(push);
  assert.ok(
    !/docsExemption|pendingDocsExemption/i.test(raw),
    "spacePush for a session with no exemption must carry no exemption field",
  );
});
