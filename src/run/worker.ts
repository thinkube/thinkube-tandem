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
import { isTestPath } from "./testHomes";

export interface WorkerOutcome {
  ok: boolean;
  finalText: string;
  undelivered?: string[];
  containment?: boolean;
  /** The session this unit was worked in, so a repair can be the NEXT
   *  message in it rather than a stranger with a summary. */
  sessionId?: string;
}

export interface RunWorkerDeps {
  model: string;
  worktree: string;
  role: "code" | "test";
  /** What this unit is cleared to change; anything else is restored. */
  footprint: string[];
  /** What OTHER units in this tree are cleared to change — their writes are
   *  legitimate, not this unit's (the frontier runs in parallel). */
  alsoAllowed?: () => string[];
  /** Paths already dirty at unit start — exempt from containment. */
  baseline: Set<string>;
  abort: AbortController;
  onPark: (question: string, answer: (a: string) => void) => void;
  log: (line: string) => void;
  /** In-loop black-box check: runs the slice's acceptance checks against the
   *  current work and returns the oracle's formatted verdict. */
  verifyTool?: () => Promise<string>;
  /** The repository's own build over the actor's current tree — the
   *  compiler's words VERBATIM. Feedback, never a judge: the compiler is
   *  the language's law, not gameable evidence, so it does not touch the
   *  blinding wall. */
  buildTool?: () => Promise<string>;
  /** The valve on the blinding wall: challenge a check the worker believes
   *  misreads its criterion. The oracle rules; the ruling is recorded and
   *  rides the delivery. Never a way to see or edit the probe. */
  challengeTool?: (check: number, argument: string) => Promise<string>;
  /**
   * Blind the code author. With the oracle in place its only feedback is
   * `verify` — probe source never reaches it, results do — so a shell and
   * a way to read the probes are not conveniences it lacks, they are the
   * improvised feedback the oracle was built to replace. Success measured
   * against a test the author read is evidence about the test.
   */
  blind?: boolean;
  maxTurns?: number;
  /** Continue a session this run already had: the author still holds its
   *  own reasoning, so the intent behind the code survives the repair. */
  resume?: string;
}

/** Tools whose use can leave a change on disk. */
const WRITING_TOOLS = ["Write", "Edit", "NotebookEdit", "Bash"];

/**
 * The guard, as it really runs: read what the tree has become, judge it
 * against what this unit is cleared to change plus what its live peers are
 * cleared to change, and RESTORE anything else. Extracted from the hook so
 * the wiring — porcelain, judgement, restore — is testable.
 *
 * Returns true when the unit changed something it was not cleared for,
 * which the caller turns into a halt.
 */
export async function encloseWork(deps: {
  worktree: string;
  footprint: string[];
  alsoAllowed?: () => string[];
  baseline: Set<string>;
  log: (line: string) => void;
}): Promise<boolean> {
  const dirty = await porcelainPaths(deps.worktree);
  const bad = containmentViolations(
    dirty,
    [...deps.footprint, ...(deps.alsoAllowed?.() ?? [])],
    deps.baseline,
  );
  if (!bad.length) return false;
  deps.log(`⛔ the guard restored ${bad.join(", ")} — an uncleared change; the unit fails`);
  await revertPaths(deps.worktree, bad);
  return true;
}

/**
 * One line for what a worker just did: the tool and the thing it did it
 * to. A log of bare tool names says a worker was busy; a log naming the
 * file says what it built.
 */
function describeTool(b: Record<string, unknown>): string {
  const name = typeof b.name === "string" ? b.name : "tool";
  const input = (b.input ?? {}) as Record<string, unknown>;
  const of =
    ["file_path", "path", "pattern", "command", "notebook_path"]
      .map((k) => (typeof input[k] === "string" ? (input[k] as string) : ""))
      .find(Boolean) ?? "";
  return of ? `${name} ${of.length > 120 ? `${of.slice(0, 120)}…` : of}` : name;
}

/** Tools that could show an author the evidence it is judged by. */
const READ_TOOLS = ["Read", "Grep", "Glob", "NotebookRead"];

/** Held-out evidence: a probe, or any test-shaped path — one rule. */
function isHeldOut(target: string): boolean {
  return isTestPath(target);
}

/** Why a tool use is refused before it runs, or nothing. A coder never
 *  reads held-out evidence when blinded, and never writes a test-shaped
 *  path at all — tests are the tester's, whatever the footprint says. */
