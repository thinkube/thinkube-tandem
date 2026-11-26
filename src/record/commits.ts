/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What was implemented, read from the repository and never from a session.
 *
 * When a turn of the owner session ends, the commits that reached the
 * module's checkout since the last look are filed in its journal: each one
 * that changed a file the module owns. It does not matter how a commit was
 * made: by the session, by a script it ran, or from the person's own shell.
 *
 * A commit is tied to the person's sentence the session was working on only
 * when it was made after that sentence. Whether it does what the sentence
 * asked is not decided here.
 *
 * On disk: `modules/<module-id>/seen/<author>.json` holds the commit the
 * checkout stood at when it was last looked at.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { appendRow, moduleHome, readRows } from "./journal";
import type { Said } from "./journal";
import { declaredPrefixes, owningPrefix } from "./modules";

interface Where {
  storeRoot: string;
  author: string;
  session: string;
  module: { id: string; gitRoot: string; prefix: string };
  now: () => string;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, "-c", "core.quotePath=false", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
  });
}

/** Whether git answers the question with a yes: exit code 0. */
function holds(cwd: string, args: string[]): boolean {
  try {
    git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

function seenFile(storeRoot: string, moduleId: string, author: string): string {
  return path.join(moduleHome(storeRoot, moduleId), "seen", `${author}.json`);
}

/** The commit the checkout stands at; undefined in a repository with none. */
function headOf(gitRoot: string): string | undefined {
  return holds(gitRoot, ["rev-parse", "-q", "--verify", "HEAD^{commit}"])
    ? git(gitRoot, ["rev-parse", "HEAD"]).trim()
    : undefined;
}

function writeSeen(w: Where, head: string): void {
  const file = seenFile(w.storeRoot, w.module.id, w.author);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ head }, null, 2)}\n`);
}

/**
 * Start looking from where the checkout stands now. Called when a session
 * takes a module that was never looked at: commits made before the record
 * began are not claimed by it.
 */
export function startLooking(w: Where): void {
  if (fs.existsSync(seenFile(w.storeRoot, w.module.id, w.author))) return;
  const head = headOf(w.module.gitRoot);
  if (head) writeSeen(w, head);
}

interface LoggedCommit {
  sha: string;
  subject: string;
  committer: string;
  committedAt: string;
  files: string[];
}

const RECORD = "\u001e";
const FIELD = "\u001f";

function commitsBetween(gitRoot: string, range: string): LoggedCommit[] {
  const out = git(gitRoot, [
    "log",
    "--no-merges",
    "--reverse",
    `--format=${RECORD}%H${FIELD}%s${FIELD}%cn${FIELD}%cI`,
    "--name-only",
    range,
  ]);
  return out
    .split(RECORD)
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const [header, ...rest] = chunk.split("\n");
      const [sha, subject, committer, committedAt] = header.split(FIELD);
      return { sha, subject, committer, committedAt, files: rest.filter((l) => l.trim()) };
    });
}

/**
 * File the commits that reached the checkout since the last look. Returns
 * how many rows were added, and a note when the last look cannot be
 * continued from.
 */
export function fileNewCommits(w: Where): { filed: number; note?: string } {
  const head = headOf(w.module.gitRoot);
  if (!head) return { filed: 0 };
  const file = seenFile(w.storeRoot, w.module.id, w.author);
  if (!fs.existsSync(file)) {
    writeSeen(w, head);
    return { filed: 0 };
  }
  const seen = (JSON.parse(fs.readFileSync(file, "utf8")) as { head: string }).head;
  if (seen === head) return { filed: 0 };
  if (!holds(w.module.gitRoot, ["cat-file", "-e", `${seen}^{commit}`])) {
    writeSeen(w, head);
    return {
      filed: 0,
      note: `Commit ${seen.slice(0, 7)}, where the record last looked, is no longer in this checkout. The record continues from ${head.slice(0, 7)}; commits between the two are not filed.`,
    };
  }

  const prefixes = [...new Set([...declaredPrefixes(w.module.gitRoot), w.module.prefix])];
  const mine = commitsBetween(w.module.gitRoot, `${seen}..${head}`)
    .map((c) => ({
      ...c,
      files: c.files.filter((f) => owningPrefix(f, prefixes) === w.module.prefix),
    }))
    .filter((c) => c.files.length > 0);

  let filed = 0;
  if (mine.length > 0) {
    const rows = readRows(w.storeRoot, w.module.id);
    const known = new Set(rows.flatMap((r) => (r.kind === "commit" ? [r.sha] : [])));
    const sentence = rows
      .filter((r): r is Said => r.kind === "said" && r.by === "person" && r.session === w.session)
      .at(-1);
    // Git keeps a commit's time to the second.
    const since = sentence ? Math.floor(Date.parse(sentence.at) / 1000) * 1000 : undefined;
    for (const c of mine) {
      if (known.has(c.sha)) continue;
      const after = since !== undefined && Date.parse(c.committedAt) >= since;
      appendRow(
        w.storeRoot,
        w.module.id,
        {
          kind: "commit",
          session: w.session,
          author: w.author,
          sha: c.sha,
          subject: c.subject,
          committer: c.committer,
          committedAt: c.committedAt,
          files: c.files,
          ...(sentence && after ? { said: sentence.id } : {}),
        },
        w.now,
      );
      filed++;
    }
  }
  writeSeen(w, head);
  return { filed };
}
