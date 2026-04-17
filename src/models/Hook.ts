/**
 * Hook - Claude Code hook configuration
 *
 * Hooks execute at various points in Claude Code's lifecycle.
 * Supports 12 event types and 4 hook types (command, http, prompt, agent).
 */

export const HOOK_EVENTS = [
    'SessionStart',
    'SessionEnd',
    'UserPromptSubmit',
    'Stop',
    'StopFailure',
    'PreToolUse',
    'PostToolUse',
    'PermissionRequest',
    'PermissionDenied',
    'CwdChanged',
    'FileChanged',
    'WorktreeCreate'
] as const;

export type HookEvent = typeof HOOK_EVENTS[number];

export type HookType = 'command' | 'http' | 'prompt' | 'agent';

export interface HookDefinition {
    type: HookType;
    // command type
    command?: string;
    timeout?: number;
    // http type
    url?: string;
    headers?: Record<string, string>;
    // prompt type
    prompt?: string;
    // agent type
    agent?: string;
    // common optional fields
    if?: string;           // conditional expression
    async?: boolean;
    asyncRewake?: boolean;
}

export interface HookMatcher {
    matcher: string;  // Tool pattern, e.g., "Edit|Write", or "" for non-tool events
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
    agent?: string;
    timeout?: number;
    filePath?: string;
}

export function createHook(
    event: HookEvent,
    matcher: string,
    hookDef: HookDefinition
): Hook {
    return {
        id: `${event}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        event,
        matcher,
        hookType: hookDef.type,
        command: hookDef.command,
        url: hookDef.url,
        prompt: hookDef.prompt,
        agent: hookDef.agent,
        timeout: hookDef.timeout
    };
}

/**
 * Get a human-readable summary of a hook definition.
 */
export function hookSummary(hookDef: HookDefinition): string {
    switch (hookDef.type) {
        case 'command': return hookDef.command || '(no command)';
        case 'http': return hookDef.url || '(no url)';
        case 'prompt': return hookDef.prompt ? hookDef.prompt.substring(0, 60) : '(no prompt)';
        case 'agent': return hookDef.agent || '(no agent)';
        default: return '(unknown type)';
    }
}
