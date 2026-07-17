/**
 * Thinkube language-model provider — vscode wiring (2026-07-17).
 *
 * Registers vendor "thinkube-claude" with the native model picker and answers
 * through the Claude Agent SDK spawning the local `claude` CLI (subscription
 * auth — the cost constraint: no API tokens). Pure text chat: all tools
 * disallowed, single turn.
 *
 * The LM provider API is stable in the Thinkube host (code-server 1.128) but
 * newer than our pinned @types/vscode — hence the narrow structural types and
 * the guarded registration (ships dark on hosts without the API).
 */

import * as vscode from "vscode";
import {
  aliasForModelId,
  estimateTokens,
  messagesToPrompt,
  THINKY_LM_MODELS,
  type LmMessageLike,
} from "./lmCore";

interface LmProgressLike {
  report(part: unknown): void;
}

async function respond(
  modelId: string,
  messages: readonly LmMessageLike[],
  progress: LmProgressLike,
): Promise<void> {
  const { query } = (await import("@anthropic-ai/claude-agent-sdk")) as {
    query: (args: {
      prompt: string;
      options: Record<string, unknown>;
    }) => AsyncIterable<unknown>;
  };
  const TextPart = (
    vscode as unknown as { LanguageModelTextPart: new (value: string) => unknown }
  ).LanguageModelTextPart;
  const prompt = messagesToPrompt(messages);
  let streamedAnything = false;
  let resultText = "";
  for await (const msg of query({
    prompt,
    options: {
      model: aliasForModelId(modelId),
      permissionMode: "bypassPermissions",
      thinking: { type: "disabled" },
      maxTurns: 1,
      disallowedTools: [
        "Read",
        "Grep",
        "Glob",
        "Bash",
        "Write",
        "Edit",
        "NotebookEdit",
        "WebFetch",
        "WebSearch",
        "Task",
      ],
    },
  })) {
    const rec = msg as Record<string, unknown>;
    if (rec.type === "assistant") {
      const m = rec.message as { content?: unknown } | undefined;
      const content = Array.isArray(m?.content) ? m!.content : [];
      for (const b of content as Array<Record<string, unknown>>) {
        if (b.type === "text" && typeof b.text === "string" && b.text) {
          streamedAnything = true;
          progress.report(new TextPart(b.text));
        }
      }
    } else if (rec.type === "result" && typeof rec.result === "string") {
      resultText = rec.result;
    }
  }
  if (!streamedAnything && resultText) {
    progress.report(new TextPart(resultText));
  }
}

export function registerThinkyLanguageModel(
  context: vscode.ExtensionContext,
): void {
  const lm = (
    vscode as unknown as {
      lm?: {
        registerLanguageModelChatProvider?: (
          vendor: string,
          provider: unknown,
        ) => vscode.Disposable;
      };
    }
  ).lm;
  if (!lm?.registerLanguageModelChatProvider) {
    return; // host predates the LM provider API — ships dark
  }

  const provider = {
    async provideLanguageModelChatInformation(): Promise<unknown[]> {
      return THINKY_LM_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        family: "claude",
        version: "1.0",
        maxInputTokens: 180_000,
        maxOutputTokens: 16_000,
        capabilities: { toolCalling: false, imageInput: false },
      }));
    },
    async provideLanguageModelChatResponse(
      model: { id?: string } | undefined,
      messages: readonly LmMessageLike[],
      _options: unknown,
      progress: LmProgressLike,
      _token: unknown,
    ): Promise<void> {
      await respond(model?.id ?? "thinkube-claude-sonnet", messages, progress);
    },
    async provideTokenCount(
      _model: unknown,
      text: string | { content?: unknown },
    ): Promise<number> {
      const s =
        typeof text === "string" ? text : JSON.stringify(text?.content ?? "");
      return estimateTokens(s);
    },
  };

  context.subscriptions.push(
    lm.registerLanguageModelChatProvider("thinkube-claude", provider),
  );
}
