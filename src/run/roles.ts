/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The roles of a run, as files.
 *
 * Coder, tester and closer used to be constants spread over the worker's
 * code: who each one is was said nowhere a person could read or change.
 * Each is now an agent definition in the shape Claude Code reads
 * (`agents/tandem-<role>.md`: frontmatter and a prompt), passed to the
 * harness so a worker's session runs AS that role, with the role's words
 * as its system prompt. A repository may say the role's words its own way
 * in `.claude/agents/tandem-<role>.md`, and the Configuration view shows
 * it there.
 *
 * What a role may reach for is NOT read from its file. The tools are the
 * run's rule (src/run/footprintRules.ts, src/run/toolsAllowed.ts): a
 * repository that could hand its tester a shell would be writing its own
 * blinding wall, and the whole verification argument rests on that wall
 * being the run's.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { type Effort, parseAgentMarkdown } from "../engine/host/models/Agent";

export const ROLE_NAMES = ["tandem-coder", "tandem-tester", "tandem-closer"] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

/** Which role a worker runs as: the closer is the unfenced last actor,
 *  whatever role name it was handed. */
export function roleNameFor(w: { role: "code" | "test"; unfenced?: boolean }): RoleName {
  if (w.unfenced) return "tandem-closer";
  return w.role === "test" ? "tandem-tester" : "tandem-coder";
}

export interface Role {
  name: RoleName;
  description: string;
  /** The role's words: the session's system prompt. */
  prompt: string;
  effort?: Effort;
  maxTurns?: number;
  /** The file it was read from, so a log can say whose words these are. */
  from: string;
}

/** The roles this extension ships, beside its code. */
const BUNDLED_ROLES_DIR = path.resolve(__dirname, "..", "..", "agents");

/**
 * A role's definition: the repository's own file when it has one, else the
 * bundled one. A role file that cannot be read or has no words is an
 * error naming the file, never a worker running as nobody.
 */
export function roleDefinition(name: RoleName, repoRoot?: string, bundledDir = BUNDLED_ROLES_DIR): Role {
  const own = repoRoot ? path.join(repoRoot, ".claude", "agents", `${name}.md`) : undefined;
  const file = own && fs.existsSync(own) ? own : path.join(bundledDir, `${name}.md`);
  const parsed = parseAgentMarkdown(fs.readFileSync(file, "utf8"), file);
  if (!parsed) throw new Error(`${file} has no frontmatter: a role file starts with --- name / description ---`);
  if (!parsed.description.trim()) throw new Error(`${file} has no description: who is this role?`);
  if (!parsed.content.trim()) throw new Error(`${file} has no words: a role's prompt is its body`);
  return {
    name,
    description: parsed.description.trim(),
    prompt: parsed.content,
    ...(parsed.effort ? { effort: parsed.effort } : {}),
    ...(parsed.maxTurns ? { maxTurns: parsed.maxTurns } : {}),
    from: file,
  };
}

/** Whether a role was read from the repository's own file. */
export function isOwn(role: Role): boolean {
  return role.from.includes(`${path.sep}.claude${path.sep}agents${path.sep}`);
}

/** The definition as the harness takes it. */
export function agentDefinitionOf(role: Role): {
  description: string;
  prompt: string;
  effort?: Effort;
  maxTurns?: number;
} {
  return {
    description: role.description,
    prompt: role.prompt,
    ...(role.effort ? { effort: role.effort } : {}),
    ...(role.maxTurns ? { maxTurns: role.maxTurns } : {}),
  };
}
