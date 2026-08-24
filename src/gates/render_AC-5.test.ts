/**
 * The person writes a reason at the moment of signing, and that reason
 * must reach the cut review page the session produces — not only the
 * signed record — or the review page a person reads before clicking sign
 * shows nothing of what they just wrote.
 *
 * STANDING INVARIANT — a TandemSession told sayDocsNotNeeded(reason)
 * renders that reason on the cutScreen() it produces.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession, SessionDeps } from "../surfaces/session";

function fakeDeps(dir: string): SessionDeps {
  return {
    round: { model: "fake-model", repoRoot: dir },
    storeDir: path.join(dir, "store"),
    storageDir: path.join(dir, "storage"),
    now: () => "2026-08-24T00:00:00Z",
    author: "t",
  };
}

test("a session told documentation is not needed renders that reason on the cut review page it produces, seen through a session built with fakes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-session-"));
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

  const screen = session.cutScreen();
  assert.match(
    screen,
    new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "the reason the session was told reaches the cut review page it produces",
  );
});
