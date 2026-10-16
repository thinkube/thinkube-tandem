/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agent - Claude Code subagent definition
 *
 * Agents are markdown files with YAML frontmatter stored in
 * .claude/agents/{agent-name}.md. The fields are Claude Code's own:
 *   name, description, tools, disallowedTools, model, effort, maxTurns,
 *   permissionMode, skills, mcpServers, background, isolation, memory,
 *   omitClaudeMd
 * Tandem's roles (agents/tandem-*.md in this repository) are written in
 * the same shape, so one parser reads both.
 */

const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];

export interface Agent {
  name: string;
  description: string;
  /** The tools it may use; empty means it inherits the session's. */
  tools: string[];
  disallowedTools: string[];
  model?: string; // alias, full model ID, or omit to inherit
  effort?: Effort;
  maxTurns?: number;
  permissionMode?: string;
  /** Skills preloaded into its context. */
  skills: string[];
  mcpServers: string[];
  background?: boolean;
  isolation?: "worktree";
  memory?: "user" | "project" | "local";
  omitClaudeMd?: boolean;
  content: string;
  filePath: string;
}

function list(values: readonly string[]): string {
  return values.join(", ");
}

export function agentToMarkdown(agent: Agent | Omit<Agent, "filePath">): string {
  const lines = ["---", `name: ${agent.name}`, `description: ${agent.description}`];
  if (agent.tools.length) lines.push(`tools: ${list(agent.tools)}`);
  if (agent.disallowedTools.length) lines.push(`disallowedTools: ${list(agent.disallowedTools)}`);
  if (agent.model) lines.push(`model: ${agent.model}`);
  if (agent.effort) lines.push(`effort: ${agent.effort}`);
  if (agent.maxTurns !== undefined) lines.push(`maxTurns: ${agent.maxTurns}`);
  if (agent.permissionMode) lines.push(`permissionMode: ${agent.permissionMode}`);
  if (agent.skills.length) lines.push(`skills: ${list(agent.skills)}`);
  if (agent.mcpServers.length) lines.push(`mcpServers: ${list(agent.mcpServers)}`);
  if (agent.background !== undefined) lines.push(`background: ${agent.background}`);
  if (agent.isolation) lines.push(`isolation: ${agent.isolation}`);
  if (agent.memory) lines.push(`memory: ${agent.memory}`);
  if (agent.omitClaudeMd !== undefined) lines.push(`omitClaudeMd: ${agent.omitClaudeMd}`);
  lines.push("---", "");
  return lines.join("\n") + agent.content;
}

/** A list field: a comma-separated line, or a YAML inline list `[a, b]`. */
function listOf(value: string | undefined): string[] {
  if (!value) return [];
  const inner = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  return inner
    .split(",")
    .map((t) => t.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function boolOf(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return /^(true|yes|on|1)$/i.test(value.trim());
}

export function parseAgentMarkdown(content: string, filePath: string): Agent | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) return null;

  const [, frontmatter, body] = frontmatterMatch;
  const metadata: Record<string, string> = {};
  frontmatter.split("\n").forEach((line) => {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) metadata[match[1].trim()] = match[2].trim();
  });

  const effort = EFFORT_LEVELS.find((e) => e === metadata["effort"]);
  const maxTurns = metadata["maxTurns"] !== undefined ? Number(metadata["maxTurns"]) : undefined;
  const memory = (["user", "project", "local"] as const).find((m) => m === metadata["memory"]);

  return {
    name: metadata["name"] || filePath.split("/").pop()?.replace(".md", "") || "",
    description: metadata["description"] || "",
    tools: listOf(metadata["tools"]),
    disallowedTools: listOf(metadata["disallowedTools"]),
    model: metadata["model"] || undefined,
    ...(effort ? { effort } : {}),
    ...(maxTurns !== undefined && Number.isInteger(maxTurns) && maxTurns > 0 ? { maxTurns } : {}),
    ...(metadata["permissionMode"] ? { permissionMode: metadata["permissionMode"] } : {}),
    skills: listOf(metadata["skills"]),
    mcpServers: listOf(metadata["mcpServers"]),
    ...(metadata["background"] !== undefined ? { background: boolOf(metadata["background"]) } : {}),
    ...(metadata["isolation"] === "worktree" ? { isolation: "worktree" as const } : {}),
    ...(memory ? { memory } : {}),
    ...(metadata["omitClaudeMd"] !== undefined ? { omitClaudeMd: boolOf(metadata["omitClaudeMd"]) } : {}),
    content: body.trim(),
    filePath,
  };
}
