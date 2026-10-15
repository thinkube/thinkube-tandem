/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A tester is told what its doubles must agree with: the repository's
 * shared fixtures, and every method the production path calls on a seam —
 * including the ones after the call a check cares about.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isSharedFixturePath, productionSeams, seamsInSource, sharedFixtures } from "./seams";
import { fixturesStanza } from "./brief";

const DATABASE_PY = `from contextlib import contextmanager
from uuid import UUID

from sqlalchemy import text


def _require_tenant(tenant_id: UUID | None) -> UUID:
    if tenant_id is None or (isinstance(tenant_id, str) and tenant_id.strip() == ""):
        raise ValueError("tenant_id is missing")
    return tenant_id


@contextmanager
def tenant_transaction(pool: ConnectionPool, tenant_id: UUID) -> Iterator[Connection]:
    _require_tenant(tenant_id)
    connection = pool.connect()
    try:
        connection.execute(
            text("SET LOCAL app.current_tenant_id = :tenant_id"),
            {"tenant_id": str(tenant_id)},
        )
        yield connection
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
    finally:
        connection.close()
`;

const CONFTEST_PY = `import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
`;

function repoWithConftest(): string {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "seams-"));
  fs.mkdirSync(path.join(tree, "app", "services"), { recursive: true });
  fs.mkdirSync(path.join(tree, "tests"));
  fs.writeFileSync(path.join(tree, "app", "services", "database.py"), DATABASE_PY);
  fs.writeFileSync(path.join(tree, "tests", "conftest.py"), CONFTEST_PY);
  fs.writeFileSync(path.join(tree, "tests", "database_AC-1_test.py"), "def test_x():\n    pass\n");
  return tree;
}

test("a seam lists every method the production path calls, through what it obtained", () => {
  const seams = seamsInSource("app/services/database.py", DATABASE_PY);
  assert.deepEqual(
    seams.map((s) => s.fn),
    ["tenant_transaction"],
    "a function whose only parameter is a value is not a seam",
  );
  const [seam] = seams;
  assert.deepEqual(seam.params, ["pool", "tenant_id"]);
  assert.deepEqual(seam.objects, [
    { name: "pool", methods: ["connect"] },
    { name: "connection", from: "pool.connect()", methods: ["execute", "commit", "rollback", "close"] },
  ]);
});

test("a TypeScript seam is read the same way", () => {
  const src = `export async function save(pool: Pool, id: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("insert", [id]);
  } finally {
    client.release();
  }
}
`;
  const [seam] = seamsInSource("src/store.ts", src);
  assert.equal(seam.fn, "save");
  assert.deepEqual(seam.objects.find((o) => o.name === "client")?.methods, ["query", "release"]);
});

test("shared fixtures are known by the conventions test runners load them by", () => {
  assert.equal(isSharedFixturePath("tests/conftest.py"), true);
  assert.equal(isSharedFixturePath("conftest.py"), true);
  assert.equal(isSharedFixturePath("vitest.setup.ts"), true);
  assert.equal(isSharedFixturePath("src/setupTests.js"), true);
  assert.equal(isSharedFixturePath("tests/helpers/db.py"), true);
  assert.equal(isSharedFixturePath("src/run/shapes.fixture.ts"), true);
  assert.equal(isSharedFixturePath("tests/documents_AC-1_test.py"), false, "a check is not a fixture");
  assert.equal(isSharedFixturePath("app/services/database.py"), false);
});

test("a tester's brief for a repository with tests/conftest.py carries it and the seam's methods", async () => {
  const tree = repoWithConftest();
  const fixtures = await sharedFixtures(tree);
  assert.deepEqual(fixtures.map((f) => f.path), ["tests/conftest.py"]);
  const seams = await productionSeams(tree);
  assert.deepEqual(seams.map((s) => `${s.file}:${s.fn}`), ["app/services/database.py:tenant_transaction"]);
  const brief = fixturesStanza(fixtures, seams);
  assert.match(brief, /── tests\/conftest\.py ──/, "the fixture is named");
  assert.ok(brief.includes("sys.path.insert(0"), "the fixture's source is in the brief");
  assert.ok(
    brief.includes("connection = pool.connect(): execute(), commit(), rollback(), close()"),
    `the doubled seam's methods are in the brief; got:\n${brief}`,
  );
  assert.match(brief, /USE IT/, "the rule to use a shared fixture is stated");
  assert.match(brief, /implements EVERY method the production path calls/, "the rule for a double is stated");
});

test("the tester that owns the run's shared fixture is told to write it first", async () => {
  const tree = repoWithConftest();
  const seams = await productionSeams(tree);
  const brief = fixturesStanza(await sharedFixtures(tree), seams, {
    write: "tests/conftest.py",
    seams,
    users: ["SL-2#eu-1", "SL-3#eu-1"],
  });
  assert.match(brief, /YOU WRITE THE RUN'S SHARED FIXTURE at tests\/conftest\.py, BEFORE your checks/);
  assert.match(brief, /SL-2#eu-1, SL-3#eu-1/);
});
