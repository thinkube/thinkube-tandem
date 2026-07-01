/**
 * SP-6/7 structural independence — the TESTER worktree. The `role: test` workers run in a
 * detached snapshot at the Spec branch's committed HEAD, so the code workers' uncommitted
 * modifications are absent from their tree BY CONSTRUCTION (assertions here are on tree
 * state, not on fence behaviour). Real git fixtures — no mocks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { WorktreeService, testerWtName } from "./WorktreeService";
import { defaultAcceptanceRecipeResolver } from "./auditorRunner";

function initRepo(seed: Record<string, string>): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tk-tester-wt-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  for (const [rel, body] of Object.entries(seed)) {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  return repo;
}

test("structural property: an uncommitted modification in the code worktree is ABSENT from the tester snapshot", async () => {
  const repo = initRepo({ "src/base.ts": "// base\n", "README.md": "readme\n" });
  const svc = new WorktreeService();
  const wtRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tk-tester-trees-"));

  // The code worktree for spec 6/3, with an in-progress (uncommitted) implementation.
  const codeWt = await svc.create(repo, "6/3", wtRoot);
  fs.mkdirSync(path.join(codeWt, "src/services"), { recursive: true });
  fs.writeFileSync(
    path.join(codeWt, "src/services/approvalToken.ts"),
    "// in-progress impl\n",
  );
  fs.writeFileSync(path.join(codeWt, "src/base.ts"), "// base MODIFIED\n");

  const testerWt = await svc.createTester(repo, "6/3", wtRoot);
  assert.equal(path.basename(testerWt), testerWtName("6/3"));
  assert.notEqual(testerWt, codeWt);
  // The base file is present, at its COMMITTED content (the modification is invisible)…
  assert.equal(
    fs.readFileSync(path.join(testerWt, "src/base.ts"), "utf8"),
    "// base\n",
  );
  // …and the in-progress implementation simply does not exist in the tester's tree.
  assert.equal(
    fs.existsSync(path.join(testerWt, "src/services/approvalToken.ts")),
    false,
  );

  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(wtRoot, { recursive: true, force: true });
});

test("createTester reuse re-snapshots: committed slices become visible, prior-run leftovers are cleaned", async () => {
  const repo = initRepo({ "src/base.ts": "// base\n" });
  const svc = new WorktreeService();
  const wtRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tk-tester-trees2-"));

  const codeWt = await svc.create(repo, "6/3", wtRoot);
  const testerWt = await svc.createTester(repo, "6/3", wtRoot);
  // A leftover probe from a prior run lingers in the tester tree…
  fs.mkdirSync(path.join(testerWt, "src/acceptance"), { recursive: true });
  fs.writeFileSync(
    path.join(testerWt, "src/acceptance/OLD.test.ts"),
    "// stale probe\n",
  );

  // …a slice lands (committed to the spec branch in the code worktree)…
  fs.writeFileSync(path.join(codeWt, "src/landed.ts"), "// slice 1 landed\n");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", codeWt, ...args], { stdio: "pipe" });
  git("add", "-A");
  git("commit", "-q", "-m", "slice 1");

  // …and the next run re-snapshots: the committed slice is now visible, the leftover is gone.
  const again = await svc.createTester(repo, "6/3", wtRoot);
  assert.equal(again, testerWt, "tester worktree is reused, not duplicated");
  assert.equal(fs.existsSync(path.join(testerWt, "src/landed.ts")), true);
  assert.equal(
    fs.existsSync(path.join(testerWt, "src/acceptance/OLD.test.ts")),
    false,
  );

  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(wtRoot, { recursive: true, force: true });
});

test("reset clears a worktree's uncommitted state; committed work survives", async () => {
  const repo = initRepo({ "src/base.ts": "// base\n" });
  const svc = new WorktreeService();
  const wtRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tk-tester-trees3-"));
  const codeWt = await svc.create(repo, "6/3", wtRoot);

  // A committed slice + stale uncommitted leftovers from a broken run.
  fs.writeFileSync(path.join(codeWt, "src/landed.ts"), "// committed\n");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", codeWt, ...args], { stdio: "pipe" });
  git("add", "-A");
  git("commit", "-q", "-m", "landed");
  fs.writeFileSync(path.join(codeWt, "src/base.ts"), "// stale edit\n");
  fs.writeFileSync(path.join(codeWt, "src/stale-new.ts"), "// stale new\n");

  await svc.reset(codeWt);
  assert.equal(
    fs.readFileSync(path.join(codeWt, "src/base.ts"), "utf8"),
    "// base\n",
    "a stale tracked edit is reverted",
  );
  assert.equal(
    fs.existsSync(path.join(codeWt, "src/stale-new.ts")),
    false,
    "a stale untracked file is cleaned",
  );
  assert.equal(
    fs.readFileSync(path.join(codeWt, "src/landed.ts"), "utf8"),
    "// committed\n",
    "committed work survives the reset",
  );

  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(wtRoot, { recursive: true, force: true });
});

test("acceptance recipe: the optional `prepare` (build step) is parsed from conventions.json", async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tk-recipe-prep-"));
  fs.mkdirSync(path.join(repo, ".tandem"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, ".tandem", "conventions.json"),
    JSON.stringify({
      acceptanceProbe: {
        sourcePath: "src/acceptance/SP-{spec}_AC-{ac}.test.ts",
        run: "node --test out-test/acceptance/SP-{spec}_AC-{ac}.test.js",
        prepare: "npx tsc -p tsconfig.test.json",
      },
    }),
  );
  const recipe = await defaultAcceptanceRecipeResolver(repo);
  assert.equal(recipe?.prepare, "npx tsc -p tsconfig.test.json");
  // Absent prepare stays undefined (a repo whose probes run from source declares none).
  fs.writeFileSync(
    path.join(repo, ".tandem", "conventions.json"),
    JSON.stringify({
      acceptanceProbe: { sourcePath: "a/{spec}_{ac}.py", run: "pytest a/{spec}_{ac}.py" },
    }),
  );
  const noPrep = await defaultAcceptanceRecipeResolver(repo);
  assert.equal(noPrep?.prepare, undefined);
  fs.rmSync(repo, { recursive: true, force: true });
});
