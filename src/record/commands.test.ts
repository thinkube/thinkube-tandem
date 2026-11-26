/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The record as a session lives it: the person makes the session the owner
 * of a module, and from then on what they type and what is committed is
 * kept by the tool, in the module's journal.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { leaveModule, own, said, turnEnded, view } from "./commands";
import type { Deps } from "./commands";
import { clockFrom, commit, repoWith, tmp } from "./repo.fixture";

const CONTROL = {
  "thinkube.yaml": "kind: ThinkubeDeployment\n",
  "extensions/forge/thinkube.yaml": "kind: ThinkubeDeployment\n",
  "extensions/forge/backend/runs.py": "\n",
  "extensions/mill/thinkube.yaml": "kind: ThinkubeDeployment\n",
};

function world(): { deps: Deps; root: string; forge: string } {
  const root = repoWith(CONTROL);
  return {
    deps: { storeRoot: tmp("store"), author: "ana", now: clockFrom("2026-03-01T10:00:00.000Z") },
    root,
    forge: path.join(root, "extensions/forge"),
  };
}

const typed = (session: string, cwd: string, text: string) => ({
  session,
  cwd,
  text,
  origin: "composer",
  surface: "vscode",
});

test("what the person types in the owner session is kept, with the commits made after it", () => {
  const { deps, root } = world();
  const taken = own(deps, { session: "s-1", cwd: root, dir: "extensions/forge/backend" });
  assert.ok(taken.ok);
  assert.deepEqual(taken.view?.module && [taken.view.module.label, taken.view.module.prefix], [
    "forge",
    "extensions/forge",
  ]);

  const kept = said(deps, typed("s-1", root, "Show the queue above the runs"));
  assert.ok(kept.ok && kept.filed);
  const sha = commit(root, { "extensions/forge/backend/runs.py": "queue\n" }, "Queue above the runs");
  const ended = turnEnded(deps, { session: "s-1", cwd: root });

  assert.ok(ended.ok);
  assert.equal(ended.commits, 1);
  assert.deepEqual(
    ended.view?.sentences.map((s) => [s.by, s.text, s.commits]),
    [["person", "Show the queue above the runs", [{ sha, subject: "Queue above the runs" }]]],
  );
  assert.deepEqual(ended.view?.loose, []);
});

test("a session that owns no module keeps nothing, and is shown the modules it could take", () => {
  const { deps, root } = world();
  const kept = said(deps, typed("s-1", root, "Hello"));
  assert.deepEqual(kept, { ok: true, filed: false });
  assert.equal(fs.existsSync(path.join(deps.storeRoot, "modules")), false, "nothing was written");

  own(deps, { session: "s-2", cwd: root, dir: "extensions/mill" });
  const shown = view(deps, { session: "s-1", cwd: root });
  assert.ok(shown.ok);
  assert.equal(shown.view?.module, undefined);
  assert.deepEqual(
    shown.view?.here.map((p) => [p.label, p.prefix, p.owner]),
    [
      [path.basename(root), "", "none"],
      ["forge", "extensions/forge", "none"],
      ["mill", "extensions/mill", "other"],
    ],
  );
});

test("only the person's words and another session's message are kept, each named as what it is", () => {
  const { deps, root } = world();
  own(deps, { session: "s-1", cwd: root, dir: "extensions/forge" });
  const from = (origin: string, surface: string | null) =>
    said(deps, { session: "s-1", cwd: root, text: origin, origin, surface });

  for (const origin of ["task-notification", "scheduled-trigger", "plugin", "observer", "unclassified"])
    assert.deepEqual(from(origin, "vscode"), { ok: true, filed: false }, origin);
  assert.deepEqual(from("sdk", null), { ok: true, filed: false }, "a program's prompt, with nobody at a surface");

  for (const origin of ["composer", "bridge", "sdk", "peer", "peer-send-message"])
    assert.equal((from(origin, "vscode") as { filed?: boolean }).filed, true, origin);

  const shown = view(deps, { session: "s-1", cwd: root });
  assert.deepEqual(
    shown.ok && shown.view?.sentences.map((s) => [s.text, s.by]),
    [
      ["composer", "person"],
      ["bridge", "person"],
      ["sdk", "person"],
      ["peer", "session"],
      ["peer-send-message", "session"],
    ],
  );
});

test("a prompt that holds what looks like a secret is not written to the store, and the answer says why", () => {
  const { deps, root } = world();
  own(deps, { session: "s-1", cwd: root, dir: "extensions/forge" });
  const refused = said(deps, typed("s-1", root, `Use the token ghp_${"a".repeat(36)} for the push`));
  assert.ok(!refused.ok);
  assert.match(refused.reason, /not kept.*github-pat-classic/);

  const shown = view(deps, { session: "s-1", cwd: root });
  assert.deepEqual(shown.ok && shown.view?.sentences, []);
});

test("a commit made with no sentence before it is kept apart", () => {
  const { deps, root } = world();
  own(deps, { session: "s-1", cwd: root, dir: "extensions/forge" });
  const sha = commit(root, { "extensions/forge/backend/runs.py": "x\n" }, "From the shell");

  const ended = turnEnded(deps, { session: "s-1", cwd: root });
  assert.deepEqual(ended.ok && ended.view?.loose, [{ sha, subject: "From the shell" }]);
});

test("asking for the view files a commit made since the last turn ended", () => {
  const { deps, root } = world();
  own(deps, { session: "s-1", cwd: root, dir: "extensions/forge" });
  const sha = commit(root, { "extensions/forge/backend/runs.py": "y\n" }, "Between turns");

  const shown = view(deps, { session: "s-1", cwd: root });
  assert.deepEqual(shown.ok && shown.view?.loose, [{ sha, subject: "Between turns" }]);
});

test("a folder outside a repository has no module to own, and the answer says so", () => {
  const { deps } = world();
  const nowhere = tmp("nowhere");
  const refused = own(deps, { session: "s-1", cwd: nowhere });
  assert.ok(!refused.ok);
  assert.match(refused.reason, /not inside a git repository/);
});

test("after leaving, the session keeps nothing more", () => {
  const { deps, root } = world();
  own(deps, { session: "s-1", cwd: root, dir: "extensions/forge" });
  const left = leaveModule(deps, { session: "s-1", cwd: root });
  assert.ok(left.ok);
  assert.equal(left.view?.module, undefined);
  assert.deepEqual(said(deps, typed("s-1", root, "Still there?")), { ok: true, filed: false });
  assert.deepEqual(turnEnded(deps, { session: "s-1", cwd: root }), { ok: true });
});

test("when the module's folder is gone the session is told, and nothing fails", () => {
  const { deps, root, forge } = world();
  own(deps, { session: "s-1", cwd: root, dir: "extensions/forge" });
  fs.rmSync(forge, { recursive: true });

  const ended = turnEnded(deps, { session: "s-1", cwd: root });
  assert.ok(ended.ok);
  assert.match(ended.view?.note ?? "", /is not there on this machine/);
});
