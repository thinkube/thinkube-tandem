/**
 * lmCore — pure heart of the Thinkube language-model provider (2026-07-17).
 *
 * Field finding: the bundled "Claude Agent" chat session lists its models from
 * the Copilot SERVER catalog — the one link that genuinely needs GitHub auth.
 * The fix is to feed the panel models ourselves: this provider serves Claude
 * through the Claude Agent SDK on the local Claude Code login (subscription,
 * no API key), exactly like every tandem worker round.
 *
 * No `vscode` import — flattening and model metadata are testable with fakes.
 */

/** Models offered in the picker. `alias` is the Claude Code CLI model alias. */
export const THINKY_LM_MODELS: readonly {
  id: string;
  name: string;
  alias: string;
}[] = [
  { id: "thinkube-claude-sonnet", name: "Claude Sonnet (Thinkube)", alias: "sonnet" },
  { id: "thinkube-claude-opus", name: "Claude Opus (Thinkube)", alias: "opus" },
  { id: "thinkube-claude-haiku", name: "Claude Haiku (Thinkube)", alias: "haiku" },
];

export function aliasForModelId(id: string): string {
  return THINKY_LM_MODELS.find((m) => m.id === id)?.alias ?? "sonnet";
}

/** Minimal shape of an inbound chat message (vscode.LanguageModelChatMessage-ish). */
export interface LmMessageLike {
  /** 1 = user, 2 = assistant (vscode.LanguageModelChatMessageRole). */
  role: number | string;
  content: unknown;
  name?: string;
}

function partText(part: unknown): string {
  if (typeof part === "string") return part;
  if (typeof part === "object" && part !== null) {
    const v = (part as { value?: unknown }).value;
    if (typeof v === "string") return v;
  }
  return "";
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(partText).join("");
  return partText(content);
}

function roleLabel(role: number | string): "User" | "Assistant" | "System" {
  if (role === 2 || role === "assistant") return "Assistant";
  if (role === 0 || role === "system") return "System";
  return "User";
}

/**
 * Flatten a chat-message array into one prompt for a single SDK turn. System
 * text leads; the transcript follows with role tags; the trailing "Assistant:"
 * invites the continuation.
 */
export function messagesToPrompt(messages: readonly LmMessageLike[]): string {
  const system: string[] = [];
  const turns: string[] = [];
  for (const m of messages) {
    const text = messageText(m.content).trim();
    if (!text) continue;
    const label = roleLabel(m.role);
    if (label === "System") system.push(text);
    else turns.push(`${label}: ${text}`);
  }
  const head =
    system.length > 0 ? `${system.join("\n\n")}\n\n` : "";
  return `${head}${turns.join("\n\n")}\n\nAssistant:`;
}

/** Rough token estimate (chars/4) — good enough for picker budgeting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
