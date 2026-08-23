/**
 * The claim the whole methodology exists for: **a green check that never
 * ran the code proves nothing.**
 *
 * This is the SL-6 fixture in its smallest form — a register built,
 * disposed and connected to nothing, with a check that passes over it. The
 * drive must reject it, and must still accept the same check once it
 * really drives the subject.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { provedByExecution, ranAmong } from "./wiring";
import { scrubbedEnv } from "./oracle";

const exec = (cmd: string, cwd: string): Promise<{ code: number | null; output: string }> =>
  new Promise((resolve) =>
    execFile("sh", ["-c", cmd], { cwd, encoding: "utf8", env: scrubbedEnv() }, (err, out, errOut) =>
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, output: `${out}\n${errOut}` }),
    ),
  );

/** A tiny repository with a subject and two checks over it. */
function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-wiring-"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "register.mjs"), `export const register = () => "wired";\n`);
  // Green, and it never touches the subject: the tricycle.
  fs.writeFileSync(
    path.join(dir, "src", "register_AC-1.test.mjs"),
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
      `test("the register exists", () => assert.ok(true));\n`,
  );
  // Green, and it drives the subject.
  fs.writeFileSync(
    path.join(dir, "src", "register_AC-2.test.mjs"),
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
      `import { register } from "./register.mjs";\ntest("it registers", () => assert.equal(register(), "wired"));\n`,
  );
  return dir;
}

test("a check that passes without executing its subject is not a proof", async () => {
  const dir = repo();
  const verdict = await provedByExecution({
    run: "node --test src/register_AC-1.test.mjs",
    subjects: ["src/register.mjs"],
    worktree: dir,
    exec,
  });
  assert.equal(verdict.executed, "no", verdict.detail);
  assert.match(verdict.detail, /without executing a line of/);
});

test("a check that drives its subject is proven by the runtime", async () => {
  const dir = repo();
  const verdict = await provedByExecution({
    run: "node --test src/register_AC-2.test.mjs",
    subjects: ["src/register.mjs"],
    worktree: dir,
    exec,
  });
  assert.equal(verdict.executed, "yes", verdict.detail);
});

test("a runtime that reports nothing is unknown, never a pass and never a failure", async () => {
  const dir = repo();
  const verdict = await provedByExecution({
    run: "true",
    subjects: ["src/register.mjs"],
    worktree: dir,
    exec,
  });
  assert.equal(verdict.executed, "unknown", verdict.detail);
});

// A promise can land in data — a ledger, a manifest, a document. A drive
// READS such a file; no runtime executes a line of it, so an execution
// record can never name it. Reporting "no" there charges a coder for the
// instrument's blind spot, which this module's header forbids.
test("a promise landing in data is unknown, never a failure for not being executed", async () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, "LEDGER.md"), "- `src/register.mjs` — **wire**: reason.\n");
  const verdict = await provedByExecution({
    run: "node --test src/register_AC-2.test.mjs",
    subjects: ["LEDGER.md"],
    worktree: dir,
    exec,
  });
  assert.equal(verdict.executed, "unknown", verdict.detail);
  assert.doesNotMatch(verdict.detail, /without executing a line of/);
});

// A mixed promise is judged on the code it names: the data file neither
// proves nor disproves reach, so it must not drag a driven subject to "no".
test("a promise naming both data and code is judged on the code it names", async () => {
  const dir = repo();
  const verdict = await provedByExecution({
    run: "node --test src/register_AC-2.test.mjs",
    subjects: ["LEDGER.md", "src/register.mjs"],
    worktree: dir,
    exec,
  });
  assert.equal(verdict.executed, "yes", verdict.detail);
});

test("a subject is recognised wherever the build put it", () => {
  assert.equal(ranAmong("src/run/gate.ts", ["/tmp/wt/out-test/run/gate.js"]), true);
  assert.equal(ranAmong("src/run/gate.ts", ["/tmp/wt/out-test/run/other.js"]), false);
});

test("a promise landing in a document is not asked to execute", async () => {
  // Two criteria about a markdown ledger were red forever: the trace
  // demanded that ENGINE-WIRING.md execute, and a document cannot. Content
  // is proven by the check's own assertions, not by a trace.
  const verdict = await provedByExecution({
    run: "true",
    subjects: ["docs/ENGINE-WIRING.md", "data/table.json"],
    worktree: "/nowhere",
    exec: async () => ({ code: 0, output: "" }),
  });
  assert.equal(verdict.executed, "unknown");
  assert.match(verdict.detail, /data, not code/);
  assert.match(verdict.detail, /docs\/ENGINE-WIRING\.md/);
});
