/**
 * TRANSITION — the session gains exemptDocs(reason): recording a
 * documentation exemption before signing must land on the cut that gets
 * signed, carrying exactly the reason the person gave. This test's job is
 * done once that plumbing exists between session.exemptDocs and
 * signCutGesture.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "../surfaces/session";
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

test("a session given a documentation exemption reason signs a cut whose docsExemption carries exactly that reason", () => {
  const s = freshSession();
  const REASON = "this cut only touches internal tooling that ships no doc page";
  s.space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "add an internal tooling helper",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "helper() runs" }],
        grounding: { touchpoints: [{ path: "src/tooling/helper.ts", planned: true }], stamp: [] },
      },
    ],
  };
  s.cutNodeIds = new Set(["n1"]);

  const exempted = s.exemptDocs(REASON);
  assert.equal(exempted.ok, true, exempted.ok ? "" : exempted.reason);

  const signed = s.signCut();
  assert.equal(signed.ok, true, signed.ok ? "" : signed.reason);

  const cut = s.space.cuts.at(-1) as unknown as { docsExemption?: { reason: string } };
  assert.equal(cut?.docsExemption?.reason, REASON, "the signed cut carries exactly the reason given");
});
