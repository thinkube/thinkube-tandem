/**
 * ClaudeConfig - Main configuration structure for Claude Code
 *
 * settings.json may contain many fields (model, sandbox, env, enabledPlugins, etc.)
 * beyond what this extension directly manages. We use Record<string, unknown> as the
 * base type and provide typed accessors for known fields, preserving unknown fields
 * during read-modify-write operations.
 */

import { HookMatcher } from "./Hook";

export interface Permissions {
  allow: string[];
  deny: string[];
  ask: string[];
}

/**
 * ClaudeSettings is the raw content of settings.json.
 * We only type the fields we actively manage; everything else is preserved as-is.
 */
export interface ClaudeSettings {
  hooks?: Record<string, HookMatcher[]>;
  permissions?: Permissions;
  [key: string]: unknown;
}

export interface ClaudeConfig {
  settings: ClaudeSettings;
  settingsPath: string; // .claude/settings.json
  settingsLocalPath: string; // .claude/settings.local.json
  mcpJsonPath: string; // .mcp.json (project root)
  claudeMdPath?: string; // CLAUDE.md
  claudeLocalMdPath?: string; // CLAUDE.local.md
  claudeMdContent?: string;
  commandsDir: string; // .claude/commands/
  skillsDir: string; // .claude/skills/
  agentsDir: string; // .claude/agents/
  rulesDir: string; // .claude/rules/
  outputStylesDir: string; // .claude/output-styles/
}

/**
 * Create default settings — intentionally empty so we don't
 * generate fields that don't belong (e.g., mcpServers).
 */
export function createDefaultSettings(): ClaudeSettings {
  return {};
}

export function createDefaultConfig(basePath: string): ClaudeConfig {
  const claudeDir = `${basePath}/.claude`;
  return {
    settings: createDefaultSettings(),
    settingsPath: `${claudeDir}/settings.json`,
    settingsLocalPath: `${claudeDir}/settings.local.json`,
    mcpJsonPath: `${basePath}/.mcp.json`,
    claudeMdPath: `${basePath}/CLAUDE.md`,
    claudeLocalMdPath: `${basePath}/CLAUDE.local.md`,
    commandsDir: `${claudeDir}/commands`,
    skillsDir: `${claudeDir}/skills`,
    agentsDir: `${claudeDir}/agents`,
    rulesDir: `${claudeDir}/rules`,
    outputStylesDir: `${claudeDir}/output-styles`,
  };
}

export function mergePermissions(
  base: Permissions,
  override: Partial<Permissions>,
): Permissions {
  return {
    allow: [...new Set([...base.allow, ...(override.allow || [])])],
    deny: [...new Set([...base.deny, ...(override.deny || [])])],
    ask: [...new Set([...base.ask, ...(override.ask || [])])],
  };
}
