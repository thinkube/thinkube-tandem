/**
 * Workers: SDK sessions that execute one work order inside a worktree.
 * Two kinds, deliberately blind to each other:
 *  - the probe author sees checks and contracts, never the implementation —
 *    it writes the held-out tests that define done;
 *  - the builder sees the brief with verified coordinates and the footprint
 *    boundary — it makes the probes pass.
 * A worker that cannot meet an obligation says UNDELIVERED and why; the
 * report is collected, never papered over.
 */

export interface WorkerDeps {
  model: string;
  worktree: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTurns?: number;
  log?: (line: string) => void;
}

export interface WorkerResult {
  ok: boolean;
  finalText: string;
  undelivered?: string;
}

type SdkQuery = (args: {
  prompt: string;
  options: Record<string, unknown>;
}) => AsyncIterable<unknown>;

export async function runWorker(
  deps: WorkerDeps,
  prompt: string,
): Promise<WorkerResult> {
  let query: SdkQuery;
  try {
    const mod = (await import("@anthropic-ai/claude-agent-sdk")) as {
      query: SdkQuery;
    };
    query = mod.query;
  } catch (err) {
    return {
      ok: false,
      finalText: "",
      undelivered: `the Agent SDK failed to load: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  let text = "";
  try {
    for await (const msg of query({
      prompt,
      options: {
        model: deps.model,
        permissionMode: "bypassPermissions",
        thinking: { type: "adaptive" },
        effort: deps.effort ?? "high",
        maxTurns: deps.maxTurns ?? 80,
        cwd: deps.worktree,
        disallowedTools: ["WebFetch", "WebSearch", "Task", "AskUserQuestion", "ExitPlanMode"],
        additionalDirectories: [deps.worktree],
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
    return {
      ok: false,
      finalText: text,
      undelivered: `worker errored: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const undelivered = parseUndelivered(text);
  return { ok: !undelivered, finalText: text, ...(undelivered ? { undelivered } : {}) };
}

/** The declared-gap channel: a final message starting "UNDELIVERED: ". */
export function parseUndelivered(finalText: string): string | undefined {
  const stripped = finalText.trim();
  const idx = stripped.lastIndexOf("UNDELIVERED:");
  if (idx === -1) return undefined;
  return stripped.slice(idx + "UNDELIVERED:".length).trim() || "unspecified";
}

/** The probe author's brief: checks and contracts only — never the code. */
export function renderProbeBrief(args: {
  orderId: string;
  contracts: string[];
  checks: { nodeSentence: string; text: string }[];
  probeDir: string;
}): string {
  const lines: string[] = [];
  lines.push(
    `You are the PROBE AUTHOR for ${args.orderId}. You write the held-out tests that define done. ` +
      `You have NOT seen the implementation and you must not look for it — judge only from the contract below.`,
  );
  lines.push(``);
  lines.push(`THE CONTRACT (what will exist):`);
  for (const c of args.contracts) lines.push(`  - ${c}`);
  lines.push(``);
  lines.push(`WHAT MUST BE PROVABLE:`);
  for (const c of args.checks) lines.push(`  - [${c.nodeSentence}] ${c.text}`);
  lines.push(``);
  lines.push(
    `Write executable node:test files under ${args.probeDir}/ — one file per check, named after it. ` +
      `Each probe must fail against an empty implementation and pass against a correct one. ` +
      `Import only through the contract's public surface. Write ONLY under ${args.probeDir}/.`,
  );
  return lines.join("\n");
}
