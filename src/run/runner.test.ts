/**
 * A runner worktree is always sound, or the failure names the machine.
 *
 * Every red these drives prevent was pinned on work that was correct. A
 * runner directory left without a registration blocked its own repair
 * forever, and every verify round in it died as "no file located" — a
 * verdict about the code, spoken about an empty tree. A run whose
 * dependency stores were already in place recorded no provisioning, so
 * fresh runners were built with no dependencies and their builds failed
 * with the runner's own words. A worker proved the repair by hand, from
 * inside a run, through a tool the fence had missed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ensureSnapshot } from "./oracle";
import type { Exec } from "./oracle";
import { setupRunTree } from "./setup";
import { DELEGATION_TOOLS, FENCED_TOOLS, toolsRefusedTo } from "./worker";

const exec: Exec = (cmd, args, cwd) =>
  new Promise((resolve) =>
    execFile(cmd, args as string[], { cwd }, (err, out, errOut) =>
      resolve({ code: err ? 1 : 0, out: `${out}${errOut}` }),
    ),
  );

/** A committed repository to snapshot from. */
function repoWithCommit(): { root: string; sha: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runner-repo-"));
  execFileSync("git", ["-C", root, "init", "-q"], { stdio: "ignore" });
  fs.writeFileSync(path.join(root, "a.txt"), "a\n");
  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");
  execFileSync("git", ["-C", root, "add", "."], { stdio: "ignore" });
  execFileSync(
    "git",
    ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "seed"],
    { stdio: "ignore" },
  );
  const sha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return { root, sha };
}

test("a husk — a runner directory with no registration — repairs itself", async () => {
  const { root, sha } = repoWithCommit();
  const husk = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "runner-")), "SL-1");
  fs.mkdirSync(husk, { recursive: true });
  fs.writeFileSync(path.join(husk, "leftover.txt"), "husk\n");

  const r = await ensureSnapshot(root, sha, husk, exec);
  assert.deepEqual(r, { ok: true });
  assert.ok(fs.existsSync(path.join(husk, ".git")), "the husk became a real worktree");
  assert.ok(fs.existsSync(path.join(husk, "a.txt")), "with the repository's source in it");
  assert.equal(fs.existsSync(path.join(husk, "leftover.txt")), false, "the husk's residue is gone");
});

test("a directory that belongs to something is refused, never deleted", async () => {
  const { root, sha } = repoWithCommit();
  // A REAL repository of its own — has .git, is not a husk.
  const theirs = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "runner-")), "SL-2");
  fs.mkdirSync(theirs, { recursive: true });
  execFileSync("git", ["-C", theirs, "init", "-q"], { stdio: "ignore" });
  fs.writeFileSync(path.join(theirs, "precious.txt"), "keep me\n");

  const r = await ensureSnapshot(root, sha, theirs, exec);
  assert.equal(r.ok, false, "not ours to rebuild");
  assert.match((r as { reason: string }).reason, /could not be created/);
  assert.ok(fs.existsSync(path.join(theirs, "precious.txt")), "nothing was deleted");
});

test("a broken snapshot names the machine, with a reason a person can read", async () => {
  const { root } = repoWithCommit();
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "runner-")), "SL-3");
  const r = await ensureSnapshot(root, "not-a-ref", dir, exec);
  assert.equal(r.ok, false);
  assert.ok((r as { reason: string }).reason.length > 0);
});

test("the door reports the stores a ready tree HAS, however it got ready", async () => {
  // The worktree already carries its dependency store: nothing is borrowed,
  // nothing is installed, the before/after diff of provisioning is empty —
  // and the list must STILL name the store, because every fresh runner is
  // linked from it.
  const { root } = repoWithCommit();
  const wt = path.join(os.tmpdir(), `runner-wt-${Date.now()}`);
  execFileSync("git", ["-C", root, "worktree", "add", "-q", wt], { stdio: "ignore" });
  fs.mkdirSync(path.join(wt, "node_modules", "dep"), { recursive: true });
  fs.writeFileSync(path.join(wt, "node_modules", "dep", "index.js"), "x\n");

  const ready = await setupRunTree({
    worktree: wt,
    provision: "true",
    prepare: "true",
    exec,
    boundedExec: async (cmd, cwd) =>
      new Promise((resolve) =>
        execFile("bash", ["-lc", cmd], { cwd }, (err, out, errOut) =>
          resolve({ code: err ? 1 : 0, output: `${out}${errOut}` }),
        ),
      ),
    log: () => {},
  });
  assert.ok(
    ready.provisioned.includes("node_modules"),
    `the ready tree's store is on the list; got: [${ready.provisioned.join(", ")}]`,
  );
});

/**
 * What each worker may reach.
 *
 * A fenced worker has no shell — every door, including the ones added
 * later. An unfenced one keeps its shell, because the actors with full
 * authority are useless without it. Neither may delegate: a worker that
 * spawns another is work nobody is answerable for.
 */
test("the fence closes every shell door, and no worker ever delegates", () => {
  {
  for (const t of ["Monitor", "Task", "Agent", "Workflow", "Skill"])
    assert.ok((FENCED_TOOLS as readonly string[]).includes(t), `${t} must be fenced`);
  }
  {
  // The product's own rule, not a copy of it.
  const closer = toolsRefusedTo({ unfenced: true, role: "test" });
  assert.equal(closer.includes("Bash"), false, "the last actor must be able to run the build");
  assert.equal(closer.includes("Monitor"), false, "and to watch a command it started");
  for (const t of DELEGATION_TOOLS)
    assert.ok(closer.includes(t), `${t} stays closed: nothing judges what it would spawn`);
  }
  {
  const tester = toolsRefusedTo({ role: "test" });
  assert.ok(tester.includes("Bash"), "a tester writes checks, it does not run them");
  assert.ok(tester.includes("Monitor"), "and cannot reach a shell the long way round");
  for (const t of DELEGATION_TOOLS) assert.ok(tester.includes(t));

  // A blinded coder: shell closed for the same reason, by the same rule.
  const blindCoder = toolsRefusedTo({ role: "code", blind: true });
  assert.ok(blindCoder.includes("Bash"));
  // A sighted coder keeps its shell — only the blinded and the testers lose it.
  assert.equal(toolsRefusedTo({ role: "code" }).includes("Bash"), false);
  }
});


