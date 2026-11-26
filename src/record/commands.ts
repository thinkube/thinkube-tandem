/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the record does when the engine tells it something happened in a
 * session: a prompt entered, a turn ended, the person took or left a module.
 *
 * Each command takes what the engine knows and answers with what the
 * session is to show. Nothing here is asked of a model.
 */
import * as path from "node:path";
import { scanForSecrets } from "../engine/store/frontmatter";
import { fileNewCommits, startLooking } from "./commits";
import { appendRow } from "./journal";
import { enableModule, placeAt, placeOf } from "./modules";
import { leave, ownedBy, take } from "./owner";
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
  | { ok: true; view?: View; filed?: boolean; commits?: number; note?: string }
  | { ok: false; reason: string };

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

/** A prompt entered the session. Filed when the session owns a module. */
export function said(
  deps: Deps,
  input: From & { text: string; origin: string; surface: string | null },
): Answer {
  const by = whoSaid(input.origin, input.surface);
  if (!by) return { ok: true, filed: false };
  const held = ownedBy(deps.storeRoot, deps.author, input.session);
  if (!held) return { ok: true, filed: false };
  // The store is pushed to a remote, so it scans every write for what looks
  // like a secret and refuses a hit. The hook masks what the engine finds
  // before it calls; this is the store's own guard.
  const secrets = [...new Set(scanForSecrets(input.text).map((hit) => hit.pattern))];
  if (secrets.length > 0)
    return {
      ok: false,
      reason: `A prompt was not kept: it holds what looks like a secret (${secrets.join(", ")}), and the store is pushed to a remote.`,
    };
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
    },
    deps.now,
  );
  return { ok: true, filed: true, view: viewOf(deps.storeRoot, deps.author, input.session, input.cwd) };
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

/** What the session shows now. */
export function view(deps: Deps, input: From): Answer {
  return { ok: true, view: viewOf(deps.storeRoot, deps.author, input.session, input.cwd) };
}
