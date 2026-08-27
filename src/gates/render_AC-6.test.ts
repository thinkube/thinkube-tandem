/**
 * TRANSITION — spacePush gains a documentation field: the rail must be
 * able to read the documentation verdict straight off the push, computed
 * from the one rule (docsDuty), rather than re-deriving it. This test's
 * job is done once spacePush carries that field for the pending cut.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "../surfaces/session";
import { spacePush } from "../surfaces/push";
import { docsDuty } from "../core/docsDuty";
import { emptySpace } from "../core/schema";

function freshSession(): TandemSession {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-session-"));
  return new TandemSession({
    round: { model: "test-model", repoRoot: base },
    storeDir: path.join(base, "store"),
    storageDir: path.join(base, ".local"),
    now: () => "2026-08-24T00:00:00Z",
    author: "t",
  });
}

test("spacePush carries a documentation field whose state and reason are exactly what docsDuty returns for the pending cut", () => {
  const s = freshSession();
  s.space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "add a helper with no doc page",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "helper() runs" }],
        grounding: { touchpoints: [{ path: "src/helper.ts", planned: true }], stamp: [] },
      },
    ],
  };
  s.cutNodeIds = new Set(["n1"]);

  const pendingCut = { id: `cut-${s.space.cuts.length + 1}`, changeIds: [...s.cutNodeIds] };
  const expected = docsDuty(s.space, pendingCut);

  const push = spacePush(s) as { documentation?: { state: string; landings: string[]; reason?: string } };
  assert.deepEqual(push.documentation, expected, "the push's documentation field is exactly docsDuty's verdict");
});
