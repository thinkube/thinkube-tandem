// WHY (TRANSITION): today the extension re-reads a remembered "active"
// slug out of workspace state to address a space; this proves the
// replacement — the session built for a space carries that space's own
// owner-and-slug key, so a caller can address the tab register with the
// key the resolving act actually used rather than re-reading a remembered
// value that may name a different space. Its job is done once the session
// exposes the key it was resolved under.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "../out-test/surfaces/session.js";

function sessionKeyed(spaceKey) {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sl7-ac6-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sl7-ac6-keys-")),
    now: () => "2026-08-22T00:00:00.000Z",
    author: "t",
    scope: { gitRoot: "/repo", prefix: "", projectId: "owner-x", label: "Repository Label" },
    spaceName: "Rebrand",
    spaceKey: spaceKey,
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

test("resolving a space returns its owner-and-slug key beside the session, so the caller addresses the register with the key that act resolved and never re-reads a remembered active slug", () => {
  const s = sessionKeyed("owner-x/rebrand");
  assert.equal(
    s.spaceKey,
    "owner-x/rebrand",
    "the session must carry the owner-and-slug key it was resolved under",
  );

  // A second session resolved under a DIFFERENT key must report that
  // different key — proving the key travels with the session that was
  // actually resolved, not a single remembered value shared by every space.
  const other = sessionKeyed("owner-x/main");
  assert.equal(other.spaceKey, "owner-x/main");
  assert.notEqual(
    s.spaceKey,
    other.spaceKey,
    "each session's key must be its own space's key, not a shared remembered slug",
  );
});
