/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a session is shown of the record: the module it owns, with the last
 * things said to it and the commits under each, the requests between it and
 * other modules, and the messages it sent; or, when it owns none, the
 * modules it could take from where it stands.
 */
import * as path from "node:path";
import { readRows } from "./journal";
import type { Row } from "./journal";
import { moduleAt, placeAt, placesFrom } from "./modules";
import { ownedBy, ownerOf } from "./owner";
import { requestMessage, requestsOf, stateOf } from "./requests";

interface CommitView {
  sha: string;
  subject: string;
}

interface SentenceView {
  id: string;
  at: string;
  by: "person" | "session";
  text: string;
  /** The request between modules this message carried, when it was one. */
  request?: string;
  commits: CommitView[];
}

interface RequestView {
  id: string;
  /** Asked by this module, or received by it. */
  direction: "asked" | "received";
  /** The other module's name. */
  module: string;
  text: string;
  /** Where it stands, in words for the person. */
  state: string;
  answer?: string;
  /** For a request received that this session has not been given yet: the
   *  message that starts the work on it. */
  message?: string;
}

interface SentView {
  at: string;
  to: string;
  text: string;
}

interface PlaceView {
  dir: string;
  label: string;
  /** The repository's folder name, and the module's path inside it. */
  repo: string;
  prefix: string;
  /** Whether a session owns it: this one, another, or none. */
  owner: "this" | "other" | "none";
}

export interface View {
  /** The module this session owns. */
  module?: { id: string; label: string; product?: string; repo: string; prefix: string };
  /** The last things said to the owner session, oldest first. */
  sentences: SentenceView[];
  /** Commits filed under no sentence, oldest first. */
  loose: CommitView[];
  /** Requests between this module and others: every open one, and the last
   *  answered ones. */
  requests: RequestView[];
  /** The last messages the session sent to other sessions, oldest first. */
  sent: SentView[];
  /** With no module owned: the modules reachable from the session's folder. */
  here: PlaceView[];
  /** Something the person must know that fits nowhere above. */
  note?: string;
}

const SENTENCES = 8;
const LOOSE = 5;
const PLACES = 40;
const ANSWERED = 3;
const SENT = 5;

function saidCount(rows: readonly Row[]): number {
  return rows.filter((r) => r.kind === "said").length;
}

export function viewOf(storeRoot: string, author: string, session: string, cwd: string): View {
  const held = ownedBy(storeRoot, author, session);
  if (!held) {
    const here = placesFrom(cwd)
      .slice(0, PLACES)
      .map((place): PlaceView => {
        const known = moduleAt(place, storeRoot);
        const owner = known ? ownerOf(storeRoot, known.id, author) : undefined;
        return {
          dir: place.dir,
          label: known?.label ?? path.basename(place.dir),
          repo: path.basename(place.gitRoot),
          prefix: place.prefix,
          owner: !owner ? "none" : owner.session === session ? "this" : "other",
        };
      });
    return { sentences: [], loose: [], requests: [], sent: [], here };
  }

  const place = placeAt(held.owner.dir);
  const module = place ? moduleAt(place, storeRoot) : undefined;
  const rows = readRows(storeRoot, held.moduleId, (r) => saidCount(r) >= SENTENCES);
  const commits = rows.flatMap((r) => (r.kind === "commit" ? [r] : []));
  const sentences = rows
    .flatMap((r) => (r.kind === "said" ? [r] : []))
    .slice(-SENTENCES)
    .map(
      (s): SentenceView => ({
        id: s.id,
        at: s.at,
        by: s.by,
        text: s.text,
        ...(s.request ? { request: s.request } : {}),
        commits: commits
          .filter((c) => c.said === s.id)
          .map((c) => ({ sha: c.sha, subject: c.subject })),
      }),
    );
  const all = requestsOf(storeRoot, held.moduleId);
  const requests = [
    ...all.filter((r) => r.answered).slice(-ANSWERED),
    ...all.filter((r) => !r.answered),
  ].map((r): RequestView => {
    const received = r.to.module === held.moduleId;
    return {
      id: r.id,
      direction: received ? "received" : "asked",
      module: received ? r.from.label : r.to.label,
      text: r.text,
      state: stateOf(r),
      ...(r.answered ? { answer: r.answered.text } : {}),
      ...(received && !r.answered && !r.arrivedAt ? { message: requestMessage(r) } : {}),
    };
  });
  return {
    module: {
      id: held.moduleId,
      label: module?.label ?? held.moduleId,
      ...(module?.product ? { product: module.product } : {}),
      repo: place ? path.basename(place.gitRoot) : "",
      prefix: place?.prefix ?? "",
    },
    sentences,
    loose: commits
      .filter((c) => !c.said)
      .slice(-LOOSE)
      .map((c) => ({ sha: c.sha, subject: c.subject })),
    requests,
    sent: rows
      .flatMap((r) => (r.kind === "sent" ? [{ at: r.at, to: r.to, text: r.text }] : []))
      .slice(-SENT),
    here: [],
    ...(place
      ? {}
      : { note: `The module's folder, ${held.owner.dir}, is not there on this machine.` }),
  };
}
