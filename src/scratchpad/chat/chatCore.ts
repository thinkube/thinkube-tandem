/**
 * chatCore — the pure heart of the @thinky chat participant (Phase C, 2026-07-17).
 *
 * "Thinky" is the Thinkube assistant name (consistent with the Jupyter
 * assistant). The chat surface is a THIN mouth over the one inbound seam every
 * surface shares: session.postFromWebview({ type: "command", utterance }).
 * The classifier inside the session decides what the utterance IS (operation |
 * statement | ask | question) — the participant never re-implements routing.
 *
 * No `vscode` import here: everything is testable with fakes. The vscode
 * wiring lives in participant.ts.
 */

import type { WorkingModel } from "../model";
import type { ScratchpadInboundMessage } from "../session";

/**
 * Session-resource binding (2026-07-17): a Thinky chat session's resource URI
 * is thinky:/<namespace>/<space> — namespace may be nested (e.g.
 * "Platform/projects/plugin-delivery"), space is the last segment.
 */
export function spaceToSessionPath(namespace: string, space: string): string {
  return `/${namespace}/${space}`;
}

export function sessionPathToSpace(
  path: string,
): { namespace: string; space: string } | undefined {
  const clean = path.replace(/^\/+/, "").replace(/\/+$/, "");
  const idx = clean.lastIndexOf("/");
  if (idx <= 0) return undefined;
  const namespace = clean.slice(0, idx);
  const space = clean.slice(idx + 1);
  if (!namespace || !space) return undefined;
  return { namespace, space };
}

/**
 * Extract the bound space from a participant request's chatContext (shape
 * verified against the shipped extension host: context.chatSessionContext
 * .chatSessionItem.resource is the session URI). Returns undefined for
 * untitled sessions and non-session (@mention) requests — those use the
 * active space.
 */
export function boundSpaceFromChatContext(
  chatContext: unknown,
): { namespace: string; space: string } | undefined {
  if (typeof chatContext !== "object" || chatContext === null) return undefined;
  const sc = (chatContext as { chatSessionContext?: unknown }).chatSessionContext;
  if (typeof sc !== "object" || sc === null) return undefined;
  const item = (sc as { chatSessionItem?: unknown }).chatSessionItem;
  if (typeof item !== "object" || item === null) return undefined;
  const resource = (item as { resource?: unknown }).resource;
  if (typeof resource !== "object" || resource === null) return undefined;
  const path = (resource as { path?: unknown }).path;
  if (typeof path !== "string") return undefined;
  return sessionPathToSpace(path);
}

/** The narrow session surface the chat handler needs. */
export interface ThinkySessionLike {
  readonly model: WorkingModel;
  /** Outcome text of the last command routed through the session. */
  readonly lastCommandMessage: string | undefined;
  /** Items staged for action (optional for fakes/back-compat). */
  readonly selectionCount?: number;
  postFromWebview(message: ScratchpadInboundMessage): Promise<void>;
}

/** The narrow response-stream surface (vscode.ChatResponseStream subset). */
export interface ThinkyStreamLike {
  markdown(value: string): void;
  button?(button: {
    command: string;
    title: string;
    arguments?: unknown[];
  }): void;
}

/**
 * Slash commands the participant contributes. Each maps deterministically to
 * a command-field utterance the session already understands — the chat adds
 * no new verbs.
 */
export const THINKY_SLASH_COMMANDS: Record<string, string> = {
  readiness: "check readiness",
  reframe: "reframe",
  contextualize: "contextualize",
  panic: "panic",
};

/** Compact space status appended to every reply. */
export function renderThinkyStatus(model: WorkingModel): string {
  const journal = 1 + (model.roughRequests?.length ?? 0);
  const assumptions = model.assumptions?.length ?? 0;
  const parts: string[] = [];
  for (const sec of model.sections) {
    if (sec.kind === "goal") continue;
    const active = sec.items.filter((it) => it.state === "active");
    if (active.length === 0) continue;
    const settled = active.filter((it) => it.checked).length;
    parts.push(`${sec.kind} ${settled}/${active.length}`);
  }
  const lines = [
    `— journal ${journal} · assumptions ${assumptions}${
      parts.length > 0 ? ` · ${parts.join(" · ")}` : " · no items yet"
    }`,
  ];
  if (model.curatedTitle) {
    lines.push(`— curated: **${model.curatedTitle}**`);
  }
  return lines.join("\n");
}

/**
 * Handle one @thinky request. `command` is the slash command (if any),
 * `prompt` the free text. Returns after the session fully processed it.
 */
export async function handleThinkyRequest(
  args: { prompt: string; command?: string },
  session: ThinkySessionLike | undefined,
  stream: ThinkyStreamLike,
): Promise<void> {
  if (!session) {
    stream.markdown(
      "No thinking space is open. Open one from the ThinkingSpaces view " +
        "(or run **Thinkube: Open Thinking Space**), then talk to me here — " +
        "statements become standing assumptions, asks become journal entries, " +
        "questions get answered from the space.",
    );
    return;
  }

  const utterance = args.command
    ? (THINKY_SLASH_COMMANDS[args.command] ?? args.prompt.trim())
    : args.prompt.trim();

  if (!utterance) {
    stream.markdown(`Here is where the space stands:\n\n${renderThinkyStatus(session.model)}`);
    return;
  }

  await session.postFromWebview({ type: "command", utterance });

  const outcome = session.lastCommandMessage;
  stream.markdown(outcome ?? "Done.");
  stream.markdown(`\n\n${renderThinkyStatus(session.model)}`);

  emitFollowUpButtons(session, stream);
}

/**
 * Context-aware follow-up buttons (field defect 2026-07-17: after STAGING,
 * the reply offered readiness/reframe — reframe then errored because staging
 * is not checking; the right next act was an apply-verb). The buttons must
 * mirror the state machine:
 *  - staged selection pending → the apply verbs + clear
 *  - otherwise → readiness always; reframe ONLY once something is settled
 *    (the intent is rewritten FROM checked items — offering it earlier is a
 *    guaranteed error).
 */
export function emitFollowUpButtons(
  session: ThinkySessionLike,
  stream: ThinkyStreamLike,
): void {
  if (!stream.button) return;
  if ((session.selectionCount ?? 0) > 0) {
    stream.button({
      command: "thinkube.thinky.applySelection",
      title: "Check staged (settle)",
      arguments: ["check"],
    });
    stream.button({
      command: "thinkube.thinky.applySelection",
      title: "Defer staged",
      arguments: ["defer"],
    });
    stream.button({
      command: "thinkube.thinky.applySelection",
      title: "Drop staged (veto)",
      arguments: ["drop"],
    });
    stream.button({
      command: "thinkube.thinky.say",
      title: "Clear selection",
      arguments: ["clear selection"],
    });
    return;
  }
  stream.button({
    command: "thinkube.thinky.say",
    title: "Check readiness",
    arguments: ["check readiness"],
  });
  const anythingSettled = session.model.sections.some(
    (s) =>
      s.kind !== "goal" &&
      s.items.some((it) => it.checked && it.state === "active"),
  );
  if (anythingSettled) {
    stream.button({
      command: "thinkube.thinky.say",
      title: "Reframe intent",
      arguments: ["reframe"],
    });
  }
}
