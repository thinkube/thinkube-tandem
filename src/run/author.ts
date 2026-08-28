/**
 * The authoring round: an SDK session that may WRITE, fenced to the paths
 * it was given. Reading rounds live in derive/round.ts and never mutate;
 * workers carry the full containment machinery. Between them sits this:
 * bounded jobs that produce files — a probe re-authored from its
 * criterion, a delivery's checks merged into the suite — where the fence
 * is a simple allowlist and the result is the round's final text.
 */
import { FENCED_TOOLS } from "./worker";
import { collectText } from "../derive/round";
import * as path from "node:path";

export interface AuthorDeps {
  cwd: string;
  model: string;
  /** Repo-relative paths this round may create or edit — a list, or a
   *  predicate when the exact targets are the round's own decision (the
   *  fence still holds: everything outside is denied at the tool
   *  boundary, not trusted to the prompt). */
  allowWrite: string[] | ((rel: string) => boolean);
  maxTurns?: number;
  log?: (line: string) => void;
}

type SdkQuery = (args: {
  prompt: string;
  options: Record<string, unknown>;
}) => AsyncIterable<unknown>;

export async function runAuthoringRound(
  deps: AuthorDeps,
  prompt: string,
): Promise<string | null> {
  let query: SdkQuery;
  try {
    const mod = (await import("@anthropic-ai/claude-agent-sdk")) as { query: SdkQuery };
    query = mod.query;
  } catch (err) {
    deps.log?.(
      `authoring round cannot run — Agent SDK failed to load: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  const list = Array.isArray(deps.allowWrite) ? deps.allowWrite : undefined;
  const allows = list
    ? (rel: string): boolean =>
        list.some((a) => path.resolve(deps.cwd, a) === path.resolve(deps.cwd, rel))
    : (deps.allowWrite as (rel: string) => boolean);
  return collectText(
    () =>
      query({
        prompt,
        options: {
          model: deps.model,
          cwd: deps.cwd,
          permissionMode: "bypassPermissions",
          thinking: { type: "adaptive" },
          maxTurns: deps.maxTurns ?? 40,
          allowedTools: ["Read", "Grep", "Glob", "Write", "Edit"],
          // A tool that moves the session's working directory would let a
          // relative write land outside the fence: none of those.
          disallowedTools: ["Bash", ...FENCED_TOOLS, "NotebookEdit"],
          additionalDirectories: [deps.cwd],
          hooks: {
            PreToolUse: [
              {
                hooks: [
                  async (h: { tool_name?: string; tool_input?: { file_path?: string } }) => {
                    if (!["Write", "Edit"].includes(h.tool_name ?? "")) return {};
                    const target = h.tool_input?.file_path;
                    const rel = target ? path.relative(deps.cwd, path.resolve(deps.cwd, target)) : "";
                    if (rel && !rel.startsWith("..") && allows(rel)) return {};
                    return {
                      hookSpecificOutput: {
                        hookEventName: "PreToolUse",
                        permissionDecision: "deny",
                        permissionDecisionReason: `outside this round's write fence: ${target ?? "?"}`,
                      },
                    };
                  },
                ],
              },
            ],
          },
        },
      }),
    deps.log,
  );
}
