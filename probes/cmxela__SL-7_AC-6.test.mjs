// WHY (TRANSITION): today the extension re-reads a remembered "active" slug
// out of workspace state to address a space; this proves the replacement —
// the resolving act hands back the space's own owner-and-slug key beside the
// session, so a caller addresses the tab register with the key that act
// resolved rather than a remembered value that may name a different space.
//
// The key must be shown to COME FROM the resolving act, not merely to survive
// a constructor: handing a key in and reading it back would pass for a
// session that echoes any field. So this drives `resolveSpaceHandle` — the
// one act both owner kinds resolve through — against a real space listing on
// disk, and carries its key into a real session.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "../out-test/surfaces/session.js";
import { resolveSpaceHandle } from "../out-test/surfaces/sessionDeps.js";

const OWNER_KEY = "owner-x";
const OWNER_ID = "owner-x";

function storeWithSpaces(spaces) {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sl7-ac6-store-"));
  for (const { slug, label } of spaces) {
    const dir = path.join(storeRoot, "spaces", OWNER_ID, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "name.txt"), `${label}\n`);
  }
  return storeRoot;
}

function sessionFor(handle) {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sl7-ac6-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sl7-ac6-keys-")),
    now: () => "2026-08-22T00:00:00.000Z",
    author: "t",
    scope: { gitRoot: "/repo", prefix: "", projectId: OWNER_ID, label: "Repository Label" },
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
}

test("resolving a space returns its owner-and-slug key beside the session, so the caller addresses the register with the key that act resolved and never re-reads a remembered active slug", () => {
  const storeRoot = storeWithSpaces([
    { slug: "rebrand", label: "Rebrand" },
    { slug: "main", label: "Main" },
  ]);

  // The resolving act itself produces the key — owner and slug together.
  const rebrand = resolveSpaceHandle(storeRoot, OWNER_KEY, OWNER_ID, "rebrand");
  const main = resolveSpaceHandle(storeRoot, OWNER_KEY, OWNER_ID, "main");

  assert.equal(
    rebrand.key,
    `${OWNER_KEY}/rebrand`,
    "the resolving act must hand back the owner-and-slug key for the space it resolved",
  );
  assert.equal(main.key, `${OWNER_KEY}/main`);

  // Two spaces of ONE owner resolve to two DIFFERENT keys. A remembered
  // active slug — one value per owner — could not tell these apart, so this
  // is what rules out addressing the register from such a memory.
  assert.notEqual(
    rebrand.key,
    main.key,
    "two spaces of one owner must resolve to different keys, which a single remembered active slug could never do",
  );

  // The key travels with the session that act resolved.
  const s = sessionFor(rebrand);
  const other = sessionFor(main);

  assert.equal(
    s.spaceKey,
    rebrand.key,
    "the session must carry the key the resolving act produced",
  );
  assert.equal(other.spaceKey, main.key);
  assert.notEqual(
    s.spaceKey,
    other.spaceKey,
    "each session's key must be its own space's key, not a shared remembered slug",
  );

  // The name resolved beside the key is the space's own listed name, so the
  // caller never has to go back to a remembered value for either half.
  assert.equal(rebrand.name, "Rebrand");
  assert.equal(main.name, "Main");
});
