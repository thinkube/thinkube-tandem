/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stage a tree's work for a commit, and nothing a tool generated.
 *
 * What is staged: every tracked change and every untracked file the
 * repository's ignore rules (and the worktree's own exclude file) leave
 * visible. What is never staged, whether or not the repository ignores it:
 * interpreter caches, installed dependencies and tool caches — a test run
 * writes them into the tree, and a delivery that carries them carries
 * binary noise the person never asked for. What was left out is said.
 */
import type { Exec } from "./oracle";

/** A directory that only ever holds what a tool generated. */
const GENERATED_DIRS = new Set([
  "__pycache__",
  "node_modules",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".nox",
  ".venv",
]);

/** A directory named for the package metadata a Python install writes. */
const GENERATED_DIR_NAME = /\.egg-info$/;

/** A file that only ever holds what a tool generated. */
const GENERATED_FILE = /\.(pyc|pyo|tsbuildinfo)$/;

/** Whether a repository-relative path is something a tool generated. */
function isGenerated(rel: string): boolean {
  const parts = rel.split("/");
  const dirs = parts.slice(0, -1);
  return dirs.some((d) => GENERATED_DIRS.has(d) || GENERATED_DIR_NAME.test(d)) || GENERATED_FILE.test(parts[parts.length - 1]);
}

/** How many paths one `git add` carries, so the argument list stays far
 *  below the system's limit. */
const PATHS_PER_ADD = 500;

async function git(exec: Exec, worktree: string, args: string[]): Promise<string> {
  const r = await exec("git", ["-C", worktree, ...args], worktree);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed in ${worktree}: ${r.out.trim()}`);
  return r.out;
}

/** The NUL-separated entries of a `-z` listing; what follows the last NUL
 *  is the exec's own newline and stderr, never an entry. */
function entries(out: string): string[] {
  return out.split("\0").slice(0, -1).filter(Boolean);
}

/**
 * Stage the work in `worktree`. Returns what this call staged, what it left
 * out, and whether the index now holds anything for a commit; `log` hears
 * the left-out paths when there are any.
 */
export async function stageWork(a: {
  worktree: string;
  exec: Exec;
  log: (line: string) => void;
}): Promise<{ staged: string[]; leftOut: string[]; toCommit: boolean }> {
  const changed = new Set([
    ...entries(await git(a.exec, a.worktree, ["ls-files", "-z", "--modified", "--deleted"])),
    ...entries(await git(a.exec, a.worktree, ["ls-files", "-z", "--others", "--exclude-standard"])),
  ]);
  const staged = [...changed].filter((p) => !isGenerated(p)).sort();
  const leftOut = [...changed].filter(isGenerated).sort();
  for (let i = 0; i < staged.length; i += PATHS_PER_ADD)
    await git(a.exec, a.worktree, ["--literal-pathspecs", "add", "--", ...staged.slice(i, i + PATHS_PER_ADD)]);
  if (leftOut.length)
    a.log(
      `left out of the commit — generated, not the work (${leftOut.length}): ${leftOut.slice(0, 12).join(", ")}${leftOut.length > 12 ? "…" : ""}`,
    );
  const indexed = entries(await git(a.exec, a.worktree, ["diff", "--cached", "--name-only", "-z"]));
  return { staged, leftOut, toCommit: indexed.length > 0 };
}
