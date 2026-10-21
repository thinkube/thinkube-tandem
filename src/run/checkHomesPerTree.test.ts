/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A check is born in the idiom of the tree its subject lives in.
 *
 * A repository with a Python service and a Vue front end keeps two ways of
 * testing. Read as one, it minted `.test.js` checks beside Python modules,
 * which no runner collected, and left a slice whose code was a `.vue` view
 * and its locale files with no home at all, which was refused before
 * dispatch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { rehouseChecks, unreachableCheckHomes } from "./checkHomes";
import { partsDeclared, thinkubeDeclaration } from "../core/thinkubeYaml";
import { proved, runnerFor } from "./proved";
import { toldByDeclaration } from "./whatWeKnow";

const REPO = [
  "backend/app/api/tasks.py",
  "backend/app/models/task.py",
  "backend/tests/conftest.py",
  "backend/tests/test_tasks.py",
  "backend/tests/test_api/test_health.py",
  "frontend/src/views/Home.vue",
  "frontend/src/views/__tests__/Home.test.js",
  "frontend/src/locales/en.json",
  "docs/index.html",
];

function slices() {
  return [
    {
      handle: "SL-1",
      workUnits: [
        { role: "code", footprint: ["backend/app/api/tasks.py", "docs/see-what-to-do-next.md"] },
        { role: "test", footprint: ["probes/todo__SL-1_AC-1.test.mjs"] },
      ],
    },
    {
      handle: "SL-3",
      workUnits: [
        { role: "code", footprint: ["frontend/src/views/Home.vue", "frontend/src/locales/en.json"] },
        { role: "test", footprint: ["probes/todo__SL-3_AC-1.test.mjs"] },
      ],
    },
  ];
}

test("a Python module's check is a Python test in the backend's own test directory", () => {
  const s = slices();
  rehouseChecks(s, REPO);
  assert.deepEqual(s[0].workUnits[1].footprint, ["backend/tests/tasks_AC-1_test.py"]);
});

test("a Vue view's check is a vitest file beside the view, and the slice has a home", () => {
  const s = slices();
  rehouseChecks(s, REPO);
  assert.deepEqual(s[1].workUnits[1].footprint, ["frontend/src/views/Home_AC-1.test.js"]);
  assert.deepEqual(unreachableCheckHomes(s, REPO).where, [], "nothing is left where no test runs");
});

test("a declared part with no test of its own yet is still a home, in that part", () => {
  // The frontend declares tests but holds none yet: its checks are born
  // there all the same, beside the view, in the idiom of the repository.
  const repo = REPO.filter((f) => !f.startsWith("frontend/src/views/__tests__"));
  const s = slices();
  rehouseChecks(s, repo, new Set(), [{ root: "backend" }, { root: "frontend" }]);
  assert.deepEqual(s[1].workUnits[1].footprint, ["frontend/src/views/Home_AC-1.test.js"]);
  assert.deepEqual(unreachableCheckHomes(s, repo, [{ root: "backend" }, { root: "frontend" }]).where, []);
});

/**
 * A service whose code lives under app/ and whose every test lives in a
 * top-level tests/ keeps its checks in tests/: the code's own tree holds no
 * test, and a check beside the module is one the runner never collects.
 */
test("a module in a tree without tests takes the repository's one test directory of its language", () => {
  const repo = ["app/__init__.py", "app/main.py", "tests/conftest.py", "tests/test_health.py", "README.md"];
  const s = [
    {
      handle: "SL-1",
      workUnits: [
        { role: "code", footprint: ["app/main.py"] },
        { role: "test", footprint: ["probes/svc__SL-1_AC-1.test.mjs", "probes/svc__SL-1_AC-2.test.mjs"] },
      ],
    },
  ];
  rehouseChecks(s, repo);
  assert.deepEqual(s[0].workUnits[1].footprint, ["tests/main_AC-1_test.py", "tests/main_AC-2_test.py"]);
  assert.deepEqual(unreachableCheckHomes(s, repo).where, [], "the checks are where the repository runs its tests");
});

