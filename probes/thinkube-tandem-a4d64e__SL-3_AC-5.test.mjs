// WHY (INVARIANT): the exemption reason is part of the content a signed
// TEP's dispatch approval is minted over. Editing that reason after
// signing must change tepContentHash, so tepApprovalOf reports the
// minted token no longer matches and dispatch refuses until the cut is
// signed again — the same re-arm discipline every other edit gets.
//
// Driven through TandemSession's public surface (session.signCut() mints
// the approval as part of signing, session.tepApproval() reports its
// verdict) rather than reaching into src/engine's token/store primitives
// directly — the session is this feature's public seam onto that
// machinery, and TEP-cmxela-12 does not ask this slice to touch the
// engine's mint/store internals.
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

test("editing the exemption reason on a signed cut changes tepContentHash and un-approves dispatch", () => {
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
  const tepId = session.space.cuts[0].tepId;

  const before = session.tepApproval(tepId);
  assert.equal(before.approved, true, "the freshly minted token matches the just-signed cut");

  session.space = {
    ...session.space,
    cuts: session.space.cuts.map((c) =>
      c.tepId === tepId
        ? { ...c, exemption: { ...c.exemption, reason: "a different reason, typed after signing" } }
        : c,
    ),
  };

  const after = session.tepApproval(tepId);
  assert.equal(after.approved, false, "the stale token no longer matches");
  assert.equal(after.reason, "content-mismatch");
});
