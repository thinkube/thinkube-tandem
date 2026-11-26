/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The owner of a module: the one Claude Code session in charge of it.
 *
 * What the person types in that session, and the commits made while it
 * works, are filed in the module's journal. A session owns one module at a
 * time, and a module has one owner at a time: taking a module replaces its
 * owner, and a session that takes a second module leaves the first.
 *
 * On disk: `modules/<module-id>/owner/<author>.json` names the session and
 * where the module's folder is on this machine. Every change is also a row
 * of the journal, so who owned the module, and when, stays readable.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { appendRow, moduleHome } from "./journal";

interface Owner {
  session: string;
  /** Since when, ISO 8601 in UTC. */
  at: string;
  /** The module's folder on this machine. */
  dir: string;
}

function ownerFile(storeRoot: string, moduleId: string, author: string): string {
  return path.join(moduleHome(storeRoot, moduleId), "owner", `${author}.json`);
}

/** The session that owns a module, when one does. */
export function ownerOf(storeRoot: string, moduleId: string, author: string): Owner | undefined {
  const file = ownerFile(storeRoot, moduleId, author);
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8")) as Owner;
}

/** The module a session owns, when it owns one. */
export function ownedBy(
  storeRoot: string,
  author: string,
  session: string,
): { moduleId: string; owner: Owner } | undefined {
  const home = path.join(storeRoot, "modules");
  if (!fs.existsSync(home)) return undefined;
  for (const e of fs.readdirSync(home, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const owner = ownerOf(storeRoot, e.name, author);
    if (owner?.session === session) return { moduleId: e.name, owner };
  }
  return undefined;
}

/** The session leaves the module it owns. Returns the module it left. */
export function leave(
  storeRoot: string,
  author: string,
  session: string,
  now: () => string,
): string | undefined {
  const held = ownedBy(storeRoot, author, session);
  if (!held) return undefined;
  fs.rmSync(ownerFile(storeRoot, held.moduleId, author));
  appendRow(storeRoot, held.moduleId, { kind: "owner", state: "left", session, author }, now);
  return held.moduleId;
}

/**
 * The session takes a module. The session that owned it before, if another,
 * is recorded as having left; so is this session's hold on another module.
 */
export function take(
  storeRoot: string,
  author: string,
  session: string,
  module: { id: string; dir: string },
  now: () => string,
): Owner {
  const before = ownerOf(storeRoot, module.id, author);
  if (before?.session === session && before.dir === module.dir) return before;
  if (ownedBy(storeRoot, author, session)?.moduleId !== module.id) leave(storeRoot, author, session, now);
  if (before && before.session !== session)
    appendRow(
      storeRoot,
      module.id,
      { kind: "owner", state: "left", session: before.session, author },
      now,
    );
  const owner: Owner = { session, at: now(), dir: module.dir };
  const file = ownerFile(storeRoot, module.id, author);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(owner, null, 2)}\n`);
  if (before?.session !== session)
    appendRow(storeRoot, module.id, { kind: "owner", state: "took", session, author }, now);
  return owner;
}
