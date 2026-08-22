// WHY (INVARIANT): the push payload must carry the recorded reason when the
// session holds a documentation exemption, or the rail cannot show what was
// said.
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
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac12-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac12-keys-")),
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

test("spacePush carries the reason text when the session holds a documentation exemption", () => {
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
  const reason = "internal-only change, nothing to document";
  const r = s.excuseDocs(reason);
  assert.equal(r.ok, true);
  const push = spacePush(s);
  const raw = JSON.stringify(push);
  assert.ok(
    raw.includes(reason),
    "spacePush must carry the recorded exemption reason in its payload",
  );
});
