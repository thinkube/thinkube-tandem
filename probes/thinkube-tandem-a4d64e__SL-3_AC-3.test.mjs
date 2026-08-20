// WHY (INVARIANT): the exemption is spent on the one cut it excuses. Once
// the session signs a cut carrying a pending exemption, that exemption
// must not silently carry forward and excuse the next cut too — each cut
// stands on its own documentation obligation unless a person excuses it
// again.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TandemSession } from "../out-test/surfaces/session.js";

function makeDeps() {
  return {
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    name: async () => [],
    now: () => "2026-08-20T09:00:00Z",
    readCurrentStamp: async () => [],
    knowledge: async () => ({
      repoRoot: "/repo",
      graph: { graphPath: "/graph.json", stamp: { root: "/repo", head: "h", dirty: "" } },
      map: "",
      digest: "",
      provision: "", prepare: "", runOne: "", suiteReds: [], rememberSuiteReds: () => {},
      resetup: async () => ({ provision: "", prepare: "", runOne: "" }), proveSetup: () => {},
      decisions: [],
      ask: async () => "",
      affected: async () => "",
    }),
    classify: async () => "ask",
    solveModel: async (_d, texts) => ({
      subjects: texts.map((t, i) => ({ name: t, from: [i + 1], claims: [{ text: t, from: i + 1 }] })),
      rules: [],
    }),
    ground: async () => ({ changes: [], questions: [] }),
  };
}

test("after signing a cut carrying an exemption, the session holds no exemption for the next cut", () => {
  const session = new TandemSession(makeDeps());
  session.space = {
    ...session.space,
    asks: [{ id: "ask-1", text: "ship a change with no documentation", at: "t" }],
    nodes: [
      {
        id: "node-1",
        sentence: "a change that lands only in code",
        serves: ["ask-1"],
        needs: [],
        acceptance: [{ id: "c1", text: "it works" }],
        grounding: { touchpoints: [{ path: "src/thing.ts" }], stamp: [] },
      },
    ],
  };
  session.cutNodeIds = new Set(["node-1"]);
  session.docsExemption = { reason: "config-only change; nothing to document" };

  const r = session.signCut();
  assert.ok(r.ok, r.ok ? "" : r.reason);
  assert.ok(session.space.cuts[0].exemption, "the exemption rode onto the signed cut");
  assert.equal(
    session.docsExemption,
    undefined,
    "the session holds no exemption once it has been spent on the signed cut",
  );
});
