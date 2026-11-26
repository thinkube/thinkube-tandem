/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the record's tests stand on: an empty store, a repository with
 * commits made at stated times, and a clock that moves when it is read.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function tmp(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `tandem-record-${name}-`));
}

function git(root: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Write files, relative to the root, and commit them at a stated time.
 *  Returns the commit. */
export function commit(
  root: string,
  files: Record<string, string>,
  message: string,
  at = "2026-03-01T12:00:00Z",
): string {
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  git(root, ["add", "--", ...Object.keys(files)]);
  git(root, ["commit", "-q", "-m", message], { GIT_COMMITTER_DATE: at, GIT_AUTHOR_DATE: at });
  return git(root, ["rev-parse", "HEAD"]).trim();
}

/** A repository with one commit holding the given files, in a folder of its
 *  own or in the one named. */
export function repoWith(files: Record<string, string>, root = tmp("repo")): string {
  fs.mkdirSync(root, { recursive: true });
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "t@t"]);
  git(root, ["config", "user.name", "Tester"]);
  commit(root, files, "base", "2026-01-01T00:00:00Z");
  return root;
}

/** A clock that starts at a stated time and moves a second each reading. */
export function clockFrom(start: string): () => string {
  let t = Date.parse(start);
  return () => {
    const at = new Date(t).toISOString();
    t += 1000;
    return at;
  };
}
