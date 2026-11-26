/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the record does when the engine tells it something happened in a
 * session: a prompt entered, a message left, a turn ended, the person took
 * or left a module, the session asked another module or answered one.
 *
 * Each command takes what the engine knows and answers with what the
 * session is to show. Nothing here is asked of a model.
 */
import * as path from "node:path";
import { allCards } from "../core/cards";
import { scanForSecrets } from "../engine/store/frontmatter";
import { fileNewCommits, startLooking } from "./commits";
import { appendRow } from "./journal";
import { enableModule, placeAt, placeOf } from "./modules";
import { leave, ownedBy, ownerOf, take } from "./owner";
import {
  answerMessage,
  openRequest,
  readRequest,
  requestCarriedBy,
  requestMessage,
  updateRequest,
} from "./requests";
import { viewOf } from "./view";
import type { View } from "./view";

export interface Deps {
  storeRoot: string;
  author: string;
  now: () => string;
}

/** What every command is told: which session, and where it stands. */
interface From {
  session: string;
  cwd: string;
}

export type Answer =
  | {
      ok: true;
      view?: View;
      filed?: boolean;
      commits?: number;
      note?: string;
      /** The request the command opened or answered. */
      request?: string;
      /** A message for the caller to hand to another session. */
      send?: { session: string; text: string };
    }
  | { ok: false; reason: string };

/**
 * Why a text is not written to the store, when it holds what looks like a
 * secret. The store is pushed to a remote, so it scans every write and
 * refuses a hit; a hook masks what the engine finds before it calls.
 */
function refusedForSecrets(what: string, text: string): Answer | undefined {
  const secrets = [...new Set(scanForSecrets(text).map((hit) => hit.pattern))];
  if (secrets.length === 0) return undefined;
  return {
    ok: false,
    reason: `${what} was not kept: it holds what looks like a secret (${secrets.join(", ")}), and the store is pushed to a remote.`,
  };
}

/**
 * Whose words a prompt is, from where the engine says it came from.
 *
 * - The person: typed at the prompt, or sent from their phone or browser.
 *   A prompt the SDK hands in counts only where a surface draws the session
 *   (the editor's panel): with none, a program wrote it.
 * - Another session: a message one session sent to this one.
 * - Anything else (a task's notice, a schedule, a plugin) is the engine's
 *   own traffic and is not filed.
 */
function whoSaid(origin: string, surface: string | null): "person" | "session" | undefined {
  if (origin === "composer" || origin === "bridge") return "person";
  if (origin === "sdk") return surface ? "person" : undefined;
  if (["peer", "peer-send-message", "coordinator", "projects-relay"].includes(origin))
    return "session";
  return undefined;
}

/**
 * A prompt entered the session. Filed when the session owns a module.
 *
 * A request that Tandem hands to this session arrives as a message from the
 * asking session or, started from the pane, as a prompt of the plugin. Its
 * arrival is noted on the request.
 */
export function said(
  deps: Deps,
  input: From & { text: string; origin: string; surface: string | null },
): Answer {
  const held = ownedBy(deps.storeRoot, deps.author, input.session);
  if (!held) return { ok: true, filed: false };
  const carried = requestCarriedBy(input.text);
  const request = carried ? readRequest(deps.storeRoot, carried) : undefined;
  const forMe = request?.to.module === held.moduleId ? request : undefined;
  const by =
    whoSaid(input.origin, input.surface) ??
    (forMe && input.origin === "plugin" ? "session" : undefined);
  if (!by) return { ok: true, filed: false };
  const refused = refusedForSecrets("A prompt", input.text);
  if (refused) return refused;
  const arrived = by === "session" ? forMe : undefined;
  appendRow(
    deps.storeRoot,
    held.moduleId,
    {
      kind: "said",
      by,
      origin: input.origin,
      text: input.text,
      session: input.session,
      author: deps.author,
      ...(arrived ? { request: arrived.id } : {}),
    },
    deps.now,
  );
  if (arrived && !arrived.arrivedAt)
    updateRequest(deps.storeRoot, arrived.id, (r) => ({ ...r, arrivedAt: deps.now() }));
  return { ok: true, filed: true, view: viewOf(deps.storeRoot, deps.author, input.session, input.cwd) };
}

/** A message left the owner session for another session or agent. */
export function sent(deps: Deps, input: From & { to: string; text: string }): Answer {
  const held = ownedBy(deps.storeRoot, deps.author, input.session);
  if (!held) return { ok: true, filed: false };
  const refused = refusedForSecrets("A message", input.text);
  if (refused) return refused;
  appendRow(
    deps.storeRoot,
    held.moduleId,
    { kind: "sent", to: input.to, text: input.text, session: input.session, author: deps.author },
    deps.now,
  );
  return { ok: true, filed: true, view: viewOf(deps.storeRoot, deps.author, input.session, input.cwd) };
}

/**
 * The owner session of a module asks another module for something. The
 * request is written first; the answer names the session to hand it to,
 * when the module asked has an owner.
 */
