// WHY (TRANSITION): today a session's name comes from the repository or
// project label (deps.scope.label / the repo's basename); this proves the
// replacement — every session carries the display name of its OWN thinking
// space, taken from the space listing, so a tab can be titled with the name
// the person gave that space rather than the name of the repo it lives in.
// Its job is done once SessionDeps carries the space's name and the session
// exposes it independently of repoName.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "../out-test/surfaces/session.js";

function sessionNamed(spaceName) {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sl7-ac5-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sl7-ac5-keys-")),
    now: () => "2026-08-22T00:00:00.000Z",
    author: "t",
    // The repo/project label is deliberately a DIFFERENT string than the
    // space's own name, so the test can tell which one the session reports.
    scope: { gitRoot: "/repo", prefix: "", projectId: "p1", label: "Repository Label" },
    spaceName: spaceName,
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

test("every session is built carrying the display name of its own thinking space, taken from the space listing rather than the repository or project label", () => {
  const s = sessionNamed("Plugin delivery");
  assert.equal(
    s.spaceName,
    "Plugin delivery",
    "the session must report the space's own display name",
  );
  assert.notEqual(
    s.spaceName,
    "Repository Label",
    "the space's display name must never fall back to the repository or project label",
  );
});
