/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The module is the unit of the record: a folder with a `thinkube.yaml` of
 * its own, or the root of a repository that declares nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { enableModule, moduleAt, owningPrefix, placeOf, placesFrom } from "./modules";
import { repoWith, tmp } from "./repo.fixture";

const CONTROL = {
  "thinkube.yaml": "kind: ThinkubeDeployment\n",
  "backend/app.py": "\n",
  "extensions/forge/thinkube.yaml": "kind: ThinkubeDeployment\n",
  "extensions/forge/backend/runs.py": "\n",
  "extensions/mill/thinkube.yaml": "kind: ThinkubeDeployment\n",
};

test("a folder belongs to the nearest module at or above it", () => {
  const root = repoWith(CONTROL);
  assert.equal(placeOf(path.join(root, "extensions/forge/backend"))?.prefix, "extensions/forge");
  assert.equal(placeOf(path.join(root, "backend"))?.prefix, "", "the root is the module of the rest");
  assert.equal(placeOf(root)?.declared, true);
});

test("a repository that declares nothing is one module, and a folder outside a repository is none", () => {
  const root = repoWith({ "playbooks/site.yaml": "\n" });
  const place = placeOf(path.join(root, "playbooks"));
  assert.equal(place?.dir, root);
  assert.equal(place?.declared, false);
  assert.equal(placeOf(tmp("nowhere")), undefined);
});

test("a file belongs to the deepest module that contains it", () => {
  const prefixes = ["extensions/forge", "extensions/forge/worker", "extensions/mill"];
  assert.equal(owningPrefix("extensions/forge/backend/runs.py", prefixes), "extensions/forge");
  assert.equal(owningPrefix("extensions/forge/worker/main.py", prefixes), "extensions/forge/worker");
  assert.equal(owningPrefix("backend/app.py", prefixes), "", "what no module inside owns is the root's");
  assert.equal(owningPrefix("extensions/forgery/x.py", prefixes), "", "a name that only starts alike is not inside");
});

test("from inside a repository its modules are found; from above, those of each repository below", () => {
  const home = tmp("home");
  const control = repoWith(CONTROL, path.join(home, "core", "control"));
  const app = repoWith({ "thinkube.yaml": "kind: ThinkubeDeployment\n" }, path.join(home, "apps", "todo"));

  assert.deepEqual(
    placesFrom(path.join(control, "backend")).map((p) => p.prefix),
    ["", "extensions/forge", "extensions/mill"],
  );
  assert.deepEqual(
    placesFrom(home).map((p) => p.dir),
    [app, control, path.join(control, "extensions/forge"), path.join(control, "extensions/mill")],
  );
});

test("a module gets its card once, and is found by it afterwards", () => {
  const store = tmp("store");
  const root = repoWith(CONTROL);
  const forge = placeOf(path.join(root, "extensions/forge"))!;
  assert.equal(moduleAt(forge, store), undefined, "no card yet");

  const first = enableModule(forge, store);
  const again = enableModule(forge, store);
  assert.ok(first.ok && again.ok);
  assert.equal(first.module.label, "forge");
  assert.equal(again.module.id, first.module.id, "the identity does not change");
  assert.equal(moduleAt(forge, store)?.id, first.module.id);

  const control = enableModule(placeOf(root)!, store);
  assert.ok(control.ok);
  assert.notEqual(control.module.id, first.module.id, "the root is a module of its own");
});
