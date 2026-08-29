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

/**
 * Absence of evidence is not evidence of absence.
 *
 * Three ways the runtime can fail to say what it executed: it reports
 * nothing, it reports something unparseable, or it writes nothing at all.
 * All three used to answer "nothing executed" — the verdict that withheld
 * seventeen promises for code that was correct.
 */
test("evidence this reader cannot understand is unknown, never a failure", async () => {
  {
  const dir = repo();
  const verdict = await provedByExecution({
    run: "true",
    subjects: ["src/register.mjs"],
    worktree: dir,
    exec,
  });
  assert.equal(verdict.executed, "unknown", verdict.detail);
  }
  {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "wiring-shape-"));
  fs.writeFileSync(path.join(wt, "subject.js"), "module.exports = () => 1;\n");
  const verdict = await provedByExecution({
    // Writes a coverage file whose shape this parser does not recognise.
    run: `node -e "const f=require('fs'),p=process.env.NODE_V8_COVERAGE;f.mkdirSync(p,{recursive:true});f.writeFileSync(p+'/x.json','{\\"unexpected\\":true}')"`,
    subjects: ["subject.js"],
    worktree: wt,
    exec: async (cmd, cwd) =>
      new Promise((resolve) =>
        execFile("bash", ["-lc", cmd], { cwd }, (err, out, errOut) =>
          resolve({ code: err ? 1 : 0, output: `${out}${errOut}` }),
        ),
      ),
  });
  assert.equal(verdict.executed, "unknown", `said "${verdict.executed}": ${verdict.detail}`);
  }
  {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "wiring-none-"));
  fs.writeFileSync(path.join(wt, "subject.js"), "module.exports = () => 1;\n");
  const verdict = await provedByExecution({
    run: "true", // passes, records nothing at all
    subjects: ["subject.js"],
    worktree: wt,
    exec: async (cmd, cwd) =>
      new Promise((resolve) =>
        execFile("bash", ["-lc", cmd], { cwd }, (err, out, errOut) =>
          resolve({ code: err ? 1 : 0, output: `${out}${errOut}` }),
        ),
      ),
  });
  assert.equal(verdict.executed, "unknown");
  assert.match(verdict.detail, /does not report what it executed/);
  }
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
  assert.match(verdict.detail, /content, not code/);
});


