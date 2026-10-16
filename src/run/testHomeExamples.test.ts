/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Whoever writes a check sees how the repository's own tests in that test
 * home reach code, mounting tests first, and is told to reach code the same
 * way.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { testHomeStanza } from "./testHomeExamples";

test("a test home's own tests are shown, mounting ones first, and other checks are not", async () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "test-home-"));
  const home = path.join(tree, "frontend", "tests");
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, "a_pure.test.ts"), "import { add } from '../app/add'\nexpect(add(1, 2)).toBe(3)\n");
  fs.writeFileSync(path.join(home, "b_card.test.ts"), "import { mountSuspended } from '@nuxt/test-utils/runtime'\nimport Card from '#module-layers/media/frontend/Card.vue'\nawait mountSuspended(Card, { props: {} })\n");
  fs.writeFileSync(path.join(home, "chart_AC-1.test.ts"), "// another check of this run\n");
  const stanza = await testHomeStanza(tree, ["frontend/tests/chart_AC-2.test.ts", "frontend/app/x.vue"]);
  assert.match(stanza, /HOW THIS REPOSITORY'S OWN TESTS REACH CODE/);
  assert.ok(stanza.indexOf("b_card.test.ts") < stanza.indexOf("a_pure.test.ts"), "a test that mounts is shown first");
  assert.match(stanza, /#module-layers\/media\/frontend\/Card\.vue/);
  assert.doesNotMatch(stanza, /another check of this run/);
  assert.match(stanza, /REACH CODE THE WAY THESE TESTS DO/);
});

test("a test home with nothing in it says the checks are its first", async () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "test-home-empty-"));
  const stanza = await testHomeStanza(tree, ["tests/x_AC-1_test.py"]);
  assert.match(stanza, /tests\/ ── holds no test yet: your checks are the first here/);
  assert.equal(await testHomeStanza(tree, ["src/app.py"]), "", "no check, no stanza");
});
