// AC-5 (INVARIANT): declaring documentation not needed WITHOUT a reason
// must not actually waive the obligation — the cut stays required, because
// a waiver is only valid with a stated reason.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { TandemSession } = require("../out/surfaces/session.js");
const { renderCutScreen } = require("../out/gates/render.js");

function makeDeps() {
  return {
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    now: () => "2026-08-12T10:00:00Z",
    readCurrentStamp: async () => [],
  };
}

function withOnePromise(session) {
  session.space = {
    ...session.space,
    asks: [{ id: "ask-1", text: "add a CSV export button", at: "t" }],
    nodes: [
      {
        id: "node-1",
        sentence: "an export button downloads a CSV of the table",
        serves: ["ask-1"],
        needs: [],
        acceptance: [{ id: "c1", text: "a CSV file downloads" }],
        grounding: { touchpoints: [{ path: "src/table/export.ts" }], stamp: [] },
      },
    ],
  };
  session.toggleCut(["node-1"]);
}

test("declaring documentation not needed with an empty reason leaves the cut required", () => {
  const session = new TandemSession(makeDeps());
  withOnePromise(session);
  const r = session.waiveDocs("");
  assert.equal(r.ok, false, "an empty reason is refused, never silently accepted");

  const cut = { id: "cut-1", changeIds: [...session.cutNodeIds] };
  const screen = renderCutScreen(session.space, cut);
  assert.match(
    screen,
    /documentation.*required/i,
    "with no valid reason, the cut screen still reports documentation as required",
  );
});

test("declaring documentation not needed with a whitespace-only reason leaves the cut required", () => {
  const session = new TandemSession(makeDeps());
  withOnePromise(session);
  const r = session.waiveDocs("   ");
  assert.equal(r.ok, false, "a whitespace-only reason is refused");
});
