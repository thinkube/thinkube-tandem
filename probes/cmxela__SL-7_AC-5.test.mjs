// WHY (TRANSITION): today a session's name comes from the repository or
// project label (deps.scope.label / the repo's basename); this proves the
// replacement — every session carries the display name of its OWN thinking
// space, taken from the space listing, so a tab can be titled with the name
// the person gave that space rather than the name of the repo it lives in.
//
// The name must be shown to come FROM THE LISTING, not merely to survive a
// constructor: a check that hands a name in and reads it back would pass for
// a session that echoes any field, and would say nothing about where the
// name was obtained. So this drives `resolveSpaceHandle` — the one act both
// owner kinds resolve a space through — against a real space listing written
// to disk, and then carries its result into a real session.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "../out-test/surfaces/session.js";
import { resolveSpaceHandle } from "../out-test/surfaces/sessionDeps.js";
import { listThinkingSpaces } from "../out-test/core/spaces.js";

const OWNER_ID = "p1";
const REPO_LABEL = "Repository Label";

/** A store on disk in the layout the real listing reads —
 *  spaces/<ownerId>/<slug>/name.txt — each space's display name deliberately
 *  different from the repository label. */
function storeWithSpaces(spaces) {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sl7-ac5-store-"));
  for (const { slug, label } of spaces) {
    const dir = path.join(storeRoot, "spaces", OWNER_ID, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "name.txt"), `${label}\n`);
  }
  return storeRoot;
}

test("every session is built carrying the display name of its own thinking space, taken from the space listing rather than the repository or project label", () => {
  const storeRoot = storeWithSpaces([
    { slug: "plugin-delivery", label: "Plugin delivery" },
    { slug: "rebrand", label: "Rebrand" },
  ]);

  // The listing is the source this promise names. If the real listing cannot
  // be read here, the check has not reached its subject and must fail loudly
  // rather than quietly proving a constructor echo.
  const listed = listThinkingSpaces(storeRoot, OWNER_ID, "repository");
  assert.ok(
    Array.isArray(listed) && listed.length >= 2,
    `the real space listing must report the spaces written to ${storeRoot}, got: ${JSON.stringify(listed)}`,
  );

  const handle = resolveSpaceHandle(storeRoot, OWNER_ID, OWNER_ID, "plugin-delivery");
  const other = resolveSpaceHandle(storeRoot, OWNER_ID, OWNER_ID, "rebrand");

  // The name resolved for a space is that space's own listed display name —
  // never the repository/project label, and never a bare slug fallback.
  assert.equal(
    handle.name,
    "Plugin delivery",
    "resolveSpaceHandle must take the display name from the space listing",
  );
  assert.equal(other.name, "Rebrand");
  assert.notEqual(
    handle.name,
    REPO_LABEL,
    "the space's display name must never fall back to the repository or project label",
  );
  assert.notEqual(
    handle.name,
    other.name,
    "each space must resolve to its OWN listed name, not one shared value",
  );

  // The name the listing supplied is what the session is built carrying.
  const s = new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sl7-ac5-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sl7-ac5-keys-")),
    now: () => "2026-08-22T00:00:00.000Z",
    author: "t",
    scope: { gitRoot: "/repo", prefix: "", projectId: OWNER_ID, label: REPO_LABEL },
    spaceName: handle.name,
    spaceKey: handle.key,
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

  assert.equal(
    s.spaceName,
    "Plugin delivery",
    "the session must report the display name the space listing supplied",
  );
  assert.notEqual(
    s.spaceName,
    REPO_LABEL,
    "the session's space name must never be the repository or project label",
  );
});
