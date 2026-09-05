/**
 * One SDK worker executing one execution unit inside the TEP worktree.
 * Footprint containment is the engine's doctrine re-hosted: a PostToolUse
 * check diffs the whole tree against the run's footprint union, reverts
 * ONLY offending paths, and fails the unit with containment named. A
 * parked worker (the NEEDS-INPUT sentinel) keeps its session alive while
 * the human answers through the run view — the oracle lesson's door.
 */
import { theModel } from "../engine/theModel";
import { workerEnv } from "./oracle";
import { execFile } from "node:child_process";
import { extractNeedsInput } from "../engine/core/preflight";
import { extractUndelivered } from "../engine/core/redispatch";
import { rtkRewrite } from "../engine/rtkRewrite";
import { clearanceLesson, refusedToolUse, toolsRefusedTo, clusterReach } from "./toolsAllowed";
export { clearanceLesson, refusedToolUse, toolsRefusedTo, FENCED_TOOLS } from "./toolsAllowed";
import { describeTool } from "./toolsAllowed";

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
  /**
   * What the guard restored, with the change it undid.
   *
   * A revert is right when it is right — a coder must not write its own
   * checks — but it discards the unit's reasoning along with its code, and
   * the actor that comes after is fenced by nothing and reaches the same
   * files. One unit worked out that a function needed a second argument,
   * wrote it, was restored, and the run kept nothing of it.
   */
  onRestored?: (kept: { path: string; patch: string }[]) => void;
  /**
   * Ask the run's door for a path this unit is not cleared for.
   *
   * Most of what a worker reaches for outside its footprint is a file no
   * other unit owns and nobody is touching — a table its own criterion
   * cannot work without. Reverting that and explaining the protocol costs
   * a round to reach the answer the door would have given at once. When
   * the door is absent, every uncleared write is simply restored.
   */
  clearFor?: (paths: string[]) => Promise<{ granted: string[]; refused: { path: string; why: string }[] }>;
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
  /**
   * The last actor is fenced by nothing. The guard exists to keep parallel
   * workers off each other's files; behind the closer nobody runs, its work
   * is judged by execution like everyone else's, and a fence on it turns
   * "full authority" into a list — which can never contain the file the
   * closer discovers by reading. Twice a run withheld because the closer
   * wrote the correct fix and the guard deleted it.
   */
  unfenced?: boolean;
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
 * `wrote` narrows it to the paths THIS tool call touched. Every unit works
 * in one shared tree, so reading the whole tree charges a unit for whatever
 * a neighbour happens to have left there a second earlier: one unit wrote a
 * scratch file at 10:29:43 and deleted it at 10:29:54, and in that window a
 * second unit saved a file it was perfectly cleared for and was failed for
 * the first one's scratch. A file tool names the path it wrote, so nothing
 * needs to be inferred from the tree at all.
 *
 * Returns the paths it restored, or nothing.
 */
async function encloseWork(
  deps: {
    worktree: string;
    footprint: string[];
    alsoAllowed?: () => string[];
    baseline: Set<string>;
    log: (line: string) => void;
    onRestored?: (kept: { path: string; patch: string }[]) => void;
  },
  wrote?: readonly string[],
): Promise<string[]> {
  const dirty = mine(await porcelainPaths(deps.worktree), wrote);
  const bad = containmentViolations(
    dirty,
    [...deps.footprint, ...(deps.alsoAllowed?.() ?? [])],
    deps.baseline,
  );
  if (!bad.length) return [];
  // Read it before it is gone. A revert undoes two things — the change, and
  // what the unit worked out making it — and only the first is meant. The
  // last actor is fenced by nothing and reaches the same files; handing it
  // what was already found is the difference between inheriting an answer
  // and rediscovering it in an empty tree.
  const kept = await Promise.all(
    bad.map(async (path) => ({ path, patch: await changeAt(deps.worktree, path) })),
  );
  await revertPaths(deps.worktree, bad);
  deps.onRestored?.(kept.filter((k) => !!k.patch.trim()));
  return bad;
}

/**
 * What a path holds that HEAD does not, as a patch.
 *
 * A tracked file answers with its diff. A file the unit created is in no
 * commit, so git compares it against nothing and says nothing — there the
 * file's own text is the change.
 */
async function changeAt(worktree: string, path: string): Promise<string> {
  const diff = await git(worktree, ["diff", "HEAD", "--", path]);
  if (diff.trim()) return diff.slice(0, 8000);
  return (await git(worktree, ["diff", "--no-index", "--", "/dev/null", path])).slice(0, 8000);
}

/**
 * The repository-relative paths a tool call named, when it named any.
 *
 * `Write` and `Edit` carry `file_path`, `NotebookEdit` carries
 * `notebook_path` — each an absolute path into the worktree. `Bash` names
 * nothing: a shell command can write anywhere, so there is nothing to
 * narrow by and the guard falls back to reading the tree.
 */
