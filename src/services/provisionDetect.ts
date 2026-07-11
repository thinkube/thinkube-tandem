/**
 * provisionDetect — language-agnostic worktree-setup DETECTION (2026-07-11).
 *
 * `provisionWorktree` runs a repo's *declared* setup recipe; with no
 * declaration it used to provision NOTHING. That silence is exactly how
 * thinkube-control's fresh worktrees ended up with no `frontend/node_modules`:
 * nobody had declared a recipe, so a signed `tsc` probe exited 127 on every
 * run and read as a phantom code failure.
 *
 * This module supplies the DEFAULT: scan the repo's tracked files for the
 * standard dependency manifests and derive the obvious idempotent setup
 * command per directory. A declared recipe (repo-conventions `## Worktree
 * setup`) still OVERRIDES detection entirely — this is the floor, not the
 * ceiling.
 *
 * Detection is lockfile-first (reproducible installs only); an ecosystem
 * without its lockfile is skipped rather than guessed at. Tracked files come
 * from `git ls-files` (never walks node_modules & friends by construction).
 */
import * as path from "node:path";
import { execFile } from "node:child_process";

/** One detected setup step: `command` run from `dir` (repo-relative, "" = root). */
export interface DetectedSetup {
  dir: string;
  command: string;
}

/** Manifest basename → the idempotent, lockfile-pinned install command. */
const MANIFEST_COMMANDS: ReadonlyArray<{ file: string; command: string }> = [
  { file: "package-lock.json", command: "npm ci" },
  { file: "pnpm-lock.yaml", command: "pnpm install --frozen-lockfile" },
  { file: "yarn.lock", command: "yarn install --frozen-lockfile" },
  { file: "uv.lock", command: "uv sync" },
  { file: "poetry.lock", command: "poetry install" },
  { file: "go.mod", command: "go mod download" },
  { file: "Cargo.lock", command: "cargo fetch" },
  {
    file: "requirements.txt",
    command:
      "python3 -m venv .venv && .venv/bin/python -m pip install -q -r requirements.txt",
  },
];

/** Cap on detected steps — a pathological monorepo should declare its recipe
 *  instead of getting an unbounded install storm. */
const MAX_STEPS = 8;

/** List a repo's tracked files (repo-relative). Injectable for tests. */
export type ListTracked = (repoRoot: string) => Promise<string[]>;

const defaultListTracked: ListTracked = (repoRoot) =>
  new Promise((resolve) => {
    execFile(
      "git",
      ["-C", repoRoot, "ls-files"],
      { maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => resolve(err ? [] : stdout.split("\n").filter(Boolean)),
    );
  });

/**
 * Detect the repo's setup steps from its tracked manifests. One step per
 * (directory, ecosystem): the first matching manifest in `MANIFEST_COMMANDS`
 * order wins per directory (so `package-lock.json` beats a sibling
 * `yarn.lock` never both). Root-first, then by path depth, capped at
 * {@link MAX_STEPS} (overflow is the caller's cue to declare a recipe).
 */
export async function detectProvisionSteps(
  repoRoot: string,
  listTracked: ListTracked = defaultListTracked,
): Promise<DetectedSetup[]> {
  const tracked = await listTracked(repoRoot);
  const byDir = new Map<string, string>(); // dir → command (first match wins)
  for (const { file, command } of MANIFEST_COMMANDS) {
    for (const rel of tracked) {
      if (path.basename(rel) !== file) continue;
      const dir = path.dirname(rel) === "." ? "" : path.dirname(rel);
      if (!byDir.has(dir)) byDir.set(dir, command);
    }
  }
  return [...byDir.entries()]
    .map(([dir, command]) => ({ dir, command }))
    .sort(
      (a, b) =>
        a.dir.split("/").filter(Boolean).length -
          b.dir.split("/").filter(Boolean).length || a.dir.localeCompare(b.dir),
    )
    .slice(0, MAX_STEPS);
}
