/**
 * AC#1 — language-agnostic worktree provisioning.
 *
 * Drives the real `WorktreeService` over a **hermetic tmp git repo** (`git init`
 * + `git worktree add`, offline — the `ownershipGuard.test.ts` `mkdtempSync` +
 * real-binary pattern). The repo declares its provisioning command via the
 * `repo-conventions` "Worktree setup" format (sibling spec th4wqi): a `setup`
 * fenced block. We use a **marker command** (`touch .provisioned`) so the
 * assertion is the artifact it creates — provisioning ran **once, inside the
 * freshly-added worktree** — with no Node / `node_modules` assumption anywhere.
 *
 * A fixture with **no** declaration provisions nothing (`ran: false`) and creates
 * no marker and no `node_modules`. Run via `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { WorktreeService } from "./WorktreeService";
import {
  parseProvisionRecipe,
  provisionWorktree,
  REPO_CONVENTIONS_RELPATH,
} from "./worktreeProvision";

/** A hermetic, offline git repo with one commit. Returns its absolute path. */
function initRepo(): string {
  const repo = mkdtempSync(path.join(os.tmpdir(), "tk-prov-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  // A worktree add needs at least one commit on the branch.
  execFileSync("touch", [path.join(repo, "README.md")]);
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return repo;
}

/** Install a `repo-conventions` SKILL.md declaring `command` as the setup recipe. */
async function declareRecipe(repo: string, command: string): Promise<void> {
  const skill = path.join(repo, REPO_CONVENTIONS_RELPATH);
  await fs.mkdir(path.dirname(skill), { recursive: true });
  await fs.writeFile(
    skill,
    [
      "# repo-conventions",
      "",
      "## Worktree setup",
      "",
      "```setup",
      command,
      "```",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

test("create() runs the repo's declared recipe once inside the fresh worktree", async () => {
  const repo = initRepo();
  await declareRecipe(repo, "touch .provisioned");
  const baseDir = `${repo}-wt`; // unique per run (repo is a fresh mkdtemp)

  const svc = new WorktreeService();
  const wt = await svc.create(repo, "1/1", baseDir);

  // The marker proves the command ran, and ran *inside the worktree*.
  assert.ok(
    await exists(path.join(wt, ".provisioned")),
    "marker .provisioned should exist in the freshly-added worktree",
  );
  // It ran in the worktree, not the canonical repo.
  assert.equal(
    await exists(path.join(repo, ".provisioned")),
    false,
    "the recipe must not run in the canonical repo",
  );
});

test("no declaration → provisions nothing, no Node/node_modules assumption", async () => {
  const repo = initRepo(); // no repo-conventions installed
  const baseDir = `${repo}-wt`; // unique per run (repo is a fresh mkdtemp)

  const svc = new WorktreeService();
  const wt = await svc.create(repo, "1/2", baseDir);

  // The worktree exists, but nothing was provisioned…
  assert.ok(await exists(wt), "worktree should still be created");
  assert.equal(await exists(path.join(wt, ".provisioned")), false);
  // …and crucially no Node assumption: no node_modules is conjured.
  assert.equal(
    await exists(path.join(wt, "node_modules")),
    false,
    "a repo with no recipe must make no node_modules assumption",
  );
});

test("provisionWorktree returns ran:false when no recipe is declared", async () => {
  const repo = initRepo();
  const result = await provisionWorktree(repo, repo);
  assert.deepEqual(result, { ran: false });
});

test("provisionWorktree runs the declared command in the given cwd (marker)", async () => {
  const repo = initRepo();
  await declareRecipe(repo, "touch .provisioned");
  const wt = mkdtempSync(path.join(os.tmpdir(), "tk-prov-wt-"));

  const result = await provisionWorktree(repo, wt);

  assert.equal(result.ran, true);
  assert.equal(result.command, "touch .provisioned");
  assert.equal(result.code, 0);
  assert.ok(await exists(path.join(wt, ".provisioned")));
});

test("parseProvisionRecipe: only the Worktree-setup `setup` block matches", () => {
  const md = [
    "# repo-conventions",
    "",
    "## Examples",
    "",
    "```setup",
    "this is NOT the recipe (wrong section)",
    "```",
    "",
    "## Worktree setup",
    "",
    "```setup",
    "npm ci",
    "```",
    "",
    "## Verify",
    "",
    "```setup",
    "also not the recipe",
    "```",
  ].join("\n");
  assert.equal(parseProvisionRecipe(md), "npm ci");
});

test("parseProvisionRecipe: undefined when no Worktree-setup section", () => {
  assert.equal(
    parseProvisionRecipe("# repo-conventions\n\nno setup here\n"),
    undefined,
  );
});
