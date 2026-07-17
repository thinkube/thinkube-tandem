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

/** The narrow session surface the chat handler needs. */
export interface ThinkySessionLike {
  readonly model: WorkingModel;
  /** Outcome text of the last command routed through the session. */
  readonly lastCommandMessage: string | undefined;
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

  if (stream.button) {
    stream.button({
      command: "thinkube.thinky.say",
      title: "Check readiness",
      arguments: ["check readiness"],
    });
    stream.button({
      command: "thinkube.thinky.say",
      title: "Reframe intent",
      arguments: ["reframe"],
    });
  }
}