export function pathsNamedByTool(
  h: { tool_name?: string; tool_input?: Record<string, unknown> },
  worktree: string,
): string[] {
  const named = ["file_path", "notebook_path"]
    .map((k) => h.tool_input?.[k])
    .filter((v): v is string => typeof v === "string" && !!v);
  const root = worktree.endsWith("/") ? worktree : `${worktree}/`;
  return named.map((p) => (p.startsWith(root) ? p.slice(root.length) : p));
}

/** The dirty paths this tool call is answerable for. A call that named its
 *  path answers for that alone; a shell command named none, so the tree is
 *  all there is to go on. */
function mine(dirty: string[], wrote?: readonly string[]): string[] {
  if (!wrote?.length) return dirty;
  const named = new Set(wrote);
  return dirty.filter((p) => named.has(p));
}

/** What this unit has changed that it is not cleared for — read, not restored. */
async function outsideClearance(
  deps: {
    worktree: string;
    footprint: string[];
    alsoAllowed?: () => string[];
    baseline: Set<string>;
  },
  wrote?: readonly string[],
): Promise<string[]> {
  return containmentViolations(
    mine(await porcelainPaths(deps.worktree), wrote),
    [...deps.footprint, ...(deps.alsoAllowed?.() ?? [])],
    deps.baseline,
  );
}

/**
 * What the worker is told the first time it writes outside its clearance.
 *
 * The tree is already safe — the file was restored before this is read.
 * What is left is a worker that believes it has made a change it has not,
 * and the brief's own rule is what it needs: the clearance is asked for,
 * and only then made. A unit once read "the run clears you and you make
 * the change yourself", kept the conclusion, dropped the asking, and died
 * for a single correct line it was entitled to write.
 *
 * So the first one teaches. Killing the unit there discards everything it
 * built for a change the run would almost certainly have granted, and the
 * guard has every fact needed to say so instead.
 */








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
    const mod = (await theModel("the unit worker")) as {
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
                    "Run this repository's own PREPARE command — what makes its checks runnable, which may be less than what ships — over the shared tree, every unit's work in progress, not only yours. You get its words VERBATIM. Seconds, runs no tests, judges nothing — fast feedback for compile and import errors. What ships is built and judged once, after every unit lands. Lines naming files you are not cleared for are other units' in-flight work; ignore them.",
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
  /** The first uncleared write teaches; the second ends the unit. */
  let warned = false;
  let sessionId: string | undefined;
  try {
    const stream = query({
      prompt: input(),
      options: {
        model: deps.model,
        cwd: deps.worktree,
        // A worker's environment carries no credential and no way into the
        // cluster; what a check needs, the runner is given by the engine.
        env: workerEnv(),
        ...(deps.resume ? { resume: deps.resume } : {}),
        permissionMode: "bypassPermissions",
        thinking: { type: "disabled" },
        maxTurns: deps.maxTurns ?? 80,
        abortController: deps.abort,
        ...(mcpServers ? { mcpServers } : {}),
        // A tool that moves the session's working directory would let a
        // relative write land outside the footprint: none of those, ever.
        disallowedTools: toolsRefusedTo(deps),
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
                  const refused =
                    refusedToolUse(deps, h.tool_name ?? "", target) ??
                    (h.tool_name === "Bash" && h.tool_input?.command ? clusterReach(h.tool_input.command) : undefined);
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
                async (h: { tool_name?: string; tool_input?: Record<string, unknown> }) => {
                  if (deps.unfenced || !WRITING_TOOLS.includes(h.tool_name ?? "")) return {};
                  // What THIS call wrote, when the tool said so. A shell
                  // command names no path, so there the tree is all there is.
                  const wrote = pathsNamedByTool(h, deps.worktree);
                  const wanted = await outsideClearance(deps, wrote);
                  if (wanted.length && deps.clearFor) {
                    const ruling = await deps.clearFor(wanted);
                    if (ruling.granted.length) {
                      deps.footprint = [...new Set([...deps.footprint, ...ruling.granted])];
                      deps.log(`⚖ cleared at the door for ${ruling.granted.join(", ")} — the work stands`);
                    }
                  }
                  const bad = await encloseWork(deps, wrote);
                  if (!bad.length) return {};
                  if (!warned) {
                    warned = true;
                    deps.log(`⚠ the guard restored ${bad.join(", ")} — not this unit's to change; it is told how to ask`);
                    return {
                      hookSpecificOutput: {
                        hookEventName: "PostToolUse",
                        additionalContext: clearanceLesson(bad, deps.footprint),
                      },
                    };
                  }
                  deps.log(`⛔ the guard restored ${bad.join(", ")} — an uncleared change after being told; the unit fails`);
                  containment = true;
                  deps.abort.abort();
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
