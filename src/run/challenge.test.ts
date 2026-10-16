/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The judge rules on what the check printed and on the library versions
 * the repository installs; a check the supervisor finds at fault is
 * re-authored from its criterion at once, with no challenge spent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { makeChallenge, makeTestFault } from "./challenge";
import { makeSupervisor } from "./oracle";

test("the judge reads the coder's verify output and the installed versions the probe touches", async () => {
  const testerWt = fs.mkdtempSync(path.join(os.tmpdir(), "judge-"));
  fs.mkdirSync(path.join(testerWt, "app"));
  fs.mkdirSync(path.join(testerWt, "tests"));
  fs.writeFileSync(path.join(testerWt, "requirements.txt"), "fastapi==0.141.1\n");
  fs.writeFileSync(path.join(testerWt, "app", "main.py"), "from fastapi import FastAPI\napp = FastAPI()\n");
  fs.writeFileSync(
    path.join(testerWt, "tests", "main_AC-2_test.py"),
    "from app.main import app\n\ndef test_route():\n    assert any(r.path == '/health' for r in app.routes)\n",
  );
  let judged = "";
  const challenge = makeChallenge({
    testerWt,
    worktree: testerWt,
    exec: async () => ({ code: 0, out: "" }),
    sliceProbes: new Map([["SL-1", ["tests/main_AC-2_test.py"]]]),
    criterionOf: () => ({ id: "c-2", text: "the health route declares its response model" }),
    model: "sonnet",
    supervisorRound: async (_r: unknown, prompt: string) => {
      judged = prompt;
      return "DEFECTIVE\nfastapi 0.141.1 keeps included routes inside an _IncludedRouter entry";
    },
    author: async () => null,
    log: () => {},
    onRuling: () => {},
    defect: () => {},
  } as never)("SL-1", () => ({
    kind: "results",
    results: [{ ac: 2, pass: false, evidence: "E   AssertionError: assert False\nE    +  where app.routes = [<_IncludedRouter path=None>]" }],
  }));
  await challenge(2, "the route is included; the check cannot find it");
  assert.match(judged, /_IncludedRouter path=None/, "the judge saw the failing assertion and its traceback");
  assert.match(judged, /- fastapi: 0\.141\.1 \(requirements\.txt\)/, "the judge saw the installed version");
  assert.match(judged, /relies on behaviour the\s+INSTALLED version of a library lacks is DEFECTIVE/);
});

test("a challenge before any verify is refused without spending the budget or calling the judge", async () => {
  const testerWt = fs.mkdtempSync(path.join(os.tmpdir(), "judge-early-"));
  fs.mkdirSync(path.join(testerWt, "tests"));
  fs.writeFileSync(path.join(testerWt, "tests", "x_AC-1_test.py"), "def test_x():\n    assert False\n");
  let judged = 0;
  const challenge = makeChallenge({
    testerWt,
    worktree: testerWt,
    exec: async () => ({ code: 0, out: "" }),
    sliceProbes: new Map([["SL-1", ["tests/x_AC-1_test.py"]]]),
    criterionOf: () => ({ id: "c-1", text: "criterion" }),
    model: "sonnet",
    supervisorRound: async () => {
      judged++;
      return "FAITHFUL\nfine";
    },
    log: () => {},
    defect: () => {},
  } as never)("SL-1", () => undefined);
  assert.match(await challenge(1, "wrong"), /run verify first/);
  assert.equal(judged, 0);
});

const DATABASE_PY = `from contextlib import contextmanager


@contextmanager
def tenant_transaction(pool: ConnectionPool, tenant_id: UUID):
    connection = pool.connect()
    try:
        connection.execute(text("SET LOCAL app.current_tenant_id = :t"), {"t": str(tenant_id)})
        yield connection
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
    finally:
        connection.close()
`;

const EXECUTE_ONLY_CHECK = `from app.services.documents import fail_document


class _NoWriteConnection:
    def execute(self, *args):
        return None


class _NoWritePool:
    def connect(self):
        return _NoWriteConnection()


def test_failed_document_is_marked():
    fail_document(_NoWritePool(), "t-1", "d-1", "boom")
`;

