// WHY (TRANSITION): the session needs a gesture that records a documentation
// exemption's reason, and the cut review it renders afterwards must carry
// that reason — proves the human's typed words survive from the gesture to
// the page they read before signing.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "../out-test/surfaces/session.js";
import { emptySpace } from "../out-test/core/schema.js";

const CURRENT = { root: "/repo", head: "h1", dirty: "" };

function bareSession() {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac4-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac4-keys-")),
    now: () => "2026-08-20T10:00:00Z",
    author: "t",
    readCurrentStamp: async () => [CURRENT],
  });
}

test("the session gesture that excuses documentation records the reason and the cut review carries it", () => {
  const s = bareSession();
  s.space = {
    ...emptySpace(),
    asks: [{ id: "ask-1", text: "add a tiny internal helper", at: "t" }],
    nodes: [
      {
        id: "n1",
        sentence: "a helper that trims whitespace",
        serves: ["ask-1"],
        needs: [],
        grounding: { touchpoints: [{ path: "src/core/trim.ts" }], stamp: [CURRENT] },
        acceptance: [{ id: "c1", text: "trims leading and trailing space" }],
      },
    ],
  };
  s.cutNodeIds = new Set(["n1"]);

  const reason = "internal-only change, nothing to document for users";
  const r = s.excuseDocs(reason);
  assert.ok(r.ok, `excusing documentation with a real reason must succeed: ${r.reason ?? ""}`);

  const screen = s.cutScreen();
  assert.ok(
    screen.includes(reason),
    "the cut review rendered after excusing documentation must carry the recorded reason",
  );
});
