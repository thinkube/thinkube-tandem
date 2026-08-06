/**
 * One SDK worker executing one execution unit inside the TEP worktree.
 * Footprint containment is the engine's doctrine re-hosted: a PostToolUse
 * check diffs the whole tree against the run's footprint union, reverts
 * ONLY offending paths, and fails the unit with containment named. A
 * parked worker (the NEEDS-INPUT sentinel) keeps its session alive while
 * the human answers through the run view — the oracle lesson's door.
 */
import { execFile } from "node:child_process";
import { extractNeedsInput } from "../engine/core/preflight";
import { extractUndelivered } from "../engine/core/redispatch";
import { rtkRewrite } from "../engine/rtkRewrite";

export interface WorkerOutcome {
  ok: boolean;
  finalText: string;
  undelivered?: string[];
  containment?: boolean;
}

export interface RunWorkerDeps {
  model: string;
  worktree: string;
  role: "code" | "test";
  /** Files this unit may touch; everything else is reverted + terminal. */
  footprint: string[];
  /** Live footprints of OTHER units sharing this tree — their writes are
   *  legitimate, not this unit's strays (the frontier runs in parallel). */
  alsoAllowed?: () => string[];
  /** Paths already dirty at unit start — exempt from containment. */
  baseline: Set<string>;
  abort: AbortController;
  onPark: (question: string, answer: (a: string) => void) => void;
  log: (line: string) => void;
  /** In-loop black-box check: runs the slice's acceptance checks against the
   *  current work and returns the oracle's formatted verdict. */
  verifyTool?: () => Promise<string>;
  maxTurns?: number;
}

const git = (cwd: string, args: string[]): Promise<string> =>
  new Promise((resolve) => {
    execFile("git", ["-C", cwd, ...args], { encoding: "utf8" }, (_e, out) =>
      resolve(out ?? ""),
    );
  });

export async function porcelainPaths(worktree: string): Promise<string[]> {
  const out = await git(worktree, [
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3).trim())
    .filter((p) => !/\.tmp\.\d+\./.test(p));
}

async function revertPaths(worktree: string, paths: string[]): Promise<void> {
  for (const p of paths) {
    await git(worktree, ["restore", "--source=HEAD", "--staged", "--worktree", "--", p]);
    await git(worktree, ["clean", "-fdq", "--", p]);
  }
}

