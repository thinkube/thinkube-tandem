/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The footprint as permission rules, and the door that extends them.
 *
 * A unit's clearance used to be enforced after the fact: the worker wrote,
 * a hook read the tree, restored what was outside the footprint and taught
 * the worker to ask. Every such write cost a round, and twice a run was
 * withheld because the guard deleted a correct change along with the
 * reasoning that made it.
 *
 * The harness can refuse the write instead. The footprint becomes allow
 * rules of the form `Edit(<path>)`; anything a file tool names outside
 * them never reaches the disk and comes to the door (`canUseTool`), which
 * asks the run for clearance. Granted, the door answers with a session rule
 * so the worker makes the change itself and is not asked again. Refused,
 * the worker reads why, and nothing has to be undone.
 *
 * The shell is the exception that keeps the old guard: a command names no
 * path, so a file it writes is still found in the tree and restored.
 */

import { answered, questionAsked } from "./exitProtocol";

/** Tools that change a file and name it. */
const FILE_TOOLS = ["Edit", "Write", "NotebookEdit"] as const;

/** Tools that only look at the code. */
const LOOKING = ["Read", "Grep", "Glob"] as const;

/** Tandem's own tools, offered to a worker through the in-process server. */
const TANDEM_TOOLS = ["mcp__tandem__verify", "mcp__tandem__build", "mcp__tandem__challenge"] as const;

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

/**
 * The footprint as allow rules. `Edit` rules govern every built-in tool
 * that writes a file. A footprint entry may be a file or a directory, so
 * each gets both forms: the path itself, and everything under it.
 */
export function footprintRules(footprint: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of footprint) {
    const p = raw.replace(/^\.\//, "").replace(/\/+$/, "");
    if (!p) continue;
    out.push(`Edit(${p})`, `Edit(${p}/**)`);
  }
  return out;
}

/**
 * The built-in tools a worker is given, as an allow list: a tool nobody
 * named here does not exist for it, so a tool a later release adds is
 * closed by default. The unfenced closer gets the whole set, and is held
 * off delegation by name elsewhere.
 */
export function toolsGivenTo(w: {
  unfenced?: boolean;
  role?: string;
  blind?: boolean;
}): string[] | { type: "preset"; preset: "claude_code" } {
  if (w.unfenced) return { type: "preset", preset: "claude_code" };
  const shell = w.role === "test" || w.blind ? [] : ["Bash"];
  // The question tool: a worker that cannot settle something asks, the
  // door carries it to the run, and the answer is the tool's result.
  return [...LOOKING, ...FILE_TOOLS, ...shell, "AskUserQuestion"];
}

/**
 * What runs without coming to the door: looking, Tandem's own tools, the
 * shell where the role has one, and the footprint.
 */
export function allowedFor(w: { role?: string; blind?: boolean; footprint: readonly string[] }): string[] {
  const shell = w.role === "test" || w.blind ? [] : ["Bash"];
  return [...LOOKING, ...TANDEM_TOOLS, ...shell, ...footprintRules(w.footprint)];
}

/** What a worker reads when a write it asked for is refused. */
function refusalLesson(
  paths: readonly string[],
  footprint: readonly string[],
  refused: readonly { path: string; why: string }[] = [],
): string {
  const why = refused.length ? ` ${refused.map((r) => `${r.path}: ${r.why}`).join("; ")}.` : "";
  return (
    `${paths.join(", ")} is not yours to change, so nothing was written.${why} ` +
    `Say which file you need and which criterion requires it, and the run rules on it and clears you; ` +
    `then you make the change yourself, in this session. ` +
    `What you may write is: ${footprint.join(", ")}.`
  );
}

export type Ruling = { granted: string[]; refused: { path: string; why: string }[] };

export type DoorAnswer =
  | {
      behavior: "allow";
      updatedPermissions: {
        type: "addRules";
        rules: { toolName: string; ruleContent: string }[];
        behavior: "allow";
        destination: "session";
      }[];
    }
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string };

/**
 * The door, as the harness calls it: for every tool use no rule allows.
 *
 * A file tool naming a path outside the footprint is the case the door is
 * for. A question is the other: the worker asks through the question
 * tool, the run answers, and the answer goes back as the tool's result in
 * the same session. Anything else reaching the door was not given to this
 * worker, and is refused with its name. Without a run to ask, every
 * uncleared write is simply refused.
 */
export function doorFor(d: {
  worktree: string;
  footprint: () => readonly string[];
  clearFor?: (paths: string[]) => Promise<Ruling>;
  granted: (paths: string[]) => void;
  /** The run's ear for a question: resolves with the answer. */
  ask?: (question: string) => Promise<string>;
  log: (line: string) => void;
}): (tool: string, input: Record<string, unknown>) => Promise<DoorAnswer> {
  return async (tool, input) => {
    if (tool === "AskUserQuestion") {
      if (!d.ask) return { behavior: "deny", message: "there is nobody to ask here; decide from the brief and say so." };
      const question = questionAsked(input);
      d.log(`? the unit asks: ${question.split("\n")[0]}`);
      const answer = await d.ask(question);
      return { behavior: "allow", updatedInput: answered(input, answer) };
    }
    if (!(FILE_TOOLS as readonly string[]).includes(tool))
      return { behavior: "deny", message: `${tool} is not among the tools this unit was given.` };
    const named = pathsNamedByTool({ tool_name: tool, tool_input: input }, d.worktree);
    if (!named.length) return { behavior: "deny", message: `${tool} named no path, so it cannot be cleared.` };
    if (!d.clearFor) return { behavior: "deny", message: refusalLesson(named, d.footprint()) };
    const ruling = await d.clearFor(named);
    if (ruling.granted.length) {
      d.granted(ruling.granted);
      d.log(`⚖ cleared at the door for ${ruling.granted.join(", ")} — the write goes ahead`);
      return {
        behavior: "allow",
        updatedPermissions: [
          {
            type: "addRules",
            rules: footprintRules(ruling.granted).map((r) => ({
              toolName: "Edit",
              ruleContent: r.slice("Edit(".length, -1),
            })),
            behavior: "allow",
            destination: "session",
          },
        ],
      };
    }
    d.log(`⛔ the door refused ${named.join(", ")} — not this unit's to change`);
    return { behavior: "deny", message: refusalLesson(named, d.footprint(), ruling.refused) };
  };
}
