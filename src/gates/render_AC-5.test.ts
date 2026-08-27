/**
 * INVARIANT — an empty or whitespace-only documentation exemption reason
 * is never enough to say "documentation is not needed here": a reason
 * that says nothing must always be refused, and no exemption may be
 * recorded from it, forever — otherwise the documentation rule can be
 * silently bypassed with a blank field.
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

test("a session refuses an empty or whitespace-only exemption reason and records no exemption", () => {
  const s = freshSession();
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

  const empty = s.exemptDocs("");
  assert.equal(empty.ok, false, "an empty reason is refused");

  const whitespace = s.exemptDocs("   \n\t  ");
  assert.equal(whitespace.ok, false, "a whitespace-only reason is refused");

  const signed = s.signCut();
  assert.equal(signed.ok, false, "with no landed docs and no valid exemption, signing is still refused");
  assert.match(signed.ok ? "" : signed.reason, /documentation/i);
});
