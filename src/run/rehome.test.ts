import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { rehomeProbes } from "./rehome";
import { defaultExec } from "./oracle";

const PROBE = "probes/space__SL-1_AC-1.test.mjs";

function worktree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-rehome-"));
  const g = (args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  execFileSync("git", ["init", "-q", dir], { encoding: "utf8" });
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  fs.mkdirSync(path.join(dir, "src"));
  fs.mkdirSync(path.join(dir, "probes"));
  fs.writeFileSync(path.join(dir, "src", "greet.mjs"), "export const greet = () => 'hello';\n");
  fs.writeFileSync(path.join(dir, PROBE), "probe: greet() returns 'hello'");
  g(["add", "-A"]);
  g(["commit", "-qm", "delivered"]);
  return dir;
}

const CHECK = {
  probe: PROBE,
  criterionId: "c1",
  check: "greet() returns 'hello'",
  lands: ["src/greet.mjs"],
};

test("a standing check leaves its delivery coordinates and joins the module's suite", async () => {
  const wt = worktree();
  const fences: string[] = [];
  const r = await rehomeProbes({
    worktree: wt,
    model: "opus",
    checks: [CHECK],
    digest: "CONVENTIONS: tests sit beside the code as <module>.test.mjs",
    suite: async () => true,
    exec: defaultExec,
    log: () => {},
    author: async (deps, prompt) => {
      const allow = deps.allowWrite as (rel: string) => boolean;
      fences.push(
        `suite:${allow("src/greet.test.mjs")} probe:${allow(PROBE)} code:${allow("src/greet.mjs")}`,
      );
      assert.ok(prompt.includes("greet() returns 'hello'"), "the criterion rides the prompt");
      assert.ok(prompt.includes("tests sit beside the code"), "the repo's conventions decide the home");
      fs.writeFileSync(
        path.join(wt, "src", "greet.test.mjs"),
        "test('greet returns the greeting', …)",
      );
      return '{"moved":[{"probe":"' + PROBE + '","path":"src/greet.test.mjs","test":"greet returns the greeting"}]}';
    },
  });
  assert.deepEqual(r.anchors, [
    { criterionId: "c1", path: "src/greet.test.mjs", test: "greet returns the greeting" },
  ]);
  assert.ok(!fs.existsSync(path.join(wt, PROBE)), "the probe is gone — the suite is its home now");
  assert.ok(fs.existsSync(path.join(wt, "src", "greet.test.mjs")));
  assert.equal(
    fences[0],
    "suite:true probe:false code:false",
    "the round may write suite test homes — never probes, never production code",
  );
});

test("a re-homing that leaves the suite red is reverted, and the probes stay", async () => {
  const wt = worktree();
  const r = await rehomeProbes({
    worktree: wt,
    model: "opus",
    checks: [CHECK],
    suite: async () => false,
    exec: defaultExec,
    log: () => {},
    author: async () => {
      fs.writeFileSync(path.join(wt, "src", "greet.test.mjs"), "broken merge");
      return '{"moved":[{"probe":"' + PROBE + '","path":"src/greet.test.mjs","test":"x"}]}';
    },
  });
  assert.deepEqual(r.anchors, [], "no address for a merge the suite refused");
  assert.ok(!fs.existsSync(path.join(wt, "src", "greet.test.mjs")), "the red merge is reverted");
  assert.ok(fs.existsSync(path.join(wt, PROBE)), "the probe stays — evidence is never destroyed");
  assert.ok(r.notes.length > 0, "the revert is a note, never silence");
});

test("a probe the round cannot place stays a probe, named", async () => {
  const wt = worktree();
  const r = await rehomeProbes({
    worktree: wt,
    model: "opus",
    checks: [CHECK],
    suite: async () => {
      throw new Error("the suite must not run when nothing was placed");
    },
    exec: defaultExec,
    log: () => {},
    author: async () => '{"moved":[]}',
  });
  assert.deepEqual(r.anchors, []);
  assert.ok(fs.existsSync(path.join(wt, PROBE)));
  assert.ok(r.notes.some((n) => n.includes(PROBE)));
});

test("a mapping into held-out space is refused — re-homing never writes probes or acceptance", async () => {
  const wt = worktree();
  const r = await rehomeProbes({
    worktree: wt,
    model: "opus",
    checks: [CHECK],
    suite: async () => true,
    exec: defaultExec,
    log: () => {},
    author: async () =>
      '{"moved":[{"probe":"' + PROBE + '","path":"probes/renamed.test.mjs","test":"x"}]}',
  });
  assert.deepEqual(r.anchors, [], "a probe-to-probe move is not a re-homing");
  assert.ok(fs.existsSync(path.join(wt, PROBE)));
});
