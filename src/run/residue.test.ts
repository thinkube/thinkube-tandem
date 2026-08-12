import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { sweepSpaceResidue } from "./residue";

/** A repo whose runs left everything a real run leaves. */
function repoWithResidue(): { repoRoot: string; wtRoot: string } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-residue-"));
  const repoRoot = path.join(home, "repo");
  fs.mkdirSync(repoRoot);
  const g = (args: string[], cwd = repoRoot): string =>
    execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  execFileSync("git", ["init", "-q", repoRoot], { encoding: "utf8" });
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  fs.writeFileSync(path.join(repoRoot, "README.md"), "seed\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "seed"]);

  const wtRoot = path.join(home, "repo-worktrees");
  // A project-prefixed run (the naming the disk actually shows) and its
  // tester snapshot, as real worktrees on real branches.
  g(["worktree", "add", "-b", "tandem/proj/TEP-u-6", path.join(wtRoot, "proj__TEP-u-6")]);
  g(["worktree", "add", "-b", "tandem/proj/TEP-u-6-t", path.join(wtRoot, "proj__TEP-u-6-tester")]);
  fs.mkdirSync(path.join(wtRoot, "oracle-store", "proj__TEP-u-6"), { recursive: true });
  fs.mkdirSync(path.join(wtRoot, "oracle-runners", "proj__TEP-u-6-SL-1-x"), { recursive: true });
  fs.mkdirSync(path.join(wtRoot, "locks"), { recursive: true });
  fs.writeFileSync(
    path.join(wtRoot, "locks", "proj__TEP-u-6.json"),
    JSON.stringify({ runName: "proj/TEP-u-6", footprints: ["src/a.ts"], pid: 999999 }),
  );
  // Another space's run, which must survive this sweep untouched.
  g(["worktree", "add", "-b", "tandem/proj/TEP-u-9", path.join(wtRoot, "proj__TEP-u-9")]);
  fs.writeFileSync(
    path.join(wtRoot, "locks", "proj__TEP-u-9.json"),
    JSON.stringify({ runName: "proj/TEP-u-9", footprints: ["src/b.ts"] }),
  );
  return { repoRoot, wtRoot };
}

test("deleting an unmerged space takes everything its runs created with it", async () => {
  const { repoRoot, wtRoot } = repoWithResidue();
  const said: string[] = [];
  const r = await sweepSpaceResidue({
    repoRoot,
    teps: ["TEP-u-6"],
    branches: ["tandem/proj/TEP-u-6"],
    log: (l) => said.push(l),
  });

  for (const gone of [
    "proj__TEP-u-6",
    "proj__TEP-u-6-tester",
    path.join("oracle-store", "proj__TEP-u-6"),
    path.join("oracle-runners", "proj__TEP-u-6-SL-1-x"),
    path.join("locks", "proj__TEP-u-6.json"),
  ])
    assert.ok(!fs.existsSync(path.join(wtRoot, gone)), `${gone} is gone`);

  const branches = execFileSync("git", ["-C", repoRoot, "branch", "--list"], {
    encoding: "utf8",
  });
  assert.ok(!branches.includes("tandem/proj/TEP-u-6\n"), "the run branch is gone locally");
  assert.ok(
    r.notes.some((n) => n.includes("tandem/proj/TEP-u-6")),
    `no forge is reachable here, and that is a note, not silence: ${JSON.stringify(r.notes)}`,
  );

  // Another space's residue is not this deletion's to take.
  assert.ok(fs.existsSync(path.join(wtRoot, "proj__TEP-u-9")), "other runs keep their trees");
  assert.ok(fs.existsSync(path.join(wtRoot, "locks", "proj__TEP-u-9.json")), "and their locks");
  assert.ok(branches.includes("tandem/proj/TEP-u-9"), "and their branches");
  assert.ok(said.some((l) => l.includes("removed")), "the sweep says what it did");
});

test("a space that never ran sweeps nothing and says nothing", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-residue-"));
  const repoRoot = path.join(home, "repo");
  fs.mkdirSync(repoRoot);
  const r = await sweepSpaceResidue({ repoRoot, teps: [], branches: [] });
  assert.deepEqual(r, { removed: [], notes: [] });
});
