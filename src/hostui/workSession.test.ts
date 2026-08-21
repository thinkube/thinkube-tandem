/**
 * Resolving a project thinking space hands back its owner-and-slug key
 * beside the session, so the caller addresses the tab register with the
 * key this act itself resolved — never a remembered "active" slug.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type * as vscodeTypes from "vscode";

import { ensureWorkSession } from "./workSession";
import { createWorkProject } from "../core/workProjects";
import { TandemSession } from "../surfaces/session";

test("resolving a space returns its owner-and-slug key beside the session, addressing the register with the key that act resolved", async () => {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-store-"));
  const made = createWorkProject(storeRoot, "checkout", "Rebrand");
  assert.ok(made.ok, "the fixture work project was created");
  if (!made.ok) return;
  const ownerKey = `wp:${made.project.id}`;
  const slug = "main";
  const sessionKey = `${ownerKey}/${slug}`;

  // Pre-seed the session map so ensureWorkSession takes its early-return
  // path (an existing session for that key) — this is the one path that
  // touches no host-only API, so it is reachable from a hermetic test
  // while still exercising the real key-resolution logic.
  const sessions = new Map<string, TandemSession>();
  const fakeSession = { marker: "the-existing-session" } as unknown as TandemSession;
  sessions.set(sessionKey, fakeSession);

  const resolved = await ensureWorkSession({
    context: {} as vscodeTypes.ExtensionContext,
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
  assert.equal(
    resolved?.key,
    sessionKey,
    "the resolved key is exactly owner-key/slug — the same key the sessions map is addressed by",
  );
  assert.equal(resolved?.session, fakeSession, "the resolved session is the one already registered under that key");
});
