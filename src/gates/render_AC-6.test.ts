/**
 * What the person wrote at the moment of signing must reach the signed
 * record, not just the screen they read before clicking — otherwise the
 * reason lives only in memory and the TEP the signature mints says
 * nothing about why documentation was skipped.
 *
 * STANDING INVARIANT — signCutGesture writes the session's recorded
 * docsNotNeeded reason onto the cut it signs onto the space.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession, SessionDeps } from "../surfaces/session";
import { signCutGesture } from "../surfaces/runGate";

function fakeDeps(dir: string): SessionDeps {
  return {
    round: { model: "fake-model", repoRoot: dir },
    storeDir: path.join(dir, "store"),
    storageDir: path.join(dir, "storage"),
    now: () => "2026-08-24T00:00:00Z",
    author: "t",
  };
}

test("signCutGesture records the session's reason on the cut it signs onto the space", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-signgesture-"));
  const session = new TandemSession(fakeDeps(dir));
  session.space = {
    ...session.space,
    nodes: [
      {
        id: "n1",
        sentence: "rename an internal helper",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "the build still passes" }],
        grounding: { touchpoints: [{ path: "src/helper.ts", planned: false }], stamp: [] },
      },
    ],
  };
  session.cutNodeIds = new Set(["n1"]);

  const reason = "internal rename, nothing a reader of the docs would ever see";
  session.sayDocsNotNeeded(reason);

  const r = signCutGesture(session);
  assert.equal(r.ok, true, r.ok ? "" : r.reason);

  const signed = session.space.cuts.at(-1);
  assert.ok(signed, "a cut was appended to the space");
  assert.equal(
    signed!.docsNotNeeded,
    reason,
    "the reason the session was told is recorded on the signed cut",
  );
});
