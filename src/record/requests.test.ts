/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A request between modules lives in the record: written before any message
 * is sent, shown the same way to both modules, and moved on only by what
 * the tool sees.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { answer, ask, handed, own, said, sent, turnEnded, view } from "./commands";
import type { Deps } from "./commands";
import { clockFrom, commit, repoWith, tmp } from "./repo.fixture";

const CONTROL = {
  "thinkube.yaml": "kind: ThinkubeDeployment\n",
  "extensions/forge/thinkube.yaml": "kind: ThinkubeDeployment\n",
  "extensions/mill/thinkube.yaml": "kind: ThinkubeDeployment\n",
  "extensions/mill/backend/tasks.py": "\n",
};

/** Forge is owned by session s-forge. Mill has a card, and an owner when asked for. */
function world(millOwned: boolean): { deps: Deps; root: string } {
  const root = repoWith(CONTROL);
  const deps = { storeRoot: tmp("store"), author: "ana", now: clockFrom("2026-03-01T10:00:00.000Z") };
  own(deps, { session: "s-mill", cwd: root, dir: "extensions/mill" });
  if (!millOwned) own(deps, { session: "s-mill", cwd: root, dir: "." });
  own(deps, { session: "s-forge", cwd: root, dir: "extensions/forge" });
  return { deps, root };
}

const requestsSeenBy = (deps: Deps, session: string, cwd: string) => {
  const shown = view(deps, { session, cwd });
  assert.ok(shown.ok);
  return shown.view?.requests.map((r) => [r.direction, r.module, r.state]);
};

test("a request goes from the asking module to the owner of the other, and comes back answered", () => {
  const { deps, root } = world(true);

  const asked = ask(deps, { session: "s-forge", cwd: root, to: "Mill", text: "Give a task a priority" });
  assert.ok(asked.ok && asked.request && asked.send);
  assert.equal(asked.send.session, "s-mill", "the message goes to the owner session of the module asked");
  assert.match(asked.send.text, new RegExp(`^Tandem request ${asked.request} from the module "forge"`));
  assert.match(asked.send.text, /Give a task a priority/);

  handed(deps, { session: "s-forge", cwd: root, request: asked.request, to: "s-mill", delivered: true });
  assert.deepEqual(requestsSeenBy(deps, "s-forge", root), [["asked", "mill", "sent to the owner session"]]);

  // The message arrives in Mill's owner session, which builds and commits.
  const arrived = said(deps, {
    session: "s-mill",
    cwd: root,
    text: asked.send.text,
    origin: "peer",
    surface: "vscode",
  });
  assert.ok(arrived.ok && arrived.filed);
  assert.deepEqual(requestsSeenBy(deps, "s-mill", root), [["received", "forge", "with the owner session"]]);
  const sha = commit(root, { "extensions/mill/backend/tasks.py": "priority\n" }, "A task has a priority");
  const built = turnEnded(deps, { session: "s-mill", cwd: root });
  assert.deepEqual(
    built.ok && built.view?.sentences.map((s) => [s.by, s.request, s.commits.map((c) => c.sha)]),
    [["session", asked.request, [sha]]],
    "the commit stands under the request that asked for it",
  );

  const done = answer(deps, {
    session: "s-mill",
    cwd: root,
    request: asked.request,
    text: "Tasks take a priority from 0 to 9.",
  });
  assert.ok(done.ok && done.send);
  assert.equal(done.send.session, "s-forge");
  assert.match(done.send.text, /^Tandem answer to request .* from the module "mill"/);
  assert.match(done.send.text, /Tasks take a priority from 0 to 9\./);

  for (const session of ["s-forge", "s-mill"]) {
    const shown = view(deps, { session, cwd: root });
    assert.deepEqual(
      shown.ok && shown.view?.requests.map((r) => [r.state, r.answer]),
      [["answered", "Tasks take a priority from 0 to 9."]],
      `${session} sees the same end`,
    );
  }
});

