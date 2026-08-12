// AC-4 (INVARIANT): the build section of the session's pushed state shows
// the cut's documentation decision, and the session offers a gesture that
// declares documentation not needed — the capability must be reachable
// through the public session surface a host uses to build the UI.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { TandemSession } = require("../out/surfaces/session.js");

function makeDeps() {
  return {
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    now: () => "2026-08-12T10:00:00Z",
    readCurrentStamp: async () => [],
  };
}

test("the session offers a way to declare a cut's documentation not needed", async () => {
  const session = new TandemSession(makeDeps());
  // The declaration gesture exists on the public session surface, taking a
  // cut id and a reason — the door the surface (Rail/panel) presses through.
  assert.equal(
    typeof session.waiveDocs,
    "function",
    "the session exposes a way to declare documentation not needed",
  );
});

test("the cut screen (what the build section is built from) names the documentation decision", () => {
  const session = new TandemSession(makeDeps());
  session.space = {
    ...session.space,
    asks: [{ id: "ask-1", text: "add a retry button to failed uploads", at: "t" }],
  };
  const added = {
    id: "node-1",
    sentence: "a retry button appears beside a failed upload",
    serves: ["ask-1"],
    needs: [],
    acceptance: [{ id: "c1", text: "the button retries the upload" }],
    grounding: { touchpoints: [{ path: "src/uploads/retry.ts" }], stamp: [] },
  };
  session.space = { ...session.space, nodes: [added] };
  session.toggleCut(["node-1"]);
  const screen = session.cutScreen();
  assert.match(screen, /documentation/i, "the cut screen names the documentation decision");
});
