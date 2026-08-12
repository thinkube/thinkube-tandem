// AC-9 (INVARIANT): once a signed cut's documentation decision changes,
// the approval token no longer matches the cut's content — executeRun must
// refuse with the approval reason and ask for a re-sign rather than
// starting the build on a stale approval.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { TandemSession } = require("../out/surfaces/session.js");
const { executeRun } = require("../out/surfaces/runGate.js");

function makeDeps() {
  return {
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    now: () => "2026-08-12T10:00:00Z",
    readCurrentStamp: async () => [],
    forge: { merge: async () => {} }, // present so the run reaches the approval check
  };
}

test("changing a signed cut's documentation decision refuses the run and asks for a re-sign", async () => {
  const session = new TandemSession(makeDeps());
  session.space = {
    ...session.space,
    asks: [{ id: "ask-1", text: "add a dark mode toggle", at: "t" }],
    nodes: [
      {
        id: "node-1",
        sentence: "a toggle in settings switches to dark mode",
        serves: ["ask-1"],
        needs: [],
        acceptance: [{ id: "c1", text: "the toggle switches themes" }],
        grounding: { touchpoints: [{ path: "src/theme/toggle.ts" }], stamp: [] },
      },
    ],
  };
  session.toggleCut(["node-1"]);
  const signed = session.signCut();
  assert.ok(signed.ok, "the cut signs cleanly with documentation required and undecided");

  const cut = session.space.cuts[0];
  // The documentation decision changes after signing: a waiver appears
  // where there was none at the moment of the click.
  session.space = {
    ...session.space,
    cuts: session.space.cuts.map((c) =>
      c.id === cut.id ? { ...c, docs: { waived: true, reason: "decided post-hoc it needs no docs" } } : c,
    ),
  };

  const outcome = await executeRun(session, cut.id);
  assert.equal(outcome, undefined, "the run does not start on a stale approval");
  assert.match(session.runNote ?? "", /re-sign/i, "the refusal asks for a re-sign");
});
