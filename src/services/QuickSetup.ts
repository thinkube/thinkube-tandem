/**
 * QuickSetup - Generates starter Claude Code config deterministically
 *
 * Detects project type and tools, then creates a working initial configuration.
 * No AI/API calls — instant results based on file detection.
 *
 * Creates:
 * - CLAUDE.md with project description and conventions
 * - settings.json with hooks for detected linters/formatters
 * - Starter commands based on detected test/build tools
 * - Sensible default permissions
 */

import * as fs from 'fs';
import * as path from 'path';
import { ProjectAnalyzer, ProjectInfo, DetectedTool } from './ProjectAnalyzer';

export interface SetupResult {
    filesCreated: string[];
    summary: string;
    needsInit: boolean;
}

export class QuickSetup {
    async setup(projectPath: string): Promise<SetupResult> {
        const analyzer = new ProjectAnalyzer(projectPath);
        const info = await analyzer.analyze();
        const filesCreated: string[] = [];
        const needsInit = !fs.existsSync(path.join(projectPath, 'CLAUDE.md'));

        // Ensure .claude directory exists
        const claudeDir = path.join(projectPath, '.claude');
        const commandsDir = path.join(claudeDir, 'commands');
        fs.mkdirSync(commandsDir, { recursive: true });

        // 1. Create settings.json with hooks and permissions
        const settingsPath = path.join(claudeDir, 'settings.json');
        const settings = this.generateSettings(info);
        if (Object.keys(settings).length > 0) {
            let existing: Record<string, unknown> = {};
            if (fs.existsSync(settingsPath)) {
                try { existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { /* fresh */ }
            }
            // Deep merge: preserve existing hooks/permissions, add new ones
            const merged = { ...existing };
            if (settings.hooks) {
                const existingHooks = (existing.hooks || {}) as Record<string, unknown>;
                merged.hooks = { ...existingHooks, ...(settings.hooks as Record<string, unknown>) };
            }
            if (settings.permissions && !existing.permissions) {
                merged.permissions = settings.permissions;
            }
            fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2), 'utf8');
            filesCreated.push(settingsPath);
        }

        // 3. Create starter commands
        const commandFiles = this.generateCommands(info);
        for (const [name, content] of commandFiles) {
            const filePath = path.join(commandsDir, `${name}.md`);
            if (!fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, content, 'utf8');
                filesCreated.push(filePath);
            }
        }

        const summary = this.buildSummary(info, filesCreated, needsInit);
        return { filesCreated, summary, needsInit };
    }

    private generateSettings(info: ProjectInfo): Record<string, unknown> {
        const settings: Record<string, unknown> = {};
        const hooks: Record<string, unknown[]> = {};
        const toolNames = info.tools.map(t => t.name);

        // PostToolUse hooks for linters/formatters
        const postToolUseHooks: unknown[] = [];

        if (toolNames.includes('ESLint')) {
            postToolUseHooks.push({
                hooks: [{ type: 'command', command: 'npx eslint --fix "$CLAUDE_FILE_PATH" 2>/dev/null || true' }],
                matcher: 'Edit'
            });
        }

        if (toolNames.includes('Prettier')) {
            postToolUseHooks.push({
                hooks: [{ type: 'command', command: 'npx prettier --write "$CLAUDE_FILE_PATH" 2>/dev/null || true' }],
                matcher: 'Edit'
            });
        }

        if (toolNames.includes('Ruff')) {
            postToolUseHooks.push({
                hooks: [{ type: 'command', command: 'ruff check --fix "$CLAUDE_FILE_PATH" 2>/dev/null; ruff format "$CLAUDE_FILE_PATH" 2>/dev/null || true' }],
                matcher: 'Edit'
            });
        }

        if (toolNames.includes('Black')) {
            postToolUseHooks.push({
                hooks: [{ type: 'command', command: 'black "$CLAUDE_FILE_PATH" 2>/dev/null || true' }],
                matcher: 'Edit'
            });
        }

        if (postToolUseHooks.length > 0) {
            hooks['PostToolUse'] = postToolUseHooks;
        }

        if (Object.keys(hooks).length > 0) {
            settings.hooks = hooks;
        }

        // Default permissions
        settings.permissions = {
            allow: ['Read', 'Grep', 'Glob'],
            deny: [],
        };

        return settings;
    }

    private generateCommands(info: ProjectInfo): [string, string][] {
        const commands: [string, string][] = [];
        const toolNames = info.tools.map(t => t.name);

        // Test command
        if (toolNames.includes('Jest')) {
            commands.push(['test', [
                '---',
                'description: Run the test suite and analyze results',
                '---',
                '',
                'Run `npx jest` and report the results.',
                '',
                'If any tests fail:',
                '1. Show the failing test names and error messages',
                '2. Analyze the root cause',
                '3. Suggest or implement fixes',
                '',
                'If $ARGUMENTS is provided, run only matching tests: `npx jest $ARGUMENTS`',
            ].join('\n')]);
        } else if (toolNames.includes('Vitest')) {
            commands.push(['test', [
                '---',
                'description: Run the test suite and analyze results',
                '---',
                '',
                'Run `npx vitest run` and report the results.',
                '',
                'If any tests fail:',
                '1. Show the failing test names and error messages',
                '2. Analyze the root cause',
                '3. Suggest or implement fixes',
                '',
                'If $ARGUMENTS is provided, run only matching tests: `npx vitest run $ARGUMENTS`',
            ].join('\n')]);
        } else if (toolNames.includes('pytest')) {
            commands.push(['test', [
                '---',
                'description: Run the pytest suite and analyze results',
                '---',
                '',
                'Run `pytest -v` and report the results.',
                '',
                'If any tests fail:',
                '1. Show the failing test names and error messages',
                '2. Analyze the root cause',
                '3. Suggest or implement fixes',
                '',
                'If $ARGUMENTS is provided, run: `pytest -v $ARGUMENTS`',
            ].join('\n')]);
        }

        // Type check command
        if (toolNames.includes('TypeScript')) {
            commands.push(['typecheck', [
                '---',
                'description: Run TypeScript type checking',
                '---',
                '',
                'Run `npx tsc --noEmit` and fix any type errors.',
                '',
                'For each error:',
                '1. Explain the type issue',
                '2. Fix it in the source code',
                '3. Re-run to verify the fix',
            ].join('\n')]);
        }

        // Docker build command
        if (toolNames.includes('Docker')) {
            commands.push(['build', [
                '---',
                'description: Build the Docker image',
                '---',
                '',
                'Build the Docker image for this project.',
                '',
                '1. Run `docker build -t ${info.name} .`',
                '2. Report any build errors',
                '3. If successful, show the image size',
            ].join('\n')]);
        }

        return commands;
    }

    private buildSummary(info: ProjectInfo, filesCreated: string[], needsInit: boolean): string {
        const parts: string[] = [];

        if (filesCreated.length > 0) {
            parts.push(`Created ${filesCreated.length} file(s) for ${info.name} (${info.type}):`);
            for (const f of filesCreated) {
                parts.push(`  - ${path.basename(f)}`);
            }
        } else {
            parts.push('Configuration already exists. No files were created.');
        }

        if (info.tools.length > 0) {
            parts.push(`\nDetected: ${info.tools.map(t => t.name).join(', ')}`);
        }

        if (needsInit) {
            parts.push('\nNo CLAUDE.md found — claude init will run next to create one.');
        }

        parts.push('\nYou can customize these files or use "Generate with Claude" for more advanced config.');

        return parts.join('\n');
    }
}
