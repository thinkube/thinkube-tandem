#!/usr/bin/env node
/**
 * Harness for SP-9_SL-3 — retiring a worktree is a pure code operation.
 *
 * With a real git repo + worktree, proves WorktreeService.remove: removes a
 * clean worktree while a separate sidecar board is left untouched (no stranded
 * card), and refuses to remove a worktree with uncommitted work (AC #4).
 *
 * Build first: `npm run compile`. Run: `node scripts/worktree-retire-harness.mjs`.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const require = createRequire(import.meta.url);
const { WorktreeService } = require(
  path.join(REPO, "dist", "services", "WorktreeService.js"),
);

const tmp = mkdtempSync(path.join(tmpdir(), "wt-retire-"));
const repo = path.join(tmp, "repo");
const wtBase = path.join(tmp, "repo-worktrees");
const sidecarMarker = path.join(
  tmp,
  "board",
  "Platform",
  "repo",
  "specs",
  "x.md",
);

mkdirSync(repo, { recursive: true });
const git = (...a) =>
  execFileSync("git", ["-C", repo, ...a], { stdio: "ignore" });
execFileSync("git", ["init", "-q", repo], { stdio: "ignore" });
git("config", "user.email", "h@t");
git("config", "user.name", "h");
writeFileSync(path.join(repo, "README.md"), "x\n");
git("add", ".");
git("commit", "-qm", "init");
// a separate sidecar board (the worktree carries no board of its own)
mkdirSync(path.dirname(sidecarMarker), { recursive: true });
writeFileSync(sidecarMarker, "the board\n");

const svc = new WorktreeService();
const checks = [];
const record = (label, pass, detail) => {
  checks.push({ label, pass });
  console.log(`${pass ? "  ✅" : "  ❌"} ${label}`);
  if (detail) console.log(`        ${detail}`);
};

console.log("\nharness — SP-9_SL-3 retire is pure code\n");

// 1. clean worktree → removed; sidecar board untouched.
const cleanWt = path.join(wtBase, "SP-1");
execFileSync(
  "git",
  ["-C", repo, "worktree", "add", "-q", cleanWt, "-b", "spec/SP-1"],
  {
    stdio: "ignore",
  },
);
let removed = "";
try {
  removed = await svc.remove(repo, "1");
} catch (e) {
  removed = `ERROR: ${e.message}`;
}
record(
  "retiring a clean worktree removes it",
  removed === cleanWt && !existsSync(cleanWt),
  `removed=${removed} gone=${!existsSync(cleanWt)}`,
);
record(
  "the sidecar board is untouched after retire (no stranded card)",
  existsSync(sidecarMarker),
  `marker exists=${existsSync(sidecarMarker)}`,
);

// 2. dirty worktree → refused (no silent data loss).
const dirtyWt = path.join(wtBase, "SP-2");
execFileSync(
  "git",
  ["-C", repo, "worktree", "add", "-q", dirtyWt, "-b", "spec/SP-2"],
  {
    stdio: "ignore",
  },
);
writeFileSync(path.join(dirtyWt, "scratch.txt"), "uncommitted\n");
let refused = false;
let msg = "";
try {
  await svc.remove(repo, "2");
} catch (e) {
  refused = true;
  msg = e.message;
}
record(
  "retiring a DIRTY worktree is refused (SP-5 guard preserved)",
  refused && /uncommitted/i.test(msg) && existsSync(dirtyWt),
  msg.slice(0, 120),
);

const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} behaviours held\n`);
rmSync(tmp, { recursive: true, force: true });
process.exit(passed === checks.length ? 0 : 1);
