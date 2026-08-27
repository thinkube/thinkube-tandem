/**
 * Agent - Claude Code subagent definition
 *
 * Agents are markdown files with YAML frontmatter
 * stored in .claude/agents/{agent-name}.md
 *
 * Frontmatter fields (all optional except description):
 *   description, allowed-tools, denied-tools, model,
 *   effort, memory, hooks
 */

export interface Agent {
  name: string;
  description: string;
  allowedTools: string[];
  deniedTools: string[];
  model?: string; // full model ID or omit to inherit
  content: string;
  filePath: string;
  effort?: string;
  memory?: boolean;
}

export function createAgent(
  name: string,
  description: string,
  content: string,
  allowedTools: string[] = [],
  model?: string,
): Omit<Agent, "filePath"> {
  return {
    name: normalizeAgentName(name),
    description,
    allowedTools,
    deniedTools: [],
    model,
    content,
  };
}

export function normalizeAgentName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-");
}

export function agentToMarkdown(
  agent: Agent | Omit<Agent, "filePath">,
): string {
  const lines = ["---", `description: ${agent.description}`];

  if (agent.allowedTools.length > 0) {
    lines.push(`allowed-tools: ${agent.allowedTools.join(", ")}`);
  }
  if (agent.deniedTools.length > 0) {
    lines.push(`denied-tools: ${agent.deniedTools.join(", ")}`);
  }
  if (agent.model) {
    lines.push(`model: ${agent.model}`);
  }
  if (agent.effort) {
    lines.push(`effort: ${agent.effort}`);
  }
  if (agent.memory !== undefined) {
    lines.push(`memory: ${agent.memory}`);
  }

  lines.push("---", "");

  return lines.join("\n") + agent.content;
}

export function parseAgentMarkdown(
  content: string,
  filePath: string,
): Agent | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    return null;
  }

  const [, frontmatter, body] = frontmatterMatch;
  const metadata: Record<string, string> = {};

  frontmatter.split("\n").forEach((line) => {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      metadata[match[1].trim()] = match[2].trim();
    }
  });

  const name =
    metadata["name"] || filePath.split("/").pop()?.replace(".md", "") || "";

  const toolsStr = metadata["allowed-tools"] || metadata["tools"] || "";
  const allowedTools = toolsStr ? toolsStr.split(",").map((t) => t.trim()) : [];

  const deniedStr = metadata["denied-tools"] || "";
  const deniedTools = deniedStr
    ? deniedStr.split(",").map((t) => t.trim())
    : [];

  const parseBool = (v: string | undefined): boolean | undefined => {
    if (v === undefined) return undefined;
    return v === "true";
  };

  return {
    name,
    description: metadata["description"] || "",
    allowedTools,
    deniedTools,
    model: metadata["model"] || undefined,
    content: body.trim(),
    filePath,
    effort: metadata["effort"],
    memory: parseBool(metadata["memory"]),
  };
}
