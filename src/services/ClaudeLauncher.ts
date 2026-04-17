/**
 * ClaudeLauncher - Launches Claude CLI with contextual prompts
 *
 * Assembles prompts from:
 * 1. System context: what this config type does, file paths, schema
 * 2. Project context: detected tools, frameworks, existing config
 *
 * Claude runs in interactive mode and asks the user clarifying questions
 * before generating config. No VS Code input boxes needed.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectAnalyzer, ProjectInfo } from './ProjectAnalyzer';
import { HookEvent } from '../models/Hook';

export type GenerateTarget =
    | { kind: 'hook'; event: HookEvent }
    | { kind: 'command' }
    | { kind: 'skill' }
    | { kind: 'agent' }
    | { kind: 'mcp-server' }
    | { kind: 'full-setup' }
    | { kind: 'workspace-config' };

interface ExistingConfig {
    hasClaudeMd: boolean;
    hasClaudeLocalMd: boolean;
    hasSettingsJson: boolean;
    hasSettingsLocalJson: boolean;
    hasMcpJson: boolean;
    hasCommandsDir: boolean;
    hasAgentsDir: boolean;
    commandFiles: string[];
    agentFiles: string[];
    skillFiles: string[];
}

interface PromptContext {
    projectPath: string;
    projectInfo: ProjectInfo;
    existing: ExistingConfig;
    target: GenerateTarget;
}

const HOOK_EVENT_DESCRIPTIONS: Record<string, string> = {
    PreToolUse: 'Runs BEFORE a tool executes. Can block execution by returning exit code 2. Use for: validation, blocking dangerous operations, checking preconditions. Available env: $CLAUDE_TOOL_NAME, $CLAUDE_FILE_PATH, $CLAUDE_TOOL_INPUT (JSON on stdin).',
    PostToolUse: 'Runs AFTER a tool completes. Use for: auto-formatting, linting, running tests after edits, notifications. Available env: $CLAUDE_TOOL_NAME, $CLAUDE_FILE_PATH, $CLAUDE_TOOL_OUTPUT (JSON on stdin).',
    SessionStart: 'Runs when a Claude session begins. Use for: environment checks, dependency verification, displaying project status, loading context.',
    SessionEnd: 'Runs when a Claude session ends. Use for: cleanup, saving session summaries, notifications.',
    Stop: 'Runs when Claude finishes a response. Use for: post-response validation, logging.',
    StopFailure: 'Runs when Claude stops due to an error. Use for: error logging, notifications.',
    UserPromptSubmit: 'Runs when the user submits a prompt. Can modify the prompt by writing to stdout. Use for: prompt enrichment, context injection, routing.',
    PermissionRequest: 'Runs when Claude requests a permission. Use for: auto-approval workflows, logging permission requests.',
    PermissionDenied: 'Runs when a permission is denied. Use for: logging, alternative action suggestions.',
    CwdChanged: 'Runs when the working directory changes. Use for: context updates, environment reloading.',
    FileChanged: 'Runs when a file is modified. Use for: triggering builds, updating indexes.',
    WorktreeCreate: 'Runs when a git worktree is created. Use for: worktree setup, dependency installation.',
};

const CONFIG_TYPE_GUIDANCE: Record<string, string> = {
    command: `Commands are user-invoked slash commands (e.g., /review, /test, /deploy).
They are markdown files in .claude/commands/ with frontmatter.
The body is a prompt that Claude executes when the user types the command.
Commands can accept arguments via $ARGUMENTS placeholder.`,

    skill: `Skills are reusable capabilities that Claude can invoke automatically or the user can trigger.
They live in .claude/skills/{skill-name}/SKILL.md — each skill gets its own directory that can include supporting files.
Frontmatter fields: "description", "allowed-tools", "model", "disable-model-invocation", "user-invocable".
Use for: coding standards, API conventions, domain knowledge, review checklists.`,

    agent: `Agents are subagents that run with isolated context for complex delegated tasks.
They are markdown files in .claude/agents/ with frontmatter including "allowed-tools", "model", and optionally "denied-tools".
Agents get their own conversation context, so they're best for tasks needing deep focus.
Use for: code review, security audit, test writing, documentation generation.`,

    'mcp-server': `MCP servers provide external tool integrations for Claude.
They are configured in .mcp.json at the project root.
Two transport types:
- stdio: local process with "command" and "args" (e.g., npx -y @modelcontextprotocol/server-github)
- http: remote server with "url" and optional "headers" (e.g., https://api.example.com/mcp)`,
};

export class ClaudeLauncher {
    private projectInfoCache: Map<string, { info: ProjectInfo; timestamp: number }> = new Map();
    private static readonly CACHE_TTL = 30000; // 30 seconds

    /**
     * Launch Claude CLI with a contextual prompt for generating config.
     * Claude will ask the user clarifying questions interactively.
     */
    async launch(projectPath: string, target: GenerateTarget): Promise<void> {
        const projectInfo = await this.getProjectInfo(projectPath);
        const existing = this.detectExistingConfig(projectPath);

        const prompt = this.buildPrompt({ projectPath, projectInfo, existing, target });
        this.openTerminal(projectPath, prompt, target);
    }

    /**
     * Launch full project setup — generates a complete starter config.
     */
    async launchFullSetup(projectPath: string): Promise<void> {
        const projectInfo = await this.getProjectInfo(projectPath);
        const existing = this.detectExistingConfig(projectPath);

        const prompt = this.buildPrompt({
            projectPath, projectInfo, existing,
            target: { kind: 'full-setup' },
        });

        this.openTerminal(projectPath, prompt, { kind: 'full-setup' });
    }

    private buildPrompt(ctx: PromptContext): string {
        const { projectPath, projectInfo, existing, target } = ctx;
        const toolsSummary = projectInfo.tools.map(t => t.name).join(', ') || 'none detected';
        const existingDesc = this.describeExistingConfig(existing);

        switch (target.kind) {
            case 'hook':
                return this.buildHookPrompt(projectPath, projectInfo, target.event, toolsSummary, existingDesc);
            case 'command':
                return this.buildCommandPrompt(projectPath, projectInfo, toolsSummary, existingDesc);
            case 'skill':
                return this.buildSkillPrompt(projectPath, projectInfo, toolsSummary, existingDesc);
            case 'agent':
                return this.buildAgentPrompt(projectPath, projectInfo, toolsSummary, existingDesc);
            case 'mcp-server':
                return this.buildMcpPrompt(projectPath, projectInfo, toolsSummary, existingDesc);
            case 'full-setup':
                return this.buildFullSetupPrompt(projectPath, projectInfo, toolsSummary, existingDesc);
            case 'workspace-config':
                return this.buildWorkspaceConfigPrompt(projectPath);
        }
    }

    private buildHookPrompt(projectPath: string, info: ProjectInfo, event: HookEvent, tools: string, existingDesc: string): string {
        const eventDesc = HOOK_EVENT_DESCRIPTIONS[event] || 'Triggered during Claude operation.';

        return `You are helping the user create a ${event} hook for the project at "${projectPath}".

PROJECT: ${info.name} (${info.type}), tools: ${tools}

${existingDesc}

HOOK EVENT — ${event}:
${eventDesc}

FIRST: Ask the user what they want this ${event} hook to do. Give 2-3 concrete examples relevant to their project and detected tools to help them decide. Wait for their answer before proceeding.

THEN, once you understand their intent:
1. Examine the project to understand the codebase and tools
2. Create the hook by writing to the settings file at "${projectPath}/.claude/settings.json"
3. The hook goes under "hooks.${event}" as an array of hook entries
4. Each entry has: { "hooks": [{ "type": "command", "command": "..." }], "matcher": "ToolName" }
5. Matcher is a tool name like "Edit", "Write", "Bash", or "*" for all tools. Leave matcher empty for non-tool events.
6. Make sure the settings.json file is valid JSON and preserves any existing settings
7. If the hook needs a script file, create it and make it executable

After creating the hook, briefly explain what it does and how to test it.`;
    }

    private buildCommandPrompt(projectPath: string, info: ProjectInfo, tools: string, existingDesc: string): string {
        return `You are helping the user create a Claude Code slash command for the project at "${projectPath}".

PROJECT: ${info.name} (${info.type}), tools: ${tools}

${existingDesc}

${CONFIG_TYPE_GUIDANCE.command}

FIRST: Ask the user what they want this command to do. Suggest 2-3 useful commands for their project type (e.g., test runner, code review, deployment helper) to inspire them. Wait for their answer before proceeding.

THEN, once you understand their intent:
1. Examine the project to understand the codebase
2. Create the command as a markdown file in "${projectPath}/.claude/commands/"
3. Use this frontmatter format:
   ---
   description: What this command does
   ---
4. The body is the prompt Claude will execute when the user types this command
5. Use $ARGUMENTS in the body if the command should accept parameters
6. Make the prompt specific to this project's stack and conventions

After creating the command, explain how to use it (e.g., "/command-name [args]").`;
    }

    private buildSkillPrompt(projectPath: string, info: ProjectInfo, tools: string, existingDesc: string): string {
        return `You are helping the user create a Claude Code skill for the project at "${projectPath}".

PROJECT: ${info.name} (${info.type}), tools: ${tools}

${existingDesc}

${CONFIG_TYPE_GUIDANCE.skill}

FIRST: Ask the user what knowledge or conventions this skill should encode. Give 2-3 examples relevant to their project (e.g., API patterns, naming conventions, architecture guidelines) to help them think about it. Wait for their answer before proceeding.

THEN, once you understand their intent:
1. Examine the project to understand patterns, conventions, and architecture
2. Create the skill directory at "${projectPath}/.claude/skills/{skill-name}/"
3. Create SKILL.md inside that directory with this frontmatter format:
   ---
   description: What this skill provides
   allowed-tools: [Read, Grep, Glob]
   ---
4. The body defines the knowledge, guidelines, or behavior pattern
5. Skills should encode project-specific knowledge that Claude should always apply
6. Reference actual files and patterns from this project
7. If the skill needs supporting files (templates, examples, scripts), put them in the same directory

After creating the skill, explain when Claude will use it.`;
    }

    private buildAgentPrompt(projectPath: string, info: ProjectInfo, tools: string, existingDesc: string): string {
        return `You are helping the user create a Claude Code subagent for the project at "${projectPath}".

PROJECT: ${info.name} (${info.type}), tools: ${tools}

${existingDesc}

${CONFIG_TYPE_GUIDANCE.agent}

FIRST: Ask the user what task this agent should handle. Suggest 2-3 agent ideas suited to their project (e.g., security reviewer, test writer, documentation generator) to help them decide. Wait for their answer before proceeding.

THEN, once you understand their intent:
1. Examine the project to understand the codebase
2. Create the agent as a markdown file in "${projectPath}/.claude/agents/"
3. Use this frontmatter format:
   ---
   description: What this agent does
   allowed-tools: [Read, Grep, Glob, Edit, Write]
   model: (optional, omit to inherit)
   ---
4. The body defines the agent's instructions and behavior
5. Agents should be focused on a specific task that benefits from isolated context
6. Include specific checklists, review criteria, or step-by-step processes

After creating the agent, explain how to invoke it.`;
    }

    private buildMcpPrompt(projectPath: string, info: ProjectInfo, tools: string, existingDesc: string): string {
        return `You are helping the user configure an MCP server for the project at "${projectPath}".

PROJECT: ${info.name} (${info.type}), tools: ${tools}

${existingDesc}

${CONFIG_TYPE_GUIDANCE['mcp-server']}

FIRST: Ask the user what external service or capability they want to integrate. Suggest 2-3 popular MCP servers relevant to their stack (e.g., GitHub, database, filesystem tools) to help them choose. Wait for their answer before proceeding.

THEN, once you understand their intent:
1. Create or update the file "${projectPath}/.mcp.json"
2. The format is: { "mcpServers": { "server-id": { config } } }
3. For stdio: { "command": "npx", "args": ["-y", "package-name"] }
4. For http: { "type": "http", "url": "https://...", "headers": {} }
5. Preserve any existing servers in the file
6. If the server needs environment variables (API tokens), use placeholders and tell the user what to set

After configuring, explain what tools the MCP server provides and how to verify it's working.`;
    }

    private buildFullSetupPrompt(projectPath: string, info: ProjectInfo, tools: string, existingDesc: string): string {
        return `You are helping the user set up Claude Code configuration for the project at "${projectPath}".

PROJECT: ${info.name} (${info.type}), detected tools: ${tools}

${existingDesc}

FIRST: Ask the user about their workflow goals for this project. For example:
- What tasks do they use Claude for most? (coding, reviewing, testing, deploying)
- Are there files or directories that should be protected from edits?
- Any specific conventions or patterns Claude should follow?
Give a brief overview of what you can set up (hooks, commands, permissions) so they know what's possible. Wait for their answer before proceeding.

IMPORTANT: Do NOT overwrite or recreate any files listed above as existing. Only create what is missing.

THEN, examine the codebase and create ONLY the missing config:

1. **CLAUDE.md** — Do NOT create or modify CLAUDE.md. If it is missing, tell the user to run "claude init" to generate it properly.

2. **Hooks** — Write to "${projectPath}/.claude/settings.json" (read existing file first, merge new hooks):
   - PostToolUse hooks for detected linters/formatters (${tools})
   - PreToolUse hooks if there are files/directories that should be protected
   - Format: { "hooks": { "EventName": [{ "hooks": [{ "type": "command", "command": "..." }], "matcher": "ToolName" }] } }

3. **Commands** — Create in "${projectPath}/.claude/commands/" (skip any that already exist):
   - A test command if test framework detected
   - A build/type-check command if applicable
   - Format: markdown with frontmatter (description) and prompt body

4. **Permissions** — In settings.json (merge with existing):
   - Allow safe tools: Read, Grep, Glob
   - Set appropriate restrictions based on project type

Focus on quality over quantity — only create configs that add real value for this specific project. Each hook should actually work with the project's tooling.

After setup, give a summary of what was created (and what was skipped because it already existed).`;
    }

    private buildWorkspaceConfigPrompt(workspacePath: string): string {
        const sectionName = path.basename(workspacePath);

        // Scan repos in this workspace section
        const repos: string[] = [];
        try {
            const entries = fs.readdirSync(workspacePath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    const fullPath = path.join(workspacePath, entry.name);
                    if (fs.existsSync(path.join(fullPath, '.git'))) {
                        repos.push(entry.name);
                    }
                }
            }
        } catch { /* ignore */ }

        const existingClaudeMd = fs.existsSync(path.join(workspacePath, 'CLAUDE.md'));

        return `You are helping the user create a workspace-level CLAUDE.md at "${workspacePath}/CLAUDE.md" that describes how the repositories in the "${sectionName}" workspace relate to each other.

${existingClaudeMd ? 'WARNING: CLAUDE.md already exists at this path. Read it first and update/improve it rather than replacing it.' : ''}

REPOSITORIES IN THIS WORKSPACE:
${repos.map(r => `- ${r}/`).join('\n')}

FIRST: Ask the user to describe the high-level purpose of this workspace and how these repos relate. For example:
- Is this a platform with shared infrastructure?
- Do some repos deploy others?
- Are there shared conventions or patterns across repos?
Wait for their answer before proceeding.

IMPORTANT BACKGROUND:
Claude Code walks UP the directory tree looking for CLAUDE.md files. A CLAUDE.md at "${workspacePath}/" will be automatically inherited by every project underneath it. This makes it the right place for:
- How these repositories relate to each other (dependencies, shared patterns, deployment order)
- Cross-repo conventions (naming, API contracts, shared types)
- Which repo is the "source of truth" for what
- Common workflows that span multiple repos
- Paths and references between repos

THEN:
1. Examine each repository to understand what it does (read their README.md, CLAUDE.md, package.json, etc.)
2. Identify relationships: which repos depend on each other, share code, or deploy together
3. Create "${workspacePath}/CLAUDE.md" with:
   - A brief overview of this workspace section
   - A table or list of repos with one-line descriptions
   - Key relationships and dependencies between repos
   - Cross-repo conventions and patterns
   - Common multi-repo workflows (e.g., "after changing X in repo A, you must also update Y in repo B")

Keep it concise and practical — focus on what someone working in ANY of these repos needs to know about the others.`;
    }

    private openTerminal(projectPath: string, prompt: string, target: GenerateTarget): void {
        const terminalName = this.getTerminalName(target);

        // Write prompt to a temp file and create a runner script.
        // This avoids all shell quoting issues — the script reads the file
        // and passes the content as an argument to claude via execFileSync.
        const tmpFile = path.join(os.tmpdir(), `claude-prompt-${Date.now()}.txt`);
        const tmpRunner = path.join(os.tmpdir(), `claude-run-${Date.now()}.mjs`);
        fs.writeFileSync(tmpFile, prompt, 'utf8');
        fs.writeFileSync(tmpRunner, [
            `import { readFileSync, unlinkSync } from 'fs';`,
            `import { execFileSync } from 'child_process';`,
            `const prompt = readFileSync('${tmpFile}', 'utf8');`,
            `try { unlinkSync('${tmpFile}'); } catch {}`,
            `try { unlinkSync('${tmpRunner}'); } catch {}`,
            `execFileSync('claude', ['--permission-mode', 'acceptEdits', prompt], { stdio: 'inherit', cwd: '${projectPath.replace(/'/g, "\\'")}' });`,
        ].join('\n'));

        const terminal = vscode.window.createTerminal({
            name: terminalName,
            cwd: projectPath,
        });

        terminal.show();
        terminal.sendText(`node '${tmpRunner}'`);
    }

    private getTerminalName(target: GenerateTarget): string {
        switch (target.kind) {
            case 'hook': return `Claude: Generate ${target.event} Hook`;
            case 'command': return 'Claude: Generate Command';
            case 'skill': return 'Claude: Generate Skill';
            case 'agent': return 'Claude: Generate Agent';
            case 'mcp-server': return 'Claude: Configure MCP Server';
            case 'full-setup': return 'Claude: Project Setup';
            case 'workspace-config': return 'Claude: Workspace Config';
        }
    }

    // ========== Project detection with caching ==========

    private async getProjectInfo(projectPath: string): Promise<ProjectInfo> {
        const cached = this.projectInfoCache.get(projectPath);
        if (cached && Date.now() - cached.timestamp < ClaudeLauncher.CACHE_TTL) {
            return cached.info;
        }

        const analyzer = new ProjectAnalyzer(projectPath);
        const info = await analyzer.analyze();

        this.projectInfoCache.set(projectPath, { info, timestamp: Date.now() });
        return info;
    }

    // ========== Existing config detection ==========

    private detectExistingConfig(projectPath: string): ExistingConfig {
        const claudeDir = path.join(projectPath, '.claude');
        const commandsDir = path.join(claudeDir, 'commands');
        const agentsDir = path.join(claudeDir, 'agents');

        const skillsDir = path.join(claudeDir, 'skills');

        const listMdFiles = (dir: string): string[] => {
            try {
                return fs.readdirSync(dir).filter(f => f.endsWith('.md'));
            } catch {
                return [];
            }
        };

        const listSubdirs = (dir: string): string[] => {
            try {
                return fs.readdirSync(dir, { withFileTypes: true })
                    .filter(d => d.isDirectory())
                    .map(d => d.name);
            } catch {
                return [];
            }
        };

        const commandFiles = listMdFiles(commandsDir);
        const agentFiles = listMdFiles(agentsDir);
        const skillFiles = listSubdirs(skillsDir);

        return {
            hasClaudeMd: fs.existsSync(path.join(projectPath, 'CLAUDE.md')),
            hasClaudeLocalMd: fs.existsSync(path.join(projectPath, 'CLAUDE.local.md')),
            hasSettingsJson: fs.existsSync(path.join(claudeDir, 'settings.json')),
            hasSettingsLocalJson: fs.existsSync(path.join(claudeDir, 'settings.local.json')),
            hasMcpJson: fs.existsSync(path.join(projectPath, '.mcp.json')),
            hasCommandsDir: fs.existsSync(commandsDir),
            hasAgentsDir: fs.existsSync(agentsDir),
            commandFiles,
            agentFiles,
            skillFiles,
        };
    }

    private describeExistingConfig(existing: ExistingConfig): string {
        const parts: string[] = [];

        if (existing.hasClaudeMd) parts.push('CLAUDE.md EXISTS - DO NOT overwrite or recreate it');
        if (existing.hasClaudeLocalMd) parts.push('CLAUDE.local.md EXISTS');
        if (existing.hasSettingsJson) parts.push('settings.json EXISTS - merge into it, do not replace');
        if (existing.hasSettingsLocalJson) parts.push('settings.local.json EXISTS');
        if (existing.hasMcpJson) parts.push('.mcp.json EXISTS - merge into it, do not replace');
        if (existing.commandFiles.length > 0) parts.push(`Existing commands: ${existing.commandFiles.join(', ')}`);
        if (existing.skillFiles.length > 0) parts.push(`Existing skills: ${existing.skillFiles.join(', ')}`);
        if (existing.agentFiles.length > 0) parts.push(`Existing agents: ${existing.agentFiles.join(', ')}`);

        if (parts.length === 0) {
            return 'No existing config detected. Create everything from scratch.';
        }

        return 'EXISTING CONFIG (do not overwrite):\n' + parts.map(p => `- ${p}`).join('\n');
    }
}
