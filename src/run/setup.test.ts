import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { defaultExec } from "./oracle";
import { linkProvisioned, setupRunTree } from "./setup";

function tree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-setup-"));
  const g = (args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  execFileSync("git", ["init", "-q", dir], { encoding: "utf8" });
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  fs.writeFileSync(path.join(dir, ".gitignore"), "deps/\nbuilt/\n");
  fs.writeFileSync(path.join(dir, "main.txt"), "source");
  g(["add", "-A"]);
  g(["commit", "-qm", "base"]);
  return dir;
}

/** A shell exec whose only power is what the command itself does. */
const sh = async (cmd: string, cwd: string) => {
  try {
    const output = execFileSync("sh", ["-c", cmd], { cwd, encoding: "utf8", stdio: "pipe" });
    return { code: 0, output };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
};

test("provisioning is observed, not named: what the command produced is what runners get", async () => {
  const wt = tree();
  const said: string[] = [];
  const r = await setupRunTree({
    worktree: wt,
    provision: "mkdir -p deps && echo lib > deps/lib.txt",
    prepare: "test -f deps/lib.txt && mkdir -p built && cp main.txt built/main.txt",
    exec: defaultExec,
    boundedExec: sh,
    log: (l) => said.push(l),
  });
  assert.equal(r.refusal, undefined);
  assert.deepEqual(r.provisioned, ["deps"], "only what provisioning produced — never the build's own output");
  assert.ok(fs.existsSync(path.join(wt, "built", "main.txt")), "the build step was proved on the untouched tree");

  const runner = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-runner-"));
  await linkProvisioned(runner, wt, r.provisioned);
  assert.equal(fs.readFileSync(path.join(runner, "deps", "lib.txt"), "utf8").trim(), "lib");
  await linkProvisioned(runner, wt, r.provisioned);
  assert.ok(fs.lstatSync(path.join(runner, "deps")).isSymbolicLink(), "linking twice is one link");
});

test("a build step that fails on the untouched tree refuses the run instead of dispatching into a wall", async () => {
  const wt = tree();
  const r = await setupRunTree({
    worktree: wt,
    prepare: "echo 'This is not the compiler you are looking for' >&2; exit 1",
    exec: defaultExec,
    boundedExec: sh,
    log: () => {},
  });
  assert.ok(r.refusal, "refused");
  assert.match(r.refusal!, /not the compiler you are looking for/, "the refusal carries the tool's own words");
});

test("a red suite before the work refuses at the door, naming what failed — not only that something did", async () => {
  const wt = tree();
  const r = await setupRunTree({
    worktree: wt,
    suite: ["sh", "-c", "printf 'ok 1 - a\\nnot ok 2 - the doors are missing\\n# pass 1\\n# fail 1\\n# cancelled 0\\n# skipped 0\\n# todo 0\\n# duration_ms 5\\n'; exit 1"],
    exec: defaultExec,
    boundedExec: sh,
    log: () => {},
  });
  assert.match(r.refusal ?? "", /red before any work/);
  assert.match(r.refusal ?? "", /not ok 2 - the doors are missing/, "the failing check is named above the summary");
});

test("a repository needing no setup passes straight through", async () => {
  const wt = tree();
  const r = await setupRunTree({ worktree: wt, exec: defaultExec, boundedExec: sh, log: () => {} });
  assert.deepEqual(r, { provisioned: [] });
});