export function refusedToolUse(
  deps: { role: "code" | "test"; blind?: boolean },
  tool: string,
  target: string,
): string | undefined {
  if (!target) return undefined;
  if (deps.role === "code" && ["Write", "Edit", "NotebookEdit"].includes(tool) && isHeldOut(target))
    return "tests are the tester's — a coder never writes a test or probe file; build to the contract and ask `verify`";
  if (deps.blind && READ_TOOLS.includes(tool) && isHeldOut(target))
    return "the checks are held out — ask `verify` how you are doing instead of reading them";
  return undefined;
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

function containmentViolations(
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
  schema: Record<string, unknown>,
  handler: (
    args: Record<string, unknown>,
    extra?: unknown,
  ) => Promise<{ content: { type: "text"; text: string }[] }>,
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
      const challenge = deps.challengeTool;
      const build = deps.buildTool;
      const { z } = (await import("zod")) as { z: typeof import("zod").z };
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
            ...(build
              ? [
                  mod.tool(
                    "build",
                    "Run the repository's own build over your current tree and get the compiler's words VERBATIM. Seconds, runs no tests, judges nothing — your fastest feedback for type and import errors. Lines naming files you are not cleared for are other units' in-flight work in this shared tree; ignore them.",
                    {},
                    async () => ({ content: [{ type: "text" as const, text: await build() }] }),
                  ),
                ]
              : []),
            ...(challenge
              ? [
                  mod.tool(
                    "challenge",
                    "Challenge ONE check you believe misreads its criterion or cannot be satisfied by any correct implementation. Argue in intent terms with your verify evidence — you will never see the check's source. An independent judge rules; granted, the check is re-authored from its criterion and the ruling is recorded on the delivery; denied, meet it. Do not grind a red check when you believe it is wrong — file this instead. Budget: 2 per slice.",
                    { check: z.number(), argument: z.string() },
                    async (args: Record<string, unknown>) => ({
                      content: [
                        {
                          type: "text" as const,
                          text: await challenge(
                            Number(args.check),
                            typeof args.argument === "string" ? args.argument : "",
                          ),
                        },
                      ],
                    }),
                  ),
                ]
              : []),
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
  let sessionId: string | undefined;
  try {
    const stream = query({
      prompt: input(),
      options: {
        model: deps.model,
        cwd: deps.worktree,
        ...(deps.resume ? { resume: deps.resume } : {}),
        permissionMode: "bypassPermissions",
        thinking: { type: "disabled" },
        maxTurns: deps.maxTurns ?? 80,
        abortController: deps.abort,
        ...(mcpServers ? { mcpServers } : {}),
        // A tool that moves the session's working directory would let a
        // relative write land outside the footprint: none of those, ever.
        disallowedTools: [
          ...(deps.role === "test" || deps.blind ? ["Bash"] : []),
          "WebFetch",
          "WebSearch",
          "Task",
          "Agent",
          "Workflow",
          "Skill",
          "AskUserQuestion",
          "ExitPlanMode",
          "EnterPlanMode",
          "EnterWorktree",
          "ExitWorktree",
        ],
        hooks: {
          PreToolUse: [
            {
              hooks: [
                async (h: {
                  tool_name?: string;
                  tool_input?: { command?: string; file_path?: string; path?: string; pattern?: string };
                }) => {
                  const target = [h.tool_input?.file_path, h.tool_input?.path, h.tool_input?.pattern]
                    .filter((x): x is string => !!x)
                    .join(" ");
                  const refused = refusedToolUse(deps, h.tool_name ?? "", target);
                  if (refused)
                    return {
                      hookSpecificOutput: {
                        hookEventName: "PreToolUse",
                        permissionDecision: "deny",
                        permissionDecisionReason: refused,
                      },
                    };
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
                  if (!WRITING_TOOLS.includes(h.tool_name ?? "")) return {};
                  if (await encloseWork(deps)) {
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
      if (typeof rec.session_id === "string") sessionId = rec.session_id;
      if (rec.type === "assistant") {
        const m = rec.message as { content?: unknown } | undefined;
        for (const b of (Array.isArray(m?.content) ? m!.content : []) as Array<Record<string, unknown>>) {
          if (b.type === "text" && typeof b.text === "string") {
            text += b.text;
            // What the worker is saying as it says it. A log holding only
            // the line that says the unit started tells a reader nothing
            // about what it did, which is the whole reason to open it.
            for (const line of b.text.split("\n").map((l) => l.trim()).filter(Boolean))
              deps.log(line);
          }
          if (b.type === "tool_use") deps.log(`⚙ ${describeTool(b)}`);
        }
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
      return { ok: false, finalText: text, containment: true, ...(sessionId ? { sessionId } : {}) };
    return {
      ok: false,
      finalText: text,
      undelivered: [
        `worker errored: ${err instanceof Error ? err.message : String(err)}`,
      ],
      ...(sessionId ? { sessionId } : {}),
    };
  }
  if (containment) return { ok: false, finalText: text, containment: true, ...(sessionId ? { sessionId } : {}) };
  const undelivered = realUndelivered(text);
  return {
    ok: undelivered.length === 0,
    finalText: text,
    ...(undelivered.length ? { undelivered } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

/** What a worker really left undone. "UNDELIVERED: none." — with or
 *  without a trailing remark ("none — all files written") — is a report
 *  of completeness, not a gap: a unit must never fail on its own honesty. */
function realUndelivered(text: string): string[] {
  return extractUndelivered(text).filter(
    (u) => !/^\s*(none|nothing( undelivered)?|n\/a|-)\s*([.!,;:(—–-]|$)/i.test(u),
  );
}
