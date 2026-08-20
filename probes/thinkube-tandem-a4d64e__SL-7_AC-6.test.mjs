// WHY (TRANSITION): before this slice, resolving a thinking space handed
// back only the session — the caller had to re-read a remembered "active"
// slug to know which register key that session belonged to. This proves
// the act that resolves a space (ensureWorkSession) hands back its
// owner-and-slug key BESIDE the session, so the caller addresses the tab
// register with the key that act itself resolved.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ensureWorkSession } from "../out-test/hostui/workSession.js";
import { createWorkProject } from "../out-test/core/workProjects.js";

test("resolving a space returns its owner-and-slug key beside the session, addressing the register with the key that act resolved", async () => {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-store-"));
  const made = createWorkProject(storeRoot, "checkout", "Rebrand");
  assert.ok(made.ok, "the fixture work project was created");
  const ownerKey = `wp:${made.project.id}`;
  const slug = "main";
  const sessionKey = `${ownerKey}/${slug}`;

  // Pre-seed the session map so ensureWorkSession takes its early-return
  // path (an existing session for that key) — this is the one path that
  // touches no host-only API, so it is reachable from a hermetic test
  // while still exercising the real key-resolution logic.
  const sessions = new Map();
  const fakeSession = { marker: "the-existing-session" };
  sessions.set(sessionKey, fakeSession);

  const resolved = await ensureWorkSession({
    context: {},
    ownerKey,
    interactive: false,
    storeRoot,
    sessions,
    chooseSpace: async () => slug,
    author: "t",
    resolveForge: async () => undefined,
    openRepos: () => [],
    onChanged: () => {},
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
  });

  assert.ok(resolved, "ensureWorkSession resolved a result for a known owner and a chosen slug");
  assert.equal(resolved.key, sessionKey, "the resolved key is exactly owner-key/slug — the same key the sessions map is addressed by");
  assert.equal(resolved.session, fakeSession, "the resolved session is the one already registered under that key");
});