test("a test directory of another language is not borrowed", () => {
  const repo = ["src/view.vue", "web/main.py", "tests/view.test.js"];
  const s = [
    {
      handle: "SL-1",
      workUnits: [
        { role: "code", footprint: ["web/main.py"] },
        { role: "test", footprint: ["probes/svc__SL-1_AC-1.test.mjs"] },
      ],
    },
  ];
  rehouseChecks(s, repo);
  assert.deepEqual(s[0].workUnits[1].footprint, ["web/main_AC-1_test.py"]);
});

/**
 * A front end built from the whole repository whose module screens live
 * inside the backend's tree: the screens' checks are the front end's tests,
 * in its test directory, run by its command — never Python tests beside a
 * Vue view, run by pytest.
 */
const SPLIT = [
  "backend/app/main.py",
  "backend/app/modules/agenda/service.py",
  "backend/app/modules/agenda/frontend/pages/Agenda.vue",
  "backend/app/modules/agenda/frontend/composables/useAgenda.ts",
  "backend/tests/conftest.py",
  "backend/tests/test_main.py",
  "backend/tests/modules/agenda/test_service.py",
  "frontend/app/app.vue",
  "frontend/tests/composables/useClinic.test.ts",
  "frontend/tests/utils/format.test.ts",
  "frontend/tests/e2e/login.spec.ts",
  "scripts/check_docs_layout.py",
];

function splitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "split-parts-"));
  fs.writeFileSync(
    path.join(dir, "thinkube.yaml"),
    [
      "apiVersion: thinkube.io/v1",
      "kind: ThinkubeDeployment",
      "spec:",
      "  containers:",
      "    - { name: backend, build: ./backend, test: { enabled: true, command: pytest, one: 'pytest <file>' } }",
      "    - { name: frontend, build: '.', test: { enabled: true, command: 'npx vitest run', one: 'npx vitest run <file>' } }",
      "",
    ].join("\n"),
  );
  return dir;
}

function sliceOf(subject: string) {
  return [
    {
      handle: "SL-1",
      workUnits: [
        { role: "code", footprint: [subject] },
        { role: "test", footprint: ["probes/app__SL-1_AC-1.test.mjs"] },
      ],
    },
  ];
}

test("a screen inside the backend's tree gets a vitest check in the front end's tests, run by the front end's command", () => {
  const dir = splitRepo();
  const read = thinkubeDeclaration(dir);
  assert.ok(read && "declared" in read);
  const parts = partsDeclared(read.declared);
  const told = toldByDeclaration(dir);
  const runner = runnerFor(proved(told.runOne!, true)!, told.parts);

  const view = sliceOf("backend/app/modules/agenda/frontend/pages/Agenda.vue");
  rehouseChecks(view, SPLIT, new Set(), parts);
  assert.deepEqual(view[0].workUnits[1].footprint, ["frontend/tests/Agenda_AC-1.test.ts"]);
  assert.equal(runner("frontend/tests/Agenda_AC-1.test.ts"), "npx vitest run <file>", "the command of the part built from the whole repository");
  assert.deepEqual(unreachableCheckHomes(view, SPLIT, parts).where, []);

  const service = sliceOf("backend/app/modules/agenda/service.py");
  rehouseChecks(service, SPLIT, new Set(), parts);
  assert.deepEqual(service[0].workUnits[1].footprint, ["backend/tests/service_AC-1_test.py"]);
  assert.equal(runner("backend/tests/service_AC-1_test.py"), "cd backend && { pytest tests/service_AC-1_test.py; }");
  assert.deepEqual(unreachableCheckHomes(service, SPLIT, parts).where, []);
});

test("a part built from the whole repository that says how its tests run makes every check home reachable", () => {
  const files = ["app/main.py", "app/store.py", "run_tests.sh"];
  const s = sliceOf("app/main.py");
  const whole = [{ root: ".", test: { enabled: true, command: "./run_tests.sh", one: "./run_tests.sh <file>" } }];
  rehouseChecks(s, files, new Set(), whole);
  assert.deepEqual(s[0].workUnits[1].footprint, ["app/main_AC-1_test.py"]);
  assert.deepEqual(unreachableCheckHomes(s, files, whole), { where: [], roots: ["."] });
  assert.deepEqual(unreachableCheckHomes(s, ["app/main.py", "web/a.test.ts"], [{ root: "." }]).where, ["SL-1: app/main_AC-1_test.py"], "one that does not is no place tests run");
});
