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

test("a subject is recognised wherever the build put it", () => {
  assert.equal(ranAmong("src/run/gate.ts", ["/tmp/wt/out-test/run/gate.js"]), true);
  assert.equal(ranAmong("src/run/gate.ts", ["/tmp/wt/out-test/run/other.js"]), false);
});

/**
 * A repository whose subject is compiled into a bundle, the way the surface
 * is: one executed file, a source map naming the originals inside it, and a
 * module that is NOT in the bundle at all.
 */
function bundledRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-wiring-bundle-"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.mkdirSync(path.join(dir, "out"));
  fs.writeFileSync(path.join(dir, "src", "untouched.ts"), `export const never = () => "no";\n`);
  // The bundle: the originals' own text is gone, exactly as a bundler leaves
  // it. Only the map records which files it was built from.
  fs.writeFileSync(
    path.join(dir, "out", "bundle.cjs"),
    `"use strict";\nfunction shaped(){return "waive-docs";}\nconsole.log(shaped());\n` +
      `//# sourceMappingURL=bundle.cjs.map\n`,
  );
  fs.writeFileSync(
    path.join(dir, "out", "bundle.cjs.map"),
    JSON.stringify({ version: 3, sources: ["../src/vscode.ts", "../src/Rail.tsx"], mappings: "" }),
  );
  return dir;
}

// INVARIANT: a module the drive really ran is credited even though a bundler
// inlined it. V8 can only name the file it executed; without the map the
// originals attribute to nothing and a fully-driven promise reads as dead.
test("a subject a bundler inlined is credited to the original the source map names", async () => {
  const dir = bundledRepo();
  const verdict = await provedByExecution({
    run: "node out/bundle.cjs",
    subjects: ["src/vscode.ts", "src/Rail.tsx"],
    worktree: dir,
    exec,
  });
  assert.equal(verdict.executed, "yes", verdict.detail);
});

// INVARIANT: this credits only what the bundle is actually made of. A module
// absent from the map is still unexecuted — the map may add what ran, never
// invent it, or the gate would pass a stub it never reached.
test("a module the bundle does not contain is still not executed", async () => {
  const dir = bundledRepo();
  const verdict = await provedByExecution({
    run: "node out/bundle.cjs",
    subjects: ["src/untouched.ts"],
    worktree: dir,
    exec,
  });
  assert.equal(verdict.executed, "no", verdict.detail);
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
