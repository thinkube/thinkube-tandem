/**
 * Thinky chat SESSION type (2026-07-17) — "hack the chat to make it ours".
 *
 * Contract extracted from the shipped build (code-server 1.128, copilot-chat
 * v0.56 as the reference implementation):
 *  - `chatSessions` contribution declares the session type: our name, icon,
 *    welcome, input placeholder in the panel's agent picker.
 *  - `vscode.chat.createChatParticipant(<type>, handler)` is the session's
 *    request handler (participant id == session type).
 *  - `vscode.chat.registerChatSessionContentProvider(<type>, provider,
 *    participant)` (proposed API `chatSessionsProvider`, granted to
 *    thinkube.thinkube-tandem via product.json in the Thinkube image) serves
 *    session content; fresh sessions are `{history: [], requestHandler:
 *    undefined}` so requests route to the participant.
 *  - `registerChatSessionItemProvider` lists the sessions — and HERE the
 *    linkage the methodology wants: EVERY THINKING SPACE IS A SESSION
 *    (resource thinky:/<namespace>/<space>). Each request carries its
 *    session resource in chatContext.chatSessionContext.chatSessionItem, so
 *    it binds to ITS space, not the singleton — the bound space is opened
 *    silently (reveal:false) before handling.
 *
 * The handler is the SAME chatCore used by @thinky — one seam, three mouths
 * (webview command field, @thinky mention, Thinky session).
 *
 * Everything is guarded: on a host without the API or without the proposal
 * grant, registration fails soft and the @thinky mention path still works.
 */

import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import * as vscode from "vscode";
import { getScratchpadSession, openScratchpad } from "../session";
import type { ScratchpadSession } from "../session";
import {
  boundSpaceFromChatContext,
  handleThinkyRequest,
  renderThinkyStatus,
  spaceToSessionPath,
  type ThinkySessionLike,
} from "./chatCore";
import { runThinkyAgentTurn } from "./agent";
import { thinkyDiag } from "./diag";
import {
  appendTranscriptTurn,
  readTranscript,
  transcriptPath,
} from "./transcript";
import type { ThinkyAgentSessionLike } from "./agent";

export const THINKY_SESSION_TYPE = "thinky";

function boardRoot(): string | undefined {
  return (
    vscode.workspace
      .getConfiguration("thinkube.thinkingSpace")
      .get<string>("root")
      ?.trim() || undefined
  );
}

/**
 * Enumerate thinking spaces under the board root: every
 * <root>/<namespace…>/thinking/<space>.json (namespace may be nested).
 * Exported for tests via dependency-free scanning.
 */
export function listThinkingSpaces(
  root: string,
): { namespace: string; space: string; mtimeMs: number }[] {
  const out: { namespace: string; space: string; mtimeMs: number }[] = [];
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > 6) return;
    let entries: nodeFs.Dirent[];
    try {
      entries = nodeFs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      if (e.name === "thinking" && rel) {
        let files: string[];
        try {
          files = nodeFs.readdirSync(nodePath.join(dir, e.name));
        } catch {
          continue;
        }
        for (const f of files) {
          if (f.endsWith(".json")) {
            let mtimeMs = 0;
            try {
              mtimeMs = nodeFs.statSync(nodePath.join(dir, e.name, f)).mtimeMs;
            } catch {
              /* stat race — item still lists, just without timing */
            }
            out.push({ namespace: rel, space: f.slice(0, -5), mtimeMs });
          }
        }
        continue;
      }
      walk(
        nodePath.join(dir, e.name),
        rel ? `${rel}/${e.name}` : e.name,
        depth + 1,
      );
    }
  };
  walk(root, "", 0);
  return out.sort((a, b) =>
    `${a.namespace}/${a.space}`.localeCompare(`${b.namespace}/${b.space}`),
  );
}

/**
 * Resolve the scratchpad session for a bound space: reuse the active one if
 * it IS that space, else open silently (no panel reveal from a chat turn).
 */
async function ensureSpaceSession(bound: {
  namespace: string;
  space: string;
}): Promise<ScratchpadSession> {
  const current = getScratchpadSession();
  if (
    current &&
    current.namespace === bound.namespace &&
    current.space === bound.space
  ) {
    return current;
  }
  return openScratchpad({
    namespace: bound.namespace,
    space: bound.space,
    sidecarRoot: boardRoot(),
    reveal: false,
  });
}

