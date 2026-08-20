// WHY (TRANSITION): before this slice a session carried only repoName
// (the repository or project label) — nothing named the thinking space
// itself. This proves every session is built carrying the display name of
// its OWN thinking space (as SessionDeps.spaceName, read from the space
// listing), distinct from the repository/project label, so a tab can be
// titled with the name the person actually gave the space.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TandemSession } from "../out-test/surfaces/session.js";

function sessionWith(spaceName, scopeLabel) {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    now: () => "2026-08-20T10:00:00Z",
    author: "t",
    spaceName,
    scope: { gitRoot: "/repo", prefix: "", projectId: "p1", label: scopeLabel },
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

test("a session carries the display name of its own thinking space, taken from the space listing rather than the repository or project label", () => {
  const session = sessionWith("Rebrand the checkout flow", "checkout-service");

  assert.equal(
    session.spaceName,
    "Rebrand the checkout flow",
    "the session's space name is the display name handed in as SessionDeps.spaceName",
  );
  assert.notEqual(
    session.spaceName,
    session.repoName,
    "the space's display name is never the repository/project label — they are two different names read from two different places",
  );
});
