/**
 * @thinky chat participant — vscode wiring only (Phase C, 2026-07-17).
 * All behavior lives in chatCore.ts (pure, tested); this file adapts the
 * VS Code chat API to it and registers the follow-up button command.
 *
 * Ships dark on hosts without the chat API (the plan's Phase B contingency):
 * registration is guarded, so the extension activates fine either way.
 */

import * as vscode from "vscode";
import { getScratchpadSession } from "../session";
import { handleThinkyRequest, type ThinkySessionLike } from "./chatCore";

export function registerThinkyParticipant(
  context: vscode.ExtensionContext,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.thinky.say",
      async (utterance: unknown) => {
        const session = getScratchpadSession();
        if (!session || typeof utterance !== "string" || !utterance.trim()) {
          return;
        }
        await session.postFromWebview({ type: "command", utterance });
      },
    ),
  );

  const chatApi = (
    vscode as unknown as {
      chat?: {
        createChatParticipant?: (
          id: string,
          handler: (
            request: {
              prompt: string;
              command?: string;
            },
            chatContext: unknown,
            stream: {
              markdown(value: string): void;
              button(button: {
                command: string;
                title: string;
                arguments?: unknown[];
              }): void;
            },
            token: unknown,
          ) => Promise<void>,
        ) => vscode.Disposable & { iconPath?: vscode.Uri };
      };
    }
  ).chat;
  if (!chatApi?.createChatParticipant) {
    return; // host has no chat surface — participant ships dark
  }

  const participant = chatApi.createChatParticipant(
    "thinkube.thinky",
    async (request, _chatContext, stream, _token) => {
      const session = getScratchpadSession() as
        | ThinkySessionLike
        | undefined;
      await handleThinkyRequest(
        { prompt: request.prompt, command: request.command },
        session,
        stream,
      );
    },
  );
  participant.iconPath = vscode.Uri.joinPath(
    context.extensionUri,
    "resources",
    "tk_ai.svg",
  );
  context.subscriptions.push(participant);
}