export function registerThinkySession(
  context: vscode.ExtensionContext,
): void {
  const chatApi = (
    vscode as unknown as {
      chat?: {
        createChatParticipant?: (
          id: string,
          handler: (
            request: { prompt: string; command?: string },
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
        ) => vscode.Disposable & { iconPath?: unknown };
        registerChatSessionContentProvider?: (
          type: string,
          provider: unknown,
          participant: unknown,
        ) => vscode.Disposable;
        registerChatSessionItemProvider?: (
          type: string,
          provider: unknown,
        ) => vscode.Disposable;
      };
    }
  ).chat;
  if (
    !chatApi?.createChatParticipant ||
    !chatApi.registerChatSessionContentProvider
  ) {
    return; // no session API in this host — the @thinky mention still works
  }

  try {
    const participant = chatApi.createChatParticipant(
      THINKY_SESSION_TYPE,
      async (request, chatContext, stream, _token) => {
        // Bind to the session's OWN space when the request carries one;
        // untitled sessions fall back to the active space.
        const bound = boundSpaceFromChatContext(chatContext);
        let session: ThinkySessionLike | undefined;
        if (bound) {
          try {
            session = (await ensureSpaceSession(bound)) as ThinkySessionLike;
          } catch {
            session = undefined;
          }
        } else {
          session = getScratchpadSession() as ThinkySessionLike | undefined;
        }
        const scratchpad = session as unknown as
          | (ThinkyAgentSessionLike & { namespace: string; space: string })
          | undefined;
        // Transcript persistence (2026-07-17): the content provider is the
        // source of truth for provider-backed sessions — capture what this
        // turn showed so reopening restores the conversation.
        const root = boardRoot();
        const tPath =
          root && scratchpad
            ? transcriptPath(root, scratchpad.namespace, scratchpad.space)
            : undefined;
        const replyChunks: string[] = [];
        const capturingStream = {
          markdown(value: string) {
            replyChunks.push(value);
            stream.markdown(value);
          },
          button(b: { command: string; title: string; arguments?: unknown[] }) {
            stream.button(b);
          },
        };
        await handleThinkyRequest(
          { prompt: request.prompt, command: request.command },
          session,
          capturingStream,
          scratchpad
            ? (prompt, onText) =>
                runThinkyAgentTurn(
                  {
                    session: scratchpad,
                    spaceKey: `${scratchpad.namespace}/${scratchpad.space}`,
                  },
                  prompt,
                  onText,
                )
            : undefined,
        );
        if (tPath) {
          if (request.prompt.trim())
            appendTranscriptTurn(tPath, "user", request.prompt);
          if (replyChunks.length > 0)
            appendTranscriptTurn(tPath, "assistant", replyChunks.join("\n"));
        }
      },
    );
    participant.iconPath = new vscode.ThemeIcon("sparkle");
    context.subscriptions.push(participant);

    const contentProvider = {
      async provideChatSessionContent(id: unknown): Promise<unknown> {
        thinkyDiag(`provideChatSessionContent id=${JSON.stringify(
          typeof id === "string" ? id : ((id as { path?: string })?.path ?? id),
        )}`);
        // Opening a listed session pre-binds its space (silently) so the
        // first message answers without a cold start.
        const path =
          typeof id === "string"
            ? id
            : ((id as { path?: string })?.path ?? "");
        const bound = boundSpaceFromChatContext({
          chatSessionContext: {
            chatSessionItem: { resource: { path: String(path) } },
          },
        });
        let opening: string | undefined;
        if (bound) {
          try {
            const session = await ensureSpaceSession(bound);
            // Bidirectional attachment: opening the chat session opens its
            // board beside it, without stealing the caret from the chat.
            session.revealPanel(true);
            // Thinky SPEAKS FIRST (field defect 2026-07-17: "no welcome
            // message and no initial request" — the manifest welcome only
            // renders in locked-agent widgets, and the participant only
            // answers when spoken to). Seed the transcript: guided-intake
            // greeting for a fresh space, a status recap otherwise.
            const model = session.model;
            const journalCount =
              (model.roughRequests?.length ?? 0) +
              ((model.sections.find((s) => s.kind === "goal")?.text.trim() ?? "")
                ? 1
                : 0);
            const hasItems = model.sections.some(
              (s) => s.kind !== "goal" && s.items.length > 0,
            );
            opening =
              journalCount === 0 && !hasItems
                ? "**What do you want to build?**\n\nTell me in your own words — " +
                  "each message becomes a journal entry, verbatim, until you say " +
                  "*that's all*. Then we'll gather context, and only then derive " +
                  "the elements."
                : `Welcome back — here is where the space stands:\n\n${renderThinkyStatus(model)}\n\nContinue where you left off, or ask me anything about it.`;
          } catch {
            /* space unreadable — session still opens, handler reports */
          }
        }
        thinkyDiag(
          `content: bound=${JSON.stringify(bound)} opening=${opening ? "yes" : "NO"}`,
        );
        // Serve the persisted transcript as history (2026-07-17 field
        // insight: reopening ALWAYS showed empty — for provider-backed
        // sessions the content provider IS the transcript; the panel keeps
        // no local copy). Pairing rule (verified in the workbench): request
        // turns must be real vscode.ChatRequestTurn instances; a response
        // renders by attaching to the PRECEDING request, so leading
        // assistant turns are dropped — the greeting therefore rides
        // activeResponseCallback instead of history.
        const root = boardRoot();
        const turns =
          root && bound
            ? readTranscript(transcriptPath(root, bound.namespace, bound.space))
            : [];
        const RequestTurn = (
          vscode as unknown as {
            ChatRequestTurn: new (
              prompt: string,
              command: string | undefined,
              references: unknown[],
              participant: string,
              toolReferences: unknown[],
            ) => unknown;
          }
        ).ChatRequestTurn;
        const history: unknown[] = [];
        let seenRequest = false;
        for (const t of turns) {
          if (t.role === "user") {
            history.push(
              new RequestTurn(t.text, undefined, [], THINKY_SESSION_TYPE, []),
            );
            seenRequest = true;
          } else if (seenRequest) {
            history.push({
              response: [new vscode.ChatResponseMarkdownPart(t.text)],
              participant: THINKY_SESSION_TYPE,
              result: {},
            });
          }
        }
        thinkyDiag(
          `content: serving ${history.length} history turn(s) from transcript`,
        );
        const openingText = history.length === 0 ? opening : undefined;
        return {
          history,
          requestHandler: undefined,
          ...(openingText
            ? {
                activeResponseCallback: async (stream: {
                  markdown(value: string): void;
                }) => {
                  thinkyDiag("activeResponseCallback streaming the opening");
                  stream.markdown(openingText);
                },
              }
            : {}),
        };
      },
    };
    context.subscriptions.push(
      chatApi.registerChatSessionContentProvider(
        THINKY_SESSION_TYPE,
        contentProvider,
        participant,
      ),
    );

    // Sessions list = thinking spaces (the linkage). Deprecated in favor of
    // the controller API upstream but functional in this build; guarded.
    if (chatApi.registerChatSessionItemProvider) {
      const itemProvider = {
        async provideChatSessionItems(): Promise<unknown[]> {
          const root = boardRoot();
          if (!root) return [];
          return listThinkingSpaces(root).map(
            ({ namespace, space, mtimeMs }) => ({
              resource: vscode.Uri.from({
                scheme: THINKY_SESSION_TYPE,
                path: spaceToSessionPath(namespace, space),
              }),
              label: space,
              description: namespace,
              tooltip: `Thinking space ${namespace}/${space}`,
              // Missing timing rendered as epoch 0 — "57 years ago" (field
              // report). The space file's mtime is the honest timestamp.
              ...(mtimeMs > 0
                ? { timing: { created: mtimeMs, startTime: mtimeMs } }
                : {}),
            }),
          );
        },
      };
      context.subscriptions.push(
        chatApi.registerChatSessionItemProvider(
          THINKY_SESSION_TYPE,
          itemProvider,
        ),
      );
    }
  } catch {
    // Proposal not granted in this host (stock product.json) — ship dark.
  }
}