export function containmentViolations(
  dirty: string[],
  footprint: string[],
  baseline: Set<string>,
): string[] {
  const allowed = footprint.map((f) => f.replace(/^\.\//, ""));
  return dirty.filter(
    (p) => !baseline.has(p) && !allowed.some((a) => p === a || p.startsWith(a + "/")),
  );
}

type SdkTool = (
  name: string,
  description: string,
  schema: Record<string, never>,
  handler: () => Promise<{ content: { type: "text"; text: string }[] }>,
) => unknown;
type SdkCreateServer = (cfg: {
  name: string;
  version: string;
  tools: unknown[];
}) => unknown;

type SdkQuery = (args: {
  prompt: AsyncIterable<{ type: "user"; message: { role: "user"; content: string } }> | string;
  options: Record<string, unknown>;
}) => AsyncIterable<unknown>;

export async function runUnitWorker(
  deps: RunWorkerDeps,
  brief: string,
): Promise<WorkerOutcome> {
  let query: SdkQuery;
  let mcpServers: Record<string, unknown> | undefined;
  try {
    const mod = (await import("@anthropic-ai/claude-agent-sdk")) as {
      query: SdkQuery;
      tool?: SdkTool;
      createSdkMcpServer?: SdkCreateServer;
    };
    query = mod.query;
    if (deps.verifyTool && mod.tool && mod.createSdkMcpServer) {
      const verify = deps.verifyTool;
      mcpServers = {
        tandem: mod.createSdkMcpServer({
          name: "tandem",
          version: "1.0.0",
          tools: [
            mod.tool(
              "verify",
              "Run this slice's acceptance checks against your current work in an isolated runner (black box). Returns per-criterion PASS/FAIL with evidence. Your completion is judged by this going green.",
              {},
              async () => ({
                content: [{ type: "text" as const, text: await verify() }],
              }),
            ),
          ],
        }),
      };
    }
  } catch (err) {
    return {
      ok: false,
      finalText: "",
      undelivered: [
        `the Agent SDK failed to load: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  let sendNext: ((text: string) => void) | undefined;
  let parkedOnce = false;
  async function* input(): AsyncGenerator<{ type: "user"; message: { role: "user"; content: string } }> {
    yield { type: "user", message: { role: "user", content: brief } };
    for (;;) {
      const next: string = await new Promise((resolve) => (sendNext = resolve));
      yield { type: "user", message: { role: "user", content: next } };
    }
  }

  let text = "";
  let containment = false;
  try {
    const stream = query({
      prompt: input(),
      options: {
        model: deps.model,
        cwd: deps.worktree,
        permissionMode: "bypassPermissions",
        thinking: { type: "disabled" },
        maxTurns: deps.maxTurns ?? 80,
        abortController: deps.abort,
        ...(mcpServers ? { mcpServers } : {}),
        disallowedTools:
          deps.role === "test"
            ? ["Bash", "WebFetch", "WebSearch", "Task", "AskUserQuestion", "ExitPlanMode"]
            : ["WebFetch", "WebSearch", "Task", "AskUserQuestion", "ExitPlanMode"],
        hooks: {
          PreToolUse: [
            {
              hooks: [
                async (h: { tool_name?: string; tool_input?: { command?: string } }) => {
                  if (h.tool_name === "Bash" && h.tool_input?.command) {
                    const rewritten = rtkRewrite(h.tool_input.command);
                    if (rewritten)
                      return {
                        hookSpecificOutput: {
                          hookEventName: "PreToolUse",
                          permissionDecision: "allow",
                          updatedInput: { ...h.tool_input, command: rewritten },
                        },
                      };
                  }
                  return {};
                },
              ],
            },
          ],
          PostToolUse: [
            {
              hooks: [
                async (h: { tool_name?: string }) => {
                  if (!["Write", "Edit", "NotebookEdit", "Bash"].includes(h.tool_name ?? ""))
                    return {};
                  const dirty = await porcelainPaths(deps.worktree);
                  const bad = containmentViolations(
                    dirty,
                    [...deps.footprint, ...(deps.alsoAllowed?.() ?? [])],
                    deps.baseline,
                  );
                  if (bad.length) {
                    deps.log(`⛔ containment: ${bad.join(", ")} — reverted, unit failed`);
                    await revertPaths(deps.worktree, bad);
                    containment = true;
                    deps.abort.abort();
                  }
                  return {};
                },
              ],
            },
          ],
        },
      },
    });
    for await (const msg of stream) {
      const rec = msg as Record<string, unknown>;
      if (rec.type === "assistant") {
        const m = rec.message as { content?: unknown } | undefined;
        for (const b of (Array.isArray(m?.content) ? m!.content : []) as Array<Record<string, unknown>>)
          if (b.type === "text" && typeof b.text === "string") text += b.text;
      } else if (rec.type === "result") {
        const turn = typeof rec.result === "string" ? rec.result : text;
        const q = extractNeedsInput(turn);
        if (q && !parkedOnce) {
          parkedOnce = true;
          const answer: string = await new Promise((resolve) =>
            deps.onPark(q, resolve),
          );
          sendNext?.(
            `ANSWER to your question: ${answer}\nContinue the unit; the footprint and rules are unchanged.`,
          );
          continue;
        }
        text = turn;
        break;
      }
    }
  } catch (err) {
    if (containment)
      return { ok: false, finalText: text, containment: true };
    return {
      ok: false,
      finalText: text,
      undelivered: [
        `worker errored: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
  if (containment) return { ok: false, finalText: text, containment: true };
  const undelivered = extractUndelivered(text);
  return {
    ok: undelivered.length === 0,
    finalText: text,
    ...(undelivered.length ? { undelivered } : {}),
  };
}
