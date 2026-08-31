/**
 * TRANSITION — the push wiring is new: spacePush must carry the
 * signedIdleNotice's result as `signedIdle` on the pushed object, so a
 * session with signed undelivered work and no run in flight sends exactly
 * one signedIdle notice to the surface instead of leaving each page to
 * work the wording out itself from `unrun`/`running` directly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "./session";
import { spacePush } from "./push";
import { emptySpace } from "../core/schema";

function sessionWithSignedUndeliveredWork(): TandemSession {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-signed-idle-"));
  const session = new TandemSession({
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
  });
  session.space = {
    ...emptySpace(),
    cuts: [
      {
        id: "cut-1",
        changeIds: [],
        tepId: "TEP-user-1",
        signature: { at: new Date().toISOString(), renderHash: "h1", groundingHash: "h2" },
      },
    ],
  };
  session.running = false;
  return session;
}

test("the push for a session with signed undelivered work and no run in flight carries exactly one signedIdle notice", () => {
  const session = sessionWithSignedUndeliveredWork();

  const push = spacePush(session) as { signedIdle?: unknown };

  assert.ok(push.signedIdle, "the push must carry a signedIdle notice");
  assert.equal(Array.isArray(push.signedIdle), false, "signedIdle is one notice, never a list");
});
