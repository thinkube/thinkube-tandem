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
import { applyFixturePlan, commitSharedFixture, fixturePathFor, planSharedFixture, testerCode, type TesterCode } from "./sharedFixture";
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

const code = (sources: Record<string, string>, files: string[] = Object.keys(sources)): TesterCode => ({
  files,
  sources: Object.entries(sources).map(([rel, text]) => ({ rel, text })),
});

const testers = [
  {
    id: "SL-1#eu-1",
    footprint: ["tests/health_AC-1_test.py"],
    code: code({ "app/routes/health.py": "def health():\n    return {'status': 'ok'}  # not tenant_transaction(\n" }),
  },
  {
    id: "SL-2#eu-1",
    footprint: ["tests/documents_AC-1_test.py"],
    code: code({
      "app/services/documents.py":
        "from app.services.database import (\n    tenant_transaction,\n)\n\ndef save(pool, t, doc):\n    with tenant_transaction(pool, t) as c:\n        c.execute('insert', doc)\n",
    }),
  },
  { id: "SL-3#eu-1", footprint: ["tests/ingest_AC-1_test.py"], code: code({}, ["app/services/database.py"]) },
];

test("the first tester whose code uses a shared seam owns the fixture; the others wait for it", () => {
  const plan = planSharedFixture({ testers, seams, fixtures: [] });
  assert.ok(plan, "a plan is made");
  assert.equal(plan.owner, "SL-2#eu-1");
  assert.equal(plan.path, "tests/conftest.py");
  assert.deepEqual(plan.waiters, ["SL-3#eu-1"], "a tester whose code never calls the seam does not wait, whatever its text says");
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

test("no plan when a shared fixture already doubles every method, or only one tester's code uses the seam", () => {
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

test("a call counts only when the function is imported from the module that defines it", () => {
  const one = (rel: string, text: string) =>
    planSharedFixture({
      testers: [testers[2], { id: "SL-9#eu-1", footprint: ["tests/x_AC-1_test.py"], code: code({ [rel]: text }) }],
      seams,
      fixtures: [],
    });
  assert.ok(one("app/services/a.py", "from .database import tenant_transaction\ntenant_transaction(p, t)\n"), "a relative import");
  assert.ok(one("app/services/b.py", "from app.services import database\ndatabase.tenant_transaction(p, t)\n"), "the module imported by its package");
  assert.ok(one("backend/app/services/c.py", "from app.services.database import tenant_transaction\ntenant_transaction(p, t)\n"));
  assert.equal(one("app/services/d.py", "from app.other import tenant_transaction\ntenant_transaction(p, t)\n"), undefined, "a namesake from elsewhere");
  assert.equal(one("app/services/e.py", "from app.services.database import tenant_transaction\n"), undefined, "imported, never called");
});

test("a script that imports a seam's file by a relative path uses it", () => {
  const jsSeams = seamsInSource("src/db/tx.ts", "export async function inTenant(pool: Pool, t: string) {\n  const c = await pool.connect();\n  await c.query('set');\n  await c.release();\n}\n");
  const plan = planSharedFixture({
    testers: [
      { id: "SL-1#eu-1", footprint: ["src/a/x_AC-1.test.ts"], code: code({ "src/a/x.ts": 'import { inTenant } from "../db/tx.js";\nawait inTenant(pool, t);\n' }) },
      { id: "SL-2#eu-1", footprint: ["src/a/y_AC-1.test.ts"], code: code({ "src/a/y.ts": 'import { inTenant } from "../db/tx";\ninTenant(pool, t);\n' }) },
    ],
    seams: jsSeams,
    fixtures: [],
  });
  assert.ok(plan);
  assert.equal(plan.path, "src/a/seams.fixture.ts");
  assert.deepEqual(plan.waiters, ["SL-2#eu-1"]);
});

test("a tester's code is the production files its slice works on, read from the tree", async () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "reading-"));
  fs.mkdirSync(path.join(tree, "app"));
  fs.writeFileSync(path.join(tree, "app", "service.py"), "from app.db import tx\n");
  const got = await testerCode(tree, {
    handle: "SL-2",
    status: "ready",
    files: [],
    workUnits: [
      { footprint: ["app/new.py"], consumes: ["app/service.py"], execution: "serial", role: "code" },
      { footprint: ["tests/documents_AC-1_test.py"], execution: "serial", role: "test" },
    ],
  });
  assert.deepEqual(got.files, ["app/new.py", "app/service.py"], "the tester's own checks are not production");
  assert.deepEqual(got.sources, [{ rel: "app/service.py", text: "from app.db import tx\n" }], "a file not written yet has no source");
});

test("an owner that did not write the fixture has not done its work", async () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-missing-"));
  const calls: string[][] = [];
  const written = await commitSharedFixture({
    worktree: tree,
    tep: "TEP-x-1",
    slice: "SL-2",
    plan: { owner: "SL-2#eu-1", path: "tests/conftest.py", seams, waiters: ["SL-3#eu-1"] },
    exec: async (_cmd, args) => {
      calls.push(args);
      return { code: 0, out: "" };
    },
    log: () => {},
  });
  assert.equal(written, false);
  assert.deepEqual(calls, [], "nothing is committed");
});

test("the fixture is committed on its own the moment its owner finishes", async () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-commit-"));
  fs.mkdirSync(path.join(tree, "tests"));
  fs.writeFileSync(path.join(tree, "tests", "conftest.py"), "class FakePool: ...\n");
  const calls: string[][] = [];
  const lines: string[] = [];
  const written = await commitSharedFixture({
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
  assert.equal(written, true);
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
