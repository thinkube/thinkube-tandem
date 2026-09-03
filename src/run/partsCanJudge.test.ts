/**
 * A repository that is several parts, each with a proved single-test
 * command, can run one check and read its verdict — no repository-wide
 * command is needed for that. And a check that falls outside every part,
 * with no wide command, is never run as nothing and called green.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { canJudgeOne, declaredPartCommands } from "./whatWeKnow";
import { proved, runnerFor } from "./proved";
import { runScopedSuite } from "./suite";
import { runAcVerifications } from "../engine/core/closingGate";

test("the parts' own proved commands are a way to judge one check", () => {
  assert.equal(canJudgeOne({ parts: { backend: { runOne: "pytest <file>" }, frontend: {} } }, undefined), true);
  assert.equal(canJudgeOne({ parts: { backend: {}, frontend: {} } }, undefined), false);
  assert.equal(canJudgeOne({}, { runOne: "npm test -- <file>" }), true);
});

test("an empty command runs nothing and judges nothing", async () => {
  let ran = 0;
  const [r] = await runAcVerifications([{ ac: 1, run: "", env: "local" }], "/nowhere", async () => {
    ran++;
    return { code: 0, output: "" };
  });
  assert.equal(ran, 0, "nothing was executed");
  assert.equal(r.pass, false);
  assert.equal(r.unrunnable, true);
  assert.match(r.evidence, /no command runs check #1/);
});

test("the standing suite runs each file with the command of the part it lives in, and judges nothing where none runs", async () => {
  // A tree with the files the suite is asked about: it runs what exists.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-suite-"));
  for (const rel of ["frontend/src/views/__tests__/Home.test.js", "backend/tests/test_tasks.py", "src/a.test.ts"]) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), "");
  }
  const ran: string[] = [];
  const said: string[] = [];
  const runOne = runnerFor(proved("node --test <file>", true)!, {
    frontend: { runOne: "npx vitest run <file>" },
    backend: { runOne: "pytest <file>" },
  });
  const verdict = await runScopedSuite({
    runOne,
    root,
    exec: async (cmd) => {
      ran.push(cmd);
      return { code: 0, output: "1 passed" };
    },
    footprint: ["frontend/src/views/Home.vue"],
    importersOf: async () => ["frontend/src/views/__tests__/Home.test.js", "backend/tests/test_tasks.py"],
    log: (l) => said.push(l),
  });
  assert.deepEqual(ran, [
    "cd frontend && { npx vitest run src/views/__tests__/Home.test.js; }",
    "cd backend && { pytest tests/test_tasks.py; }",
  ]);
  assert.equal(verdict.green, true);

  // A file no command runs judges nothing — it used to be a red pinned on
  // whoever owned the file.
  const none = await runScopedSuite({
    runOne: () => "",
    root,
    exec: async () => ({ code: 1, output: "never asked" }),
    footprint: ["src/a.ts"],
    importersOf: async () => ["src/a.test.ts"],
    log: (l) => said.push(l),
  });
  assert.equal(none.green, true, "nothing was judged, so nothing is unkept");
  assert.deepEqual(none.failures, []);
  assert.ok(said.some((l) => /no command runs src\/a\.test\.ts — nothing was judged there/.test(l)));
});

test("a repository whose parts declare their own commands wants no repository-wide one", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-parts-"));
  fs.writeFileSync(
    path.join(root, "thinkube.yaml"),
    "apiVersion: thinkube.io/v1\nkind: ThinkubeDeployment\nspec:\n  deployment:\n    type: app\n  containers:\n" +
      "    - name: backend\n      build: ./backend\n      test:\n        enabled: true\n        command: ./run_tests.sh\n        one: ./run_tests.sh <file>\n" +
      "    - name: frontend\n      build: ./frontend\n      test:\n        enabled: true\n        command: ./run_tests.sh\n        one: ./run_tests.sh <file>\n",
  );
  const told = declaredPartCommands(root);
  assert.deepEqual(Object.keys(told).sort(), ["./backend", "./frontend"].map((r) => r.replace("./", "")).sort());
  // What the door is told for such a repository: the parts, and no wide
  // command at all — a guess nothing can prove was carried, and every
  // check outside a part ran with the wrong part's runner.
  assert.equal(canJudgeOne({ parts: told }, { runOne: "" }), true);
});
