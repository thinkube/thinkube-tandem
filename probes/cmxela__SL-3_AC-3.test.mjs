// WHY (INVARIANT): the exemption is spent on the one cut it excused — after
// the session signs a cut carrying a pending documentation exemption, the
// session must hold no exemption for whatever cut comes next, so a reason
// typed for one cut can never silently excuse a later, unrelated one.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "../out-test/surfaces/session.js";

function bareSession() {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sl3-ac3-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sl3-ac3-keys-")),
    now: () => "2026-08-22T00:00:00.000Z",
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

test("after the session signs a cut carrying an exemption, the session holds no exemption for the next cut", () => {
  const s = bareSession();
  s.space = {
    ...s.space,
    nodes: [
      {
        id: "n1",
        sentence: "the widget resizes",
        serves: [],
        needs: [],
        grounding: { touchpoints: [{ path: "src/widget.ts" }], stamp: [] },
        acceptance: [{ id: "c1", text: "it resizes", kind: "probe" }],
      },
    ],
  };
  s.cutNodeIds = new Set(["n1"]);
  const excused = s.excuseDocs("internal-only change; nothing for a reader to consult");
  assert.equal(excused.ok, true);
  const signed = s.signCut();
  assert.equal(signed.ok, true, "the cut carrying the exemption must be signable");

  assert.ok(
    !s.space.pendingDocsExemption,
    "the session must hold no pending documentation exemption once its cut is signed",
  );
});
