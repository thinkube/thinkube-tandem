/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hook - Claude Code hook configuration
 *
 * Hooks execute at various points in Claude Code's lifecycle.
 * The events and the five hook types (command, http, prompt, agent,
 * mcp_tool) are Claude Code's own, as the Agent SDK declares them.
 */

export const HOOK_EVENTS = [
  "SessionStart",
  "Setup",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "PreToolUse",
  "PermissionRequest",
  "PermissionDenied",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "Notification",
  "MessageDisplay",
  "SubagentStart",
  "SubagentStop",
  "TaskCreated",
  "TaskCompleted",
  "Stop",
  "StopFailure",
  "TeammateIdle",
  "InstructionsLoaded",
  "ConfigChange",
  "CwdChanged",
  "DirectoryAdded",
  "FileChanged",
  "WorktreeCreate",
  "WorktreeRemove",
  "PreCompact",
  "PostCompact",
  "Elicitation",
  "ElicitationResult",
  "SessionEnd",
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

type HookType = "command" | "http" | "prompt" | "agent" | "mcp_tool";

export interface HookDefinition {
  type: HookType;
  // command type
  command?: string;
  args?: string[];
  timeout?: number;
  // http type
  url?: string;
  headers?: Record<string, string>;
  // prompt and agent types: the prompt a model answers, or the task an agent verifies
  prompt?: string;
  model?: string;
  // mcp_tool type
  server?: string;
  tool?: string;
  input?: Record<string, unknown>;
  // common optional fields
  if?: string; // permission-rule syntax, on tool events
  onFailure?: "continue" | "block";
  statusMessage?: string;
  once?: boolean;
  async?: boolean;
  asyncRewake?: boolean;
}

export interface HookMatcher {
  matcher: string; // Tool pattern, e.g., "Edit|Write", or "" for non-tool events
  hooks: HookDefinition[];
}

export interface Hook {
  id: string;
  event: HookEvent;
  matcher: string;
  hookType: HookType;
  // Type-specific detail (for display)
  command?: string;
  url?: string;
  prompt?: string;
  server?: string;
  tool?: string;
  timeout?: number;
  filePath?: string;
}

export function createHook(
  event: HookEvent,
  matcher: string,
  hookDef: HookDefinition,
): Hook {
  return {
    id: `${event}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    event,
    matcher,
    hookType: hookDef.type,
    command: hookDef.command,
    url: hookDef.url,
    prompt: hookDef.prompt,
    server: hookDef.server,
    tool: hookDef.tool,
    timeout: hookDef.timeout,
  };
}
