/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A check that cannot load what it exercises, though the tree holds it,
 * failed for its environment: the signs are read from what it printed and
 * confirmed against the tree's files, and a judge is told to rule it
 * defective.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { environmentSigns, environmentStanza } from "./environmentFailure";

const FILES = [
  "backend/app/modules/odontogram/frontend/components/odontogram/OdontogramChart.vue",
  "backend/app/modules/odontogram/frontend/composables/useOdontogram.ts",
  "backend/app/services/database.py",
  "frontend/tests/types.test.ts",
];

test("a Vue component the tree holds but the test environment could not resolve is a sign", () => {
  const signs = environmentSigns("[Vue warn]: Failed to resolve component: OdontogramChart\n  at <TimelapseView>", FILES);
  assert.deepEqual(signs, [
    { missing: "the component OdontogramChart", file: "backend/app/modules/odontogram/frontend/components/odontogram/OdontogramChart.vue" },
  ]);
});

test("a component the tree does not hold is the code's to write, not a sign", () => {
  assert.deepEqual(environmentSigns("[Vue warn]: Failed to resolve component: TimelapsePlayer", FILES), []);
});

test("imports by relative path and Python modules the tree holds are signs", () => {
  const out = [
    'Failed to resolve import "../composables/useOdontogram" from "backend/app/modules/odontogram/frontend/components/x.vue". Does the file exist?',
    "Error: Cannot find module '../../app/services/database'",
    "ModuleNotFoundError: No module named 'app.services.database'",
  ].join("\n");
  const missing = environmentSigns(out, FILES).map((s) => s.file);
  assert.deepEqual(missing, [
    "backend/app/modules/odontogram/frontend/composables/useOdontogram.ts",
    "backend/app/services/database.py",
    "backend/app/services/database.py",
  ]);
});

test("each missing thing is named once, and the stanza tells the judge the ruling", () => {
  const signs = environmentSigns("Failed to resolve component: OdontogramChart\nFailed to resolve component: OdontogramChart", FILES);
  assert.equal(signs.length, 1);
  const stanza = environmentStanza(signs);
  assert.match(stanza, /COULD NOT LOAD THESE, THOUGH THE TREE HOLDS THEM/);
  assert.match(stanza, /the component OdontogramChart — provided by .*OdontogramChart\.vue/);
  assert.match(stanza, /rule it DEFECTIVE/);
  assert.equal(environmentStanza([]), "");
});
