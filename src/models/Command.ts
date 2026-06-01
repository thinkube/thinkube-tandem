/**
 * Command - Claude Code custom slash command
 *
 * Custom slash commands are markdown files with YAML frontmatter
 * stored in .claude/commands/
 *
 * Commands share the same frontmatter format as skills in Claude Code.
 * Frontmatter fields (all optional except description):
 *   description, argument-hint, user-invocable, allowed-tools,
 *   model, effort, paths, context, agent, shell
 */

export interface Command {
  name: string;
  description: string;
  argumentHint?: string;
  content: string;
  filePath: string;
  // Extended frontmatter
  userInvocable?: boolean;
  allowedTools?: string[];
  model?: string;
  effort?: string;
  paths?: string[];
  context?: string;
  agent?: string;
  shell?: string;
}

export function createCommand(
  name: string,
  description: string,
  content: string,
  argumentHint?: string,
): Omit<Command, "filePath"> {
  return {
    name: normalizeCommandName(name),
    description,
    argumentHint,
    content,
  };
}

export function normalizeCommandName(name: string): string {
  if (name.startsWith("/")) {
    name = name.slice(1);
  }
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-");
}

export function commandToMarkdown(
  command: Command | Omit<Command, "filePath">,
): string {
  const lines = ["---", `description: ${command.description}`];

  if (command.argumentHint) {
    lines.push(`argument-hint: ${command.argumentHint}`);
  }
  if (command.userInvocable !== undefined) {
    lines.push(`user-invocable: ${command.userInvocable}`);
  }
  if (command.allowedTools && command.allowedTools.length > 0) {
    lines.push(`allowed-tools: ${command.allowedTools.join(", ")}`);
  }
  if (command.model) {
    lines.push(`model: ${command.model}`);
  }
  if (command.effort) {
    lines.push(`effort: ${command.effort}`);
  }
  if (command.paths && command.paths.length > 0) {
    lines.push(`paths: ${command.paths.join(", ")}`);
  }
  if (command.context) {
    lines.push(`context: ${command.context}`);
  }
  if (command.agent) {
    lines.push(`agent: ${command.agent}`);
  }
  if (command.shell) {
    lines.push(`shell: ${command.shell}`);
  }

  lines.push("---", "");

  return lines.join("\n") + command.content;
}

export function parseCommandMarkdown(
  content: string,
  filePath: string,
): Command | null {
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

  const name = filePath.split("/").pop()?.replace(".md", "") || "";

  const parseBool = (v: string | undefined): boolean | undefined => {
    if (v === undefined) return undefined;
    return v === "true";
  };

  const toolsStr = metadata["allowed-tools"] || "";
  const pathsStr = metadata["paths"] || "";

  return {
    name,
    description: metadata["description"] || "",
    argumentHint: metadata["argument-hint"],
    content: body.trim(),
    filePath,
    userInvocable: parseBool(metadata["user-invocable"]),
    allowedTools: toolsStr
      ? toolsStr.split(",").map((t) => t.trim())
      : undefined,
    model: metadata["model"],
    effort: metadata["effort"],
    paths: pathsStr ? pathsStr.split(",").map((p) => p.trim()) : undefined,
    context: metadata["context"],
    agent: metadata["agent"],
    shell: metadata["shell"],
  };
}