test("a check whose pool double has only execute() is re-authored on the supervisor's TEST-FAULT, no challenge spent", async () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "test-fault-"));
  fs.mkdirSync(path.join(tree, "app", "services"), { recursive: true });
  fs.mkdirSync(path.join(tree, "tests"));
  fs.writeFileSync(path.join(tree, "app", "services", "database.py"), DATABASE_PY);
  fs.writeFileSync(path.join(tree, "tests", "conftest.py"), "import sys\n");
  const rel = "tests/documents_AC-1_test.py";
  fs.writeFileSync(path.join(tree, rel), EXECUTE_ONLY_CHECK);

  const briefs: string[] = [];
  const defects: { impact: string }[] = [];
  const rulings: { granted: boolean; reason: string }[] = [];
  let judgeCalls = 0;
  const args = {
    worktree: tree,
    testerWt: tree,
    exec: async () => ({ code: 0, out: "" }),
    sliceProbes: new Map([["SL-2", [rel]]]),
    briefBySlice: new Map([["SL-2", "write fail_document through tenant_transaction"]]),
    criterionOf: () => ({ id: "c-1", text: "a failed ingestion marks the document failed" }),
    model: "sonnet",
    supervisorRound: async () => {
      judgeCalls++;
      return `TEST-FAULT: ${rel} — its pool double's connection has only execute(), while tenant_transaction commits, rolls back and closes; correct code crashes on commit().`;
    },
    author: async (_o: unknown, brief: string) => {
      briefs.push(brief);
      fs.writeFileSync(path.join(tree, rel), "# re-authored with a faithful double\n");
      return "rewritten";
    },
    log: () => {},
    onRuling: (r: { granted: boolean; reason: string }) => rulings.push(r),
    defect: (d: { impact: string }) => defects.push(d),
  };
  const supervise = makeSupervisor(args as never, makeTestFault(args as never))("SL-2");
  const note = await supervise("AC-1: AttributeError: '_NoWriteConnection' object has no attribute 'commit'", [1]);

  assert.equal(fs.readFileSync(path.join(tree, rel), "utf8"), "# re-authored with a faithful double\n", "the check was re-authored before the coder's next verify");
  assert.match(note ?? "", /check\(s\) 1 .*re-authored .*no challenge was spent\. Run verify again\./);
  assert.equal(briefs.length, 1);
  assert.match(briefs[0], /a failed ingestion marks the document failed/, "re-authored from its criterion");
  assert.ok(
    briefs[0].includes("connection = pool.connect(): execute(), commit(), rollback(), close()"),
    "the re-author is told every method the production path calls on the seam",
  );
  assert.match(briefs[0], /── tests\/conftest\.py ──/, "the re-author is shown the shared fixture");
  assert.deepEqual(rulings.map((r) => r.granted), [true]);
  assert.ok(defects.some((d) => /no challenge spent/.test(d.impact)));
  assert.equal(judgeCalls, 1, "only the supervisor ran — no challenge judge");

  // The coder's own challenge budget for that check is untouched.
  let challenged = 0;
  const challenge = makeChallenge({
    ...args,
    supervisorRound: async () => {
      challenged++;
      return "FAITHFUL\nfine";
    },
  } as never)("SL-2", () => ({ kind: "results", results: [{ ac: 1, pass: false, evidence: "AssertionError" }] }));
  assert.match(await challenge(1, "still wrong"), /^DENIED/);
  assert.match(await challenge(1, "still wrong"), /^DENIED/);
  assert.equal(challenged, 2);
});

test("a TEST-FAULT names its checks: only the named failing check is re-authored", async () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "test-fault-named-"));
  fs.mkdirSync(path.join(tree, "tests"));
  for (const ac of [1, 2]) fs.writeFileSync(path.join(tree, "tests", `d_AC-${ac}_test.py`), `# check ${ac}\n`);
  const rewritten: string[] = [];
  const testFault = makeTestFault({
    testerWt: tree,
    sliceProbes: new Map([["SL-2", ["tests/d_AC-1_test.py", "tests/d_AC-2_test.py"]]]),
    criterionOf: (_s: string, ac: number) => ({ id: `c-${ac}`, text: `criterion ${ac}` }),
    model: "sonnet",
    author: async (o: { allowWrite: string[] }) => {
      rewritten.push(o.allowWrite[0]);
      fs.writeFileSync(path.join(tree, o.allowWrite[0]), "# new\n");
      return "ok";
    },
    log: () => {},
    defect: () => {},
  } as never);
  const note = await testFault("SL-2", "TEST-FAULT: d_AC-2_test.py fakes the client with one method", [1, 2]);
  assert.deepEqual(rewritten, ["tests/d_AC-2_test.py"]);
  assert.match(note, /check\(s\) 2 /);
});
