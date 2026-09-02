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
import { rehouseChecks, unreachableCheckHomes } from "./checkHomes";

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
  rehouseChecks(s, repo, new Set(), ["backend", "frontend"]);
  assert.deepEqual(s[1].workUnits[1].footprint, ["frontend/src/views/Home_AC-1.test.js"]);
  assert.deepEqual(unreachableCheckHomes(s, repo, ["backend", "frontend"]).where, []);
});
