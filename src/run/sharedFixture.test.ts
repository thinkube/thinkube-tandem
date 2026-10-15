/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A seam several testers of one run will double, with no shared fixture
 * for it, gets one: the first of those testers writes it, the others wait
 * for it in the schedule, and it is committed before they start.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { applyFixturePlan, commitSharedFixture, fixturePathFor, planSharedFixture, testerReading } from "./sharedFixture";
import { seamsInSource } from "./seams";

const seams = seamsInSource(
  "app/services/database.py",
  `def tenant_transaction(pool: ConnectionPool, tenant_id: UUID):
    connection = pool.connect()
    connection.execute("SET LOCAL app.current_tenant_id = :t", {"t": str(tenant_id)})
    yield connection
    connection.commit()
`,
);

const testers = [
  { id: "SL-1#eu-1", footprint: ["tests/health_AC-1_test.py"], text: "the health route answers ok" },
  { id: "SL-2#eu-1", footprint: ["tests/documents_AC-1_test.py"], text: "documents are written through tenant_transaction" },
  { id: "SL-3#eu-1", footprint: ["tests/ingest_AC-1_test.py"], text: "ingest reads app/services/database.py's seam" },
];

test("the first tester that names a shared seam owns the fixture; the others wait for it", () => {
  const plan = planSharedFixture({ testers, seams, fixtures: [] });
  assert.ok(plan, "a plan is made");
  assert.equal(plan.owner, "SL-2#eu-1");
  assert.equal(plan.path, "tests/conftest.py");
  assert.deepEqual(plan.waiters, ["SL-3#eu-1"], "a tester that never names the seam does not wait");
  assert.deepEqual(plan.seams.map((s) => s.fn), ["tenant_transaction"]);

  const dag = testers.map((t) => ({ id: t.id, footprint: [...t.footprint], requires: [] as string[] }));
  applyFixturePlan(dag, plan);
  assert.deepEqual(dag[1].footprint, ["tests/documents_AC-1_test.py", "tests/conftest.py"], "the owner may write the fixture");
  assert.deepEqual(dag[2].requires, ["SL-2#eu-1"], "the waiter is scheduled after the owner");
  assert.deepEqual(dag[0].requires, []);
});

test("a tester the owner waits on is never made to wait for the owner", () => {
  const plan = planSharedFixture({ testers, seams, fixtures: [] });
  assert.ok(plan);
  const dag = [
    { id: "SL-2#eu-1", footprint: ["tests/documents_AC-1_test.py"], requires: ["SL-3#eu-1"] },
    { id: "SL-3#eu-1", footprint: ["tests/ingest_AC-1_test.py"], requires: [] as string[] },
  ];
  applyFixturePlan(dag, plan);
  assert.deepEqual(dag[1].requires, [], "no cycle is made");
  assert.deepEqual(plan.waiters, []);
});

test("no plan when a shared fixture already doubles every method, or only one tester names the seam", () => {
  const conftest = {
    path: "tests/conftest.py",
    source: "class FakeConnection:\n    def execute(self, *a): ...\n    def commit(self): ...\n\nclass FakePool:\n    def connect(self): ...\n",
  };
  assert.equal(planSharedFixture({ testers, seams, fixtures: [conftest] }), undefined);
  assert.equal(planSharedFixture({ testers: testers.slice(0, 2), seams, fixtures: [] }), undefined);
});

test("a fixture that lacks one method the code calls does not count as doubling the seam", () => {
  const partial = { path: "tests/conftest.py", source: "class FakeConnection:\n    def execute(self, *a): ...\n" };
  assert.ok(planSharedFixture({ testers, seams, fixtures: [partial] }));
});

test("the fixture lives where the language's runner loads it from", () => {
  assert.equal(fixturePathFor("tests/x_AC-1_test.py"), "tests/conftest.py");
  assert.equal(fixturePathFor("src/run/x_AC-1.test.ts"), "src/run/seams.fixture.ts");
  assert.equal(fixturePathFor("web/x_AC-1.test.mjs"), "web/seams.fixture.mjs");
  assert.equal(fixturePathFor("pkg/x_AC-1_test.go"), "pkg/seams_fixture_test.go");
  assert.equal(fixturePathFor("spec/x_AC-1_spec.rb"), undefined);
});

test("a tester's reading carries its criteria and the production files its slice touches", async () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "reading-"));
  fs.mkdirSync(path.join(tree, "docs"));
  fs.writeFileSync(path.join(tree, "docs", "rule.md"), "every statement runs inside tenant_transaction");
  const text = await testerReading(
    tree,
    {
      handle: "SL-2",
      status: "ready",
      files: [],
      workUnits: [
        { footprint: ["app/services/documents.py"], consumes: ["docs/rule.md"], execution: "serial", role: "code" },
        { footprint: ["tests/documents_AC-1_test.py"], execution: "serial", role: "test" },
      ],
    },
    ["a failed document is marked failed"],
  );
  assert.match(text, /a failed document is marked failed/);
  assert.match(text, /app\/services\/documents\.py/);
  assert.match(text, /every statement runs inside tenant_transaction/, "a consumed file's source is read");
  assert.doesNotMatch(text, /documents_AC-1_test/, "the tester's own checks are not production");
});

test("the fixture is committed on its own the moment its owner finishes", async () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-commit-"));
  fs.mkdirSync(path.join(tree, "tests"));
  fs.writeFileSync(path.join(tree, "tests", "conftest.py"), "class FakePool: ...\n");
  const calls: string[][] = [];
  const lines: string[] = [];
  await commitSharedFixture({
    worktree: tree,
    tep: "TEP-x-1",
    slice: "SL-2",
    plan: { owner: "SL-2#eu-1", path: "tests/conftest.py", seams, waiters: ["SL-3#eu-1"] },
    exec: async (_cmd, args) => {
      calls.push(args);
      return { code: args[0] === "diff" ? 1 : 0, out: "" };
    },
    log: (l) => lines.push(l),
  });
  assert.deepEqual(calls[0], ["add", "--", "tests/conftest.py"]);
  const commit = calls.find((c) => c[0] === "commit");
  assert.ok(commit, "a commit is made");
  assert.match(commit[2], /^tandem: TEP-x-1 SL-2 — partial: shared fixture tests\/conftest\.py$/);
  assert.deepEqual(commit.slice(-2), ["--", "tests/conftest.py"], "only the fixture is committed");
  assert.match(lines.join("\n"), /SL-3#eu-1 use it/);
});

test("a fixture that cannot be committed stops the run with git's words", async () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-fail-"));
  fs.mkdirSync(path.join(tree, "tests"));
  fs.writeFileSync(path.join(tree, "tests", "conftest.py"), "x = 1\n");
  await assert.rejects(
    commitSharedFixture({
      worktree: tree,
      tep: "TEP-x-1",
      slice: "SL-2",
      plan: { owner: "SL-2#eu-1", path: "tests/conftest.py", seams, waiters: ["SL-3#eu-1"] },
      exec: async (_cmd, args) => (args[0] === "commit" ? { code: 1, out: "fatal: cannot lock ref" } : { code: args[0] === "diff" ? 1 : 0, out: "" }),
      log: () => {},
    }),
    /could not be committed: fatal: cannot lock ref/,
  );
});
