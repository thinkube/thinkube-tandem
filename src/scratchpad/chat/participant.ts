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


export function registerThinkyParticipant(
  context: vscode.ExtensionContext,
): void {
  // Follow-up button commands. Both surface their OUTCOME as a toast —
  // field defect 2026-07-17: a button whose result lands only in the webview
  // message strip is invisible from the chat.
  const toastOutcome = (session: { lastCommandMessage: string | undefined }) => {
    const msg = session.lastCommandMessage;
    vscode.window.showInformationMessage(
      msg ? msg.slice(0, 300) : "Done — see the thinking space.",
    );
  };
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.thinky.say",
      async (utterance: unknown) => {
        const session = getScratchpadSession();
        if (!session || typeof utterance !== "string" || !utterance.trim()) {
          return;
        }
        await session.postFromWebview({ type: "command", utterance });
        toastOutcome(session);
      },
    ),
    vscode.commands.registerCommand(
      "thinkube.thinky.applySelection",
      async (verb: unknown) => {
        const session = getScratchpadSession();
        if (
          !session ||
          (verb !== "check" && verb !== "uncheck" && verb !== "defer" && verb !== "drop")
        ) {
          return;
        }
        const n = session.selectionCount;
        await session.postFromWebview({ type: "applySelection", verb });
        vscode.window.showInformationMessage(
          `${verb === "check" ? "Settled" : verb === "drop" ? "Dropped (vetoed)" : verb === "defer" ? "Deferred" : "Unchecked"} ${n} staged item${n === 1 ? "" : "s"}.`,
        );
      },
    ),
  );

  // The @mention participant is GONE (2026-07-17): the session participant
  // (id "thinky", declared in chatParticipants and created in
  // thinkySession.ts) serves BOTH the session editor and @thinky mentions —
  // two participants sharing the name broke the editor's agent lock, which
  // silently routed session requests to the default agent + picked model.

}