test("a request to a module with no owner waits, and the session that takes the module is shown it", () => {
  const { deps, root } = world(false);
  const asked = ask(deps, { session: "s-forge", cwd: root, to: "mill", text: "Give a task a priority" });
  assert.ok(asked.ok && asked.request);
  assert.equal(asked.send, undefined);
  assert.match(asked.note ?? "", /"mill" has no owner session now/);
  assert.deepEqual(requestsSeenBy(deps, "s-forge", root), [
    ["asked", "mill", "waiting: the module has no owner session"],
  ]);

  const taken = own(deps, { session: "s-new", cwd: root, dir: "extensions/mill" });
  assert.ok(taken.ok);
  const [waiting] = taken.view?.requests ?? [];
  assert.equal(waiting.direction, "received");
  assert.equal(waiting.state, "not given to this session yet");
  assert.match(waiting.message ?? "", new RegExp(`^Tandem request ${asked.request} `));

  // Started from the pane, the message enters as a prompt of the plugin.
  said(deps, { session: "s-new", cwd: root, text: waiting.message ?? "", origin: "plugin", surface: "vscode" });
  const after = view(deps, { session: "s-new", cwd: root });
  assert.deepEqual(
    after.ok && after.view?.requests.map((r) => [r.state, r.message]),
    [["with the owner session", undefined]],
  );
});

test("a message that could not be handed over says why on the request", () => {
  const { deps, root } = world(true);
  const asked = ask(deps, { session: "s-forge", cwd: root, to: "mill", text: "Give a task a priority" });
  assert.ok(asked.ok && asked.request);
  handed(deps, {
    session: "s-forge",
    cwd: root,
    request: asked.request,
    to: "s-mill",
    delivered: false,
    reason: "the session is not running",
  });
  assert.deepEqual(requestsSeenBy(deps, "s-forge", root), [
    ["asked", "mill", "not delivered: the session is not running"],
  ]);
});

test("a request is refused when it names no module, several, the asker itself, or comes from no module", () => {
  const { deps, root } = world(true);
  const refusal = (session: string, to: string) => {
    const r = ask(deps, { session, cwd: root, to, text: "x" });
    assert.ok(!r.ok);
    return r.reason;
  };
  assert.match(refusal("s-forge", "scheduler"), /No module is called "scheduler".*forge, mill/);
  assert.match(refusal("s-forge", "forge"), /does not ask itself/);
  assert.match(refusal("s-nobody", "mill"), /owns no module/);
});

test("only the owner of the module asked answers a request, and only once", () => {
  const { deps, root } = world(true);
  const asked = ask(deps, { session: "s-forge", cwd: root, to: "mill", text: "Give a task a priority" });
  assert.ok(asked.ok && asked.request);
  const tryAnswer = (session: string, request: string) =>
    answer(deps, { session, cwd: root, request, text: "Done." });

  const wrongOwner = tryAnswer("s-forge", asked.request);
  assert.ok(!wrongOwner.ok);
  assert.match(wrongOwner.reason, /made to the module "mill", which this session does not own/);
  const unknown = tryAnswer("s-mill", "r-000000");
  assert.ok(!unknown.ok);
  assert.match(unknown.reason, /no request r-000000/);

  assert.ok(tryAnswer("s-mill", asked.request).ok);
  const twice = tryAnswer("s-mill", asked.request);
  assert.ok(!twice.ok);
  assert.match(twice.reason, /already answered: Done\./);
});

test("a message the owner session sends to another session is kept as sent", () => {
  const { deps, root } = world(true);
  const kept = sent(deps, { session: "s-forge", cwd: root, to: "mill-owner", text: "Is the queue API stable?" });
  assert.ok(kept.ok && kept.filed);
  assert.deepEqual(
    kept.view?.sent.map((m) => [m.to, m.text]),
    [["mill-owner", "Is the queue API stable?"]],
  );
  assert.deepEqual(sent(deps, { session: "s-nobody", cwd: root, to: "x", text: "y" }), {
    ok: true,
    filed: false,
  });
});
