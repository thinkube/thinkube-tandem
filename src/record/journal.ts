/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A module's journal: what was said to its owner session, what that session
 * sent to others and what was committed to the module, as rows that are
 * only ever added.
 *
 * The rows are facts the tool observed. A hook the engine runs writes them,
 * so the session that does the work never reports on itself.
 *
 * On disk: `modules/<module-id>/journal/<author>/<day>--<session>.jsonl`.
 * One session writes one file a day, so two sessions never write the same
 * file and two machines never produce the same file name.
 */
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

interface Stamp {
  /** Sortable and unique: the time, then a few random characters. */
  id: string;
  /** When the tool saw it, ISO 8601 in UTC. */
  at: string;
  /** The Claude Code session that was the owner then. */
  session: string;
  author: string;
}

/** A prompt that entered the owner session, word for word. */
export interface Said extends Stamp {
  kind: "said";
  /** The person, or another session that sent a message. */
  by: "person" | "session";
  /** Where the engine says the prompt came from. */
  origin: string;
  text: string;
  /** The request between modules this message carried, when it was one. */
  request?: string;
}

/** A message the owner session sent to another session or agent. */
interface Sent extends Stamp {
  kind: "sent";
  /** The recipient, as the session named it. */
  to: string;
  text: string;
}

/** A commit that touched the module's files. */
interface CommitSeen extends Stamp {
  kind: "commit";
  sha: string;
  subject: string;
  /** Who made the commit, as git names them. */
  committer: string;
  committedAt: string;
  /** The module's files the commit changed, relative to the repository. */
  files: string[];
  /** What was last said to the session, by the person or by another
   *  session, when the commit was made after it. */
  said?: string;
}

/** A session took the module, or left it. */
interface OwnerChange extends Stamp {
  kind: "owner";
  state: "took" | "left";
}

export type Row = Said | Sent | CommitSeen | OwnerChange;

/** A row before the journal stamps it. */
type NewRow =
  | Omit<Said, "id" | "at">
  | Omit<Sent, "id" | "at">
  | Omit<CommitSeen, "id" | "at">
  | Omit<OwnerChange, "id" | "at">;

/** The folder of one module in the store. */
export function moduleHome(storeRoot: string, moduleId: string): string {
  return path.join(storeRoot, "modules", moduleId);
}

function journalDir(storeRoot: string, moduleId: string): string {
  return path.join(moduleHome(storeRoot, moduleId), "journal");
}

/** Add one row. Returns it as written. */
export function appendRow(storeRoot: string, moduleId: string, row: NewRow, now: () => string): Row {
  const at = now();
  const stamped = { ...row, id: `${at}-${randomBytes(3).toString("hex")}`, at } as Row;
  const dir = path.join(journalDir(storeRoot, moduleId), stamped.author);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    path.join(dir, `${at.slice(0, 10)}--${stamped.session}.jsonl`),
    `${JSON.stringify(stamped)}\n`,
  );
  return stamped;
}

function rowsOfFile(file: string): Row[] {
  const out: Row[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    out.push(JSON.parse(line) as Row);
  }
  return out;
}

/** Every journal file of a module, with the day it holds. */
function journalFiles(storeRoot: string, moduleId: string): { day: string; file: string }[] {
  const dir = journalDir(storeRoot, moduleId);
  if (!fs.existsSync(dir)) return [];
  const out: { day: string; file: string }[] = [];
  for (const author of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!author.isDirectory()) continue;
    for (const name of fs.readdirSync(path.join(dir, author.name)))
      if (name.endsWith(".jsonl"))
        out.push({ day: name.slice(0, 10), file: path.join(dir, author.name, name) });
  }
  return out;
}

/**
 * The newest rows of a module, oldest first. Whole days are read, newest
 * day first, until `enough` says the rows read so far will do; with no
 * `enough` the whole journal is read.
 */
export function readRows(
  storeRoot: string,
  moduleId: string,
  enough?: (rows: readonly Row[]) => boolean,
): Row[] {
  const files = journalFiles(storeRoot, moduleId);
  const days = [...new Set(files.map((f) => f.day))].sort().reverse();
  const rows: Row[] = [];
  for (const day of days) {
    for (const f of files) if (f.day === day) rows.push(...rowsOfFile(f.file));
    if (enough?.(rows)) break;
  }
  return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
