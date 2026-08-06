/**
 * The one SDK round runner. Rounds are read-only over a repository and
 * return their final text; anything that mutates goes through workers with
 * work orders, never through a round. Fail-soft: null on any failure, so a
 * broken round never blocks the space.
 */

export interface RoundDeps {
  model: string;
  repoRoot: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTurns?: number;
  log?: (line: string) => void;
  /** Cancels the round mid-flight (the human pressed Cancel). */
  abort?: AbortController;
}

type SdkQuery = (args: {
  prompt: string;
  options: Record<string, unknown>;
}) => AsyncIterable<unknown>;

export async function runReadRound(
  deps: RoundDeps,
  prompt: string,
): Promise<string | null> {
  let query: SdkQuery;
  try {
    const mod = (await import("@anthropic-ai/claude-agent-sdk")) as {
      query: SdkQuery;
    };
    query = mod.query;
  } catch (err) {
    deps.log?.(
      `round cannot run — Agent SDK failed to load: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  let text = "";
  try {
    for await (const msg of query({
      prompt,
      options: {
        model: deps.model,
        ...(deps.abort ? { abortController: deps.abort } : {}),
        permissionMode: "bypassPermissions",
        thinking: { type: "adaptive" },
        effort: deps.effort ?? "high",
        maxTurns: deps.maxTurns ?? 40,
        allowedTools: ["Read", "Grep", "Glob"],
        disallowedTools: [
          "Write",
          "Edit",
          "NotebookEdit",
          "Bash",
          "WebFetch",
          "WebSearch",
          "Task",
          "AskUserQuestion",
          "ExitPlanMode",
        ],
        additionalDirectories: [deps.repoRoot],
      },
    })) {
      const rec = msg as Record<string, unknown>;
      if (rec.type === "assistant") {
        const m = rec.message as { content?: unknown } | undefined;
        for (const b of (Array.isArray(m?.content) ? m!.content : []) as Array<
          Record<string, unknown>
        >)
          if (b.type === "text" && typeof b.text === "string") text += b.text;
      } else if (rec.type === "result" && typeof rec.result === "string") {
        text = rec.result;
      }
    }
  } catch (err) {
    deps.log?.(
      `round errored: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  return text;
}
