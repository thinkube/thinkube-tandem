/**
 * ChatPanel - Quick Actions panel for Claude Code configuration
 *
 * Replaces the old chat interface with targeted action buttons that launch
 * Claude CLI with contextual, pre-filled prompts. The user provides their
 * intent, and Claude generates the config in an interactive terminal session.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ClaudeConfigService } from '../../services/ClaudeConfigService';
import { ClaudeLauncher, GenerateTarget } from '../../services/ClaudeLauncher';
import { ProjectAnalyzer } from '../../services/ProjectAnalyzer';
import { HOOK_EVENTS, HookEvent } from '../../models/Hook';

export class ChatPanel implements vscode.WebviewViewProvider {
    public static readonly viewType = 'thinkube.chatPanel';
    private _view?: vscode.WebviewView;
    private launcher: ClaudeLauncher;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private configService: ClaudeConfigService
    ) {
        this.launcher = new ClaudeLauncher();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        this.updateContent();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'generate':
                    await this.handleGenerate(data.target);
                    break;
                case 'generateHook':
                    await this.handleGenerate({ kind: 'hook', event: data.event });
                    break;
                case 'fullSetup':
                    await this.handleFullSetup();
                    break;
                case 'openFile':
                    await this.openConfigFile(data.filePath);
                    break;
                case 'switchProject':
                    await vscode.commands.executeCommand('thinkube.switchProject');
                    break;
                case 'refresh':
                    await this.updateContent();
                    break;
            }
        });
    }

    private async handleGenerate(target: GenerateTarget) {
        const projectPath = this.configService.basePath;
        try {
            await this.launcher.launch(projectPath, target);
            // Show a message to refresh tree after terminal closes
            const action = await vscode.window.showInformationMessage(
                'Claude is generating config in the terminal. Refresh the tree when done.',
                'Refresh Tree'
            );
            if (action === 'Refresh Tree') {
                vscode.commands.executeCommand('thinkube.refreshConfig');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to launch Claude: ${error}`);
        }
    }

    private async handleFullSetup() {
        const projectPath = this.configService.basePath;
        try {
            await this.launcher.launchFullSetup(projectPath);
            const action = await vscode.window.showInformationMessage(
                'Claude is setting up your project config. Refresh the tree when done.',
                'Refresh Tree'
            );
            if (action === 'Refresh Tree') {
                vscode.commands.executeCommand('thinkube.refreshConfig');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to launch Claude: ${error}`);
        }
    }

    private async openConfigFile(filePath: string) {
        try {
            const uri = vscode.Uri.file(filePath);
            await vscode.window.showTextDocument(uri, { preview: false });
        } catch {
            vscode.window.showErrorMessage(`File not found: ${filePath}`);
        }
    }

    private async updateContent() {
        if (!this._view) return;

        const projectPath = this.configService.basePath;
        const projectName = path.basename(projectPath);

        // Detect project info for contextual display
        let projectType = 'unknown';
        let detectedTools: string[] = [];
        try {
            const analyzer = new ProjectAnalyzer(projectPath);
            const info = await analyzer.analyze();
            projectType = info.type;
            detectedTools = info.tools.map(t => t.name);
        } catch {
            // ignore detection errors
        }

        this._view.webview.html = this.getHtml(projectName, projectPath, projectType, detectedTools);
    }

    private getHtml(projectName: string, projectPath: string, projectType: string, tools: string[]): string {
        const toolsBadges = tools.length > 0
            ? tools.map(t => `<span class="badge">${this.escapeHtml(t)}</span>`).join(' ')
            : '<span class="muted">No tools detected</span>';

        // Determine which workspace section this project belongs to
        let sectionLabel = '';
        if (projectPath.startsWith('/home/thinkube/thinkube-platform')) {
            sectionLabel = 'Platform';
        } else if (projectPath.startsWith('/home/thinkube/apps')) {
            sectionLabel = 'Apps';
        } else if (projectPath.startsWith('/home/thinkube/user-templates')) {
            sectionLabel = 'Templates';
        }
        const sectionPrefix = sectionLabel ? `${sectionLabel} / ` : '';

        const settingsPath = path.join(projectPath, '.claude', 'settings.json');
        const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
        const mcpJsonPath = path.join(projectPath, '.mcp.json');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            padding: 0;
            margin: 0;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
        }
        .panel {
            padding: 12px;
        }
        .project-header {
            margin-bottom: 16px;
            padding: 8px 12px;
            background: var(--vscode-textBlockQuote-background);
            border-left: 3px solid var(--vscode-textLink-foreground);
            border-radius: 4px;
        }
        .project-section {
            font-size: 0.8em;
            opacity: 0.6;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .project-name {
            font-weight: bold;
            font-size: 1.1em;
        }
        .project-type {
            opacity: 0.7;
            font-size: 0.9em;
        }
        .switch-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 4px 8px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 0.9em;
        }
        .switch-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .tools-row {
            margin-top: 6px;
        }
        .badge {
            display: inline-block;
            padding: 1px 6px;
            margin: 2px 2px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 3px;
            font-size: 0.85em;
        }
        .muted {
            opacity: 0.5;
            font-size: 0.9em;
        }

        .section {
            margin-bottom: 16px;
        }
        .section-title {
            font-weight: bold;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .section-title .icon {
            opacity: 0.7;
        }

        .action-btn {
            display: block;
            width: 100%;
            padding: 8px 12px;
            margin: 4px 0;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: inherit;
            font-family: inherit;
            text-align: left;
        }
        .action-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .action-btn.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .action-btn.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .action-btn.primary-large {
            padding: 10px 12px;
            text-align: center;
            font-weight: bold;
        }
        .action-btn .btn-desc {
            display: block;
            font-size: 0.85em;
            opacity: 0.8;
            margin-top: 2px;
        }

        .hook-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 4px;
        }
        .hook-btn {
            padding: 6px 8px;
            font-size: 0.9em;
            text-align: center;
        }

        .file-links {
            margin-top: 8px;
        }
        .file-link {
            display: inline-block;
            padding: 2px 8px;
            margin: 2px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 3px;
            cursor: pointer;
            font-size: 0.85em;
            border: 1px solid var(--vscode-panel-border);
        }
        .file-link:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .divider {
            border: none;
            border-top: 1px solid var(--vscode-panel-border);
            margin: 12px 0;
        }
    </style>
</head>
<body>
    <div class="panel">
        <div class="project-header">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div class="project-section">${this.escapeHtml(sectionPrefix)}</div>
                    <div class="project-name">${this.escapeHtml(projectName)}</div>
                </div>
                <button class="switch-btn" onclick="switchProject()" title="Switch active project">$(folder)</button>
            </div>
            <div class="project-type">${this.escapeHtml(projectType)}</div>
            <div class="tools-row">${toolsBadges}</div>
        </div>

        <!-- Full Setup -->
        <div class="section">
            <button class="action-btn primary-large" onclick="fullSetup()">
                Set Up Project with Claude
                <span class="btn-desc">Generate CLAUDE.md, hooks, commands, and permissions</span>
            </button>
        </div>

        <hr class="divider">

        <!-- Generate by section -->
        <div class="section">
            <div class="section-title"><span class="icon">&#9889;</span> Generate Hooks</div>
            <div class="hook-grid">
                ${HOOK_EVENTS.map(event => `
                    <button class="action-btn secondary hook-btn" onclick="generateHook('${event}')" title="${this.escapeHtml(this.getHookTooltip(event))}">
                        ${event}
                    </button>
                `).join('')}
            </div>
        </div>

        <div class="section">
            <div class="section-title"><span class="icon">&#62;&gt;</span> Generate</div>
            <button class="action-btn secondary" onclick="generate('command')">
                Slash Command
                <span class="btn-desc">User-invoked workflow (e.g., /test, /review)</span>
            </button>
            <button class="action-btn secondary" onclick="generate('skill')">
                Skill
                <span class="btn-desc">Reusable knowledge or behavior pattern</span>
            </button>
            <button class="action-btn secondary" onclick="generate('agent')">
                Subagent
                <span class="btn-desc">Isolated task with its own context</span>
            </button>
            <button class="action-btn secondary" onclick="generate('mcp-server')">
                MCP Server
                <span class="btn-desc">External tool integration</span>
            </button>
        </div>

        <hr class="divider">

        <!-- Quick file access -->
        <div class="section">
            <div class="section-title"><span class="icon">&#128196;</span> Config Files</div>
            <div class="file-links">
                <span class="file-link" onclick="openFile('${this.escapeJs(claudeMdPath)}')">CLAUDE.md</span>
                <span class="file-link" onclick="openFile('${this.escapeJs(settingsPath)}')">settings.json</span>
                <span class="file-link" onclick="openFile('${this.escapeJs(mcpJsonPath)}')">.mcp.json</span>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function fullSetup() {
            vscode.postMessage({ type: 'fullSetup' });
        }

        function generate(kind) {
            vscode.postMessage({ type: 'generate', target: { kind: kind } });
        }

        function generateHook(event) {
            vscode.postMessage({ type: 'generateHook', event: event });
        }

        function openFile(filePath) {
            vscode.postMessage({ type: 'openFile', filePath: filePath });
        }

        function switchProject() {
            vscode.postMessage({ type: 'switchProject' });
        }
    </script>
</body>
</html>`;
    }

    private getHookTooltip(event: string): string {
        const descriptions: Record<string, string> = {
            PreToolUse: 'Before tool execution - validate, block',
            PostToolUse: 'After tool execution - format, lint, test',
            SessionStart: 'Session begins - env check, status',
            SessionEnd: 'Session ends - cleanup, summary',
            Stop: 'Response complete - validate output',
            StopFailure: 'Error stop - logging, alerts',
            UserPromptSubmit: 'Prompt submitted - enrich, route',
            PermissionRequest: 'Permission asked - auto-approve, log',
            PermissionDenied: 'Permission denied - log, suggest',
            CwdChanged: 'Directory changed - reload context',
            FileChanged: 'File modified - rebuild, reindex',
            WorktreeCreate: 'Worktree created - setup deps',
        };
        return descriptions[event] || event;
    }

    private escapeHtml(text: string): string {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    private escapeJs(text: string): string {
        return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    public updateConfigService(newService: ClaudeConfigService) {
        this.configService = newService;
        this.updateContent();
    }
}