export function ask(deps: Deps, input: From & { to: string; text: string }): Answer {
  const held = ownedBy(deps.storeRoot, deps.author, input.session);
  if (!held)
    return {
      ok: false,
      reason:
        "This session owns no module, and a request comes from a module. Take one first: /module own <folder>.",
    };
  const cards = allCards(deps.storeRoot);
  const mine = cards.find((c) => c.id === held.moduleId);
  if (!mine) return { ok: false, reason: `The store has no card for the module ${held.moduleId}.` };
  const wanted = input.to.trim().toLowerCase();
  const found = cards.filter((c) => c.id.toLowerCase() === wanted || c.label.toLowerCase() === wanted);
  if (found.length === 0)
    return {
      ok: false,
      reason: `No module is called "${input.to}". The modules the record knows: ${cards
        .map((c) => c.label)
        .sort()
        .join(", ")}.`,
    };
  if (found.length > 1)
    return {
      ok: false,
      reason: `${found.length} modules are called "${input.to}". Name one by its id: ${found
        .map((c) => c.id)
        .join(", ")}.`,
    };
  const target = found[0];
  if (target.id === mine.id) return { ok: false, reason: "A module does not ask itself." };
  const refused = refusedForSecrets("The request", input.text);
  if (refused) return refused;

  const request = openRequest(
    deps.storeRoot,
    {
      from: { module: mine.id, label: mine.label, session: input.session },
      to: { module: target.id, label: target.label },
      text: input.text,
    },
    deps.now,
  );
  const owner = ownerOf(deps.storeRoot, target.id, deps.author);
  return {
    ok: true,
    request: request.id,
    ...(owner
      ? { send: { session: owner.session, text: requestMessage(request) } }
      : {
          note: `"${target.label}" has no owner session now. The request waits in its record, and the session that takes the module is shown it.`,
        }),
    view: viewOf(deps.storeRoot, deps.author, input.session, input.cwd),
  };
}

/** A request's message was handed to a session, or could not be. */
export function handed(
  deps: Deps,
  input: From & { request: string; to: string; delivered: boolean; reason?: string },
): Answer {
  const updated = updateRequest(deps.storeRoot, input.request, (r) => ({
    ...r,
    sent: [
      ...r.sent,
      {
        at: deps.now(),
        session: input.to,
        delivered: input.delivered,
        ...(input.reason ? { reason: input.reason } : {}),
      },
    ],
  }));
  if (!updated) return { ok: false, reason: `The record has no request ${input.request}.` };
  return { ok: true, view: viewOf(deps.storeRoot, deps.author, input.session, input.cwd) };
}

/**
 * The owner session of the module asked says what it did. The answer is
 * written on the request; the answer names the session to tell, when the
 * asking module has an owner.
 */
export function answer(deps: Deps, input: From & { request: string; text: string }): Answer {
  const held = ownedBy(deps.storeRoot, deps.author, input.session);
  const request = readRequest(deps.storeRoot, input.request);
  if (!request) return { ok: false, reason: `The record has no request ${input.request}.` };
  if (request.to.module !== held?.moduleId)
    return {
      ok: false,
      reason: `Request ${request.id} was made to the module "${request.to.label}", which this session does not own.`,
    };
  if (request.answered)
    return { ok: false, reason: `Request ${request.id} was already answered: ${request.answered.text}` };
  const refused = refusedForSecrets("The answer", input.text);
  if (refused) return refused;

  const answered = { ...request, answered: { at: deps.now(), session: input.session, text: input.text } };
  updateRequest(deps.storeRoot, request.id, () => answered);
  const owner = ownerOf(deps.storeRoot, request.from.module, deps.author);
  return {
    ok: true,
    request: request.id,
    ...(owner
      ? { send: { session: owner.session, text: answerMessage(answered) } }
      : { note: `"${request.from.label}" has no owner session now. The answer is in its record.` }),
    view: viewOf(deps.storeRoot, deps.author, input.session, input.cwd),
  };
}

/** A turn of the session ended. New commits to its module are filed. */
export function turnEnded(deps: Deps, input: From): Answer {
  const held = ownedBy(deps.storeRoot, deps.author, input.session);
  if (!held) return { ok: true };
  const place = placeAt(held.owner.dir);
  if (!place) return { ok: true, view: viewOf(deps.storeRoot, deps.author, input.session, input.cwd) };
  const { filed, note } = fileNewCommits({
    storeRoot: deps.storeRoot,
    author: deps.author,
    session: input.session,
    module: { id: held.moduleId, gitRoot: place.gitRoot, prefix: place.prefix },
    now: deps.now,
  });
  return {
    ok: true,
    commits: filed,
    ...(note ? { note } : {}),
    view: viewOf(deps.storeRoot, deps.author, input.session, input.cwd),
  };
}

/** The person makes this session the owner of the module at a folder. */
export function own(deps: Deps, input: From & { dir?: string }): Answer {
  const target = path.resolve(input.cwd, input.dir ?? ".");
  const place = placeOf(target);
  if (!place)
    return {
      ok: false,
      reason: `${target} is not inside a git repository, so there is no module to own there.`,
    };
  const enabled = enableModule(place, deps.storeRoot);
  if (!enabled.ok) return enabled;
  take(deps.storeRoot, deps.author, input.session, enabled.module, deps.now);
  startLooking({
    storeRoot: deps.storeRoot,
    author: deps.author,
    session: input.session,
    module: enabled.module,
    now: deps.now,
  });
  return { ok: true, view: viewOf(deps.storeRoot, deps.author, input.session, input.cwd) };
}

/** The person ends this session's ownership. */
export function leaveModule(deps: Deps, input: From): Answer {
  leave(deps.storeRoot, deps.author, input.session, deps.now);
  return { ok: true, view: viewOf(deps.storeRoot, deps.author, input.session, input.cwd) };
}

/** What the session shows now. An owner's view is brought up to date first:
 *  a commit made since the last turn ended is filed before it is shown. */
export function view(deps: Deps, input: From): Answer {
  const looked = turnEnded(deps, input);
  if (!looked.ok || looked.view) return looked;
  return { ok: true, view: viewOf(deps.storeRoot, deps.author, input.session, input.cwd) };
}
