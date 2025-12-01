/**
 * ChatPanel - Embedded chat interface for Natural Language Setup
 *
 * Replaces floating input boxes with a persistent sidebar chat panel
 * Now includes plugin suggestions alongside config suggestions
 */

import * as vscode from 'vscode';
import { ClaudeAnalyzer } from '../../services/ClaudeAnalyzer';
import { ClaudeConfigService } from '../../services/ClaudeConfigService';
import { PluginService, PluginInfo } from '../../services/PluginService';
import type { ConfigSuggestion } from '../../services/ProjectAnalyzer';

// Plugin suggestion type
interface PluginSuggestion {
    plugin: PluginInfo;
    marketplace: string;
    reason: string;
}

export class ChatPanel implements vscode.WebviewViewProvider {
    public static readonly viewType = 'thinkube.chatPanel';
    private _view?: vscode.WebviewView;
    private pluginService: PluginService;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private configService: ClaudeConfigService
    ) {
        // Initialize plugin service
        this.pluginService = new PluginService((configService as any).basePath || '/home/thinkube');
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        console.log('[ChatPanel] resolveWebviewView called');
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        const html = this._getHtmlForWebview(webviewView.webview);
        console.log('[ChatPanel] HTML generated, length:', html.length);
        webviewView.webview.html = html;
        console.log('[ChatPanel] HTML set on webview');

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'askClaude':
                    await this.handleUserQuery(data.message);
                    break;
                case 'applySuggestion':
                    await this.applySuggestion(data.suggestion);
                    break;
                case 'installPlugin':
                    await this.installPlugin(data.plugin, data.marketplace);
                    break;
            }
        });
    }

    private async handleUserQuery(userMessage: string) {
        // Show user message in chat
        this._view?.webview.postMessage({
            type: 'userMessage',
            message: userMessage
        });

        // Show thinking indicator
        this._view?.webview.postMessage({
            type: 'thinking',
            show: true
        });

        try {
            // Get the current project path from the configService
            // This respects the scope selection (global vs project-specific)
            const projectPath = (this.configService as any).basePath || '/home/thinkube';

            // Get plugin suggestions based on project analysis
            const pluginSuggestions = await this.pluginService.suggestPlugins(projectPath);

            // Ask Claude via Agent SDK for config suggestions
            const analyzer = new ClaudeAnalyzer();
            const result = await analyzer.analyzeProject(projectPath);

            // Hide thinking indicator
            this._view?.webview.postMessage({
                type: 'thinking',
                show: false
            });

            // Show Claude's response with both plugin and config suggestions
            this._view?.webview.postMessage({
                type: 'claudeResponse',
                summary: result.summary,
                suggestions: result.suggestions,
                pluginSuggestions: pluginSuggestions
            });

        } catch (error) {
            this._view?.webview.postMessage({
                type: 'thinking',
                show: false
            });

            this._view?.webview.postMessage({
                type: 'error',
                message: error instanceof Error ? error.message : 'Unknown error occurred'
            });
        }
    }

    /**
     * Install a plugin from the marketplace
     */
    private async installPlugin(pluginName: string, marketplaceName: string) {
        try {
            await this.pluginService.installPlugin(pluginName, marketplaceName);

            this._view?.webview.postMessage({
                type: 'pluginInstalled',
                plugin: pluginName
            });

            vscode.window.showInformationMessage(`Plugin ${pluginName} installed successfully!`);
        } catch (error) {
            this._view?.webview.postMessage({
                type: 'error',
                message: `Failed to install plugin: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
        }
    }

    private async applySuggestion(suggestion: ConfigSuggestion) {
        try {
            const config = suggestion.config as any;
            let filePath: string | undefined;

            switch (suggestion.type) {
                case 'hook':
                    await this.configService.addHook(
                        config.event,
                        { matcher: config.matcher, command: config.command }
                    );
                    // For hooks, open settings.json
                    const hookConfig = await this.configService.getConfig('project');
                    filePath = hookConfig.settingsPath;
                    break;
                case 'command':
                    const command = await this.configService.createCommand(
                        config.name,
                        config.description,
                        config.content
                    );
                    filePath = command.filePath;
                    break;
                case 'skill':
                    const skill = await this.configService.createSkill(
                        config.name,
                        config.description,
                        config.content
                    );
                    filePath = skill.filePath;
                    break;
                case 'agent':
                    const agent = await this.configService.createAgent(
                        config.name,
                        config.description,
                        config.content,
                        config.tools,
                        config.model
                    );
                    filePath = agent.filePath;
                    break;
                case 'mcp-server':
                    await this.configService.addMcpServer(
                        config.id,
                        {
                            command: config.command,
                            args: config.args,
                            env: config.env
                        }
                    );
                    // For MCP servers, open settings.json
                    const mcpConfig = await this.configService.getConfig('project');
                    filePath = mcpConfig.settingsPath;
                    break;
            }

            // Open the created/modified file in editor
            if (filePath) {
                const uri = vscode.Uri.file(filePath);
                await vscode.window.showTextDocument(uri, { preview: false });
            }

            // Notify success and remove from list
            this._view?.webview.postMessage({
                type: 'suggestionApplied',
                suggestion: suggestion.name
            });

        } catch (error) {
            this._view?.webview.postMessage({
                type: 'error',
                message: `Failed to apply: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Generate nonce for CSP
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Claude Assistant</title>
    <style>
        body {
            padding: 0;
            margin: 0;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
        }

        #chat-container {
            display: flex;
            flex-direction: column;
            height: 100vh;
        }

        #messages {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
        }

        .message {
            margin-bottom: 16px;
            padding: 8px 12px;
            border-radius: 4px;
        }

        .user-message {
            background: var(--vscode-input-background);
            border-left: 3px solid var(--vscode-inputOption-activeBorder);
        }

        .claude-message {
            background: var(--vscode-textBlockQuote-background);
            border-left: 3px solid var(--vscode-textLink-foreground);
        }

        .suggestion {
            margin: 8px 0;
            padding: 8px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 4px;
            border: 1px solid var(--vscode-panel-border);
        }

        .suggestion-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 4px;
        }

        .suggestion-type {
            font-size: 0.9em;
            opacity: 0.8;
            text-transform: uppercase;
        }

        button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 12px;
            cursor: pointer;
            border-radius: 2px;
            font-size: 0.9em;
        }

        button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        #input-container {
            padding: 12px;
            background: var(--vscode-sideBar-background);
            border-top: 1px solid var(--vscode-panel-border);
        }

        #user-input {
            width: 100%;
            padding: 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-family: inherit;
            font-size: inherit;
            resize: vertical;
            min-height: 60px;
        }

        #user-input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }

        #send-button {
            margin-top: 8px;
            width: 100%;
            padding: 8px;
        }

        .thinking {
            padding: 8px 12px;
            font-style: italic;
            opacity: 0.7;
        }

        .error {
            padding: 8px 12px;
            background: var(--vscode-inputValidation-errorBackground);
            border-left: 3px solid var(--vscode-inputValidation-errorBorder);
            border-radius: 4px;
            margin: 8px 0;
        }
    </style>
</head>
<body>
    <div id="chat-container">
        <div id="messages">
            <div class="message claude-message">
                <strong>Claude Assistant</strong>
                <p>Hello! I can help you configure Claude Code for your project. Describe what you want to set up, and I'll analyze your codebase to suggest the right hooks, commands, skills, subagents, and MCP servers.</p>
                <p style="font-size: 0.9em; opacity: 0.8;">Example: "Set up code quality checks and testing workflows"</p>
            </div>
        </div>
        <div id="input-container">
            <textarea id="user-input" placeholder="Describe what you want Claude to do..."></textarea>
            <button id="send-button">Ask Claude</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const messagesDiv = document.getElementById('messages');
        const userInput = document.getElementById('user-input');
        const sendButton = document.getElementById('send-button');

        sendButton.addEventListener('click', sendMessage);
        userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                sendMessage();
            }
        });

        function sendMessage() {
            const message = userInput.value.trim();
            if (!message) return;

            vscode.postMessage({
                type: 'askClaude',
                message: message
            });

            userInput.value = '';
        }

        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
                case 'userMessage':
                    addUserMessage(message.message);
                    break;
                case 'thinking':
                    if (message.show) {
                        addThinking();
                    } else {
                        removeThinking();
                    }
                    break;
                case 'claudeResponse':
                    addClaudeResponse(message.summary, message.suggestions, message.pluginSuggestions);
                    break;
                case 'error':
                    addError(message.message);
                    break;
                case 'suggestionApplied':
                    removeSuggestion(message.suggestion);
                    showSuccess(\`Applied: \${message.suggestion}\`);
                    break;
                case 'pluginInstalled':
                    removePluginSuggestion(message.plugin);
                    showSuccess(\`Installed plugin: \${message.plugin}\`);
                    break;
            }
        });

        function removePluginSuggestion(pluginName) {
            // Find and remove the plugin suggestion from the DOM
            const plugins = window.currentPluginSuggestions || [];
            const index = plugins.findIndex(p => p.plugin.name === pluginName);
            if (index >= 0) {
                const elem = document.getElementById(\`plugin-\${index}\`);
                if (elem) {
                    elem.remove();
                }
            }
        }

        function addUserMessage(text) {
            const div = document.createElement('div');
            div.className = 'message user-message';
            div.innerHTML = \`<strong>You:</strong><p>\${escapeHtml(text)}</p>\`;
            messagesDiv.appendChild(div);
            scrollToBottom();
        }

        function addThinking() {
            const div = document.createElement('div');
            div.className = 'thinking';
            div.id = 'thinking-indicator';
            div.textContent = 'Claude is analyzing your project...';
            messagesDiv.appendChild(div);
            scrollToBottom();
        }

        function removeThinking() {
            const thinking = document.getElementById('thinking-indicator');
            if (thinking) {
                thinking.remove();
            }
        }

        function addClaudeResponse(summary, suggestions, pluginSuggestions) {
            const div = document.createElement('div');
            div.className = 'message claude-message';
            div.id = 'suggestions-container';

            let html = \`<strong>Claude:</strong><p>\${escapeHtml(summary)}</p>\`;

            // Plugin suggestions section (shown first)
            if (pluginSuggestions && pluginSuggestions.length > 0) {
                html += '<div style="margin-top: 12px; margin-bottom: 16px; padding: 8px; background: var(--vscode-badge-background); border-radius: 4px;">';
                html += '<strong style="color: var(--vscode-badge-foreground);">Recommended Plugins:</strong>';
                html += '<div style="margin-top: 8px;">';
                pluginSuggestions.forEach((plugSug, index) => {
                    html += \`
                        <div class="suggestion" id="plugin-\${index}" style="background: var(--vscode-editor-background);">
                            <div class="suggestion-header">
                                <span><strong>\${escapeHtml(plugSug.plugin.name)}</strong></span>
                                <button onclick="installPlugin('\${escapeHtml(plugSug.plugin.name)}', '\${escapeHtml(plugSug.marketplace)}')">Install</button>
                            </div>
                            <p style="margin: 4px 0; font-size: 0.9em;">\${escapeHtml(plugSug.plugin.description || '')}</p>
                            <p style="margin: 4px 0; font-size: 0.85em; opacity: 0.7;">\${escapeHtml(plugSug.reason)}</p>
                        </div>
                    \`;
                });
                html += '</div></div>';
            }

            // Config suggestions section
            if (suggestions && suggestions.length > 0) {
                html += '<div style="margin-top: 12px;">';
                html += '<strong>Configuration Suggestions:</strong>';
                html += '<button id="apply-all-btn" onclick="applyAll()" style="width: 100%; margin: 8px 0;">Apply All Config Suggestions</button>';
                html += '<div id="suggestions-list">';
                suggestions.forEach((sug, index) => {
                    html += \`
                        <div class="suggestion" id="suggestion-\${index}">
                            <div class="suggestion-header">
                                <span><strong>\${escapeHtml(sug.name)}</strong> <span class="suggestion-type">(\${sug.type})</span></span>
                                <button onclick="applySuggestion(\${index})">Apply</button>
                            </div>
                            <p style="margin: 4px 0; font-size: 0.9em;">\${escapeHtml(sug.description)}</p>
                            <p style="margin: 4px 0; font-size: 0.85em; opacity: 0.7;">\${escapeHtml(sug.reason)}</p>
                        </div>
                    \`;
                });
                html += '</div></div>';
            }

            div.innerHTML = html;
            messagesDiv.appendChild(div);

            // Store suggestions for apply buttons
            window.currentSuggestions = suggestions || [];
            window.currentPluginSuggestions = pluginSuggestions || [];
            window.appliedCount = 0;

            scrollToBottom();
        }

        function installPlugin(pluginName, marketplace) {
            vscode.postMessage({
                type: 'installPlugin',
                plugin: pluginName,
                marketplace: marketplace
            });
        }

        function applySuggestion(index) {
            const suggestion = window.currentSuggestions[index];
            vscode.postMessage({
                type: 'applySuggestion',
                suggestion: suggestion
            });
        }

        function addError(text) {
            const div = document.createElement('div');
            div.className = 'error';
            div.innerHTML = \`<strong>Error:</strong> \${escapeHtml(text)}\`;
            messagesDiv.appendChild(div);
            scrollToBottom();
        }

        function showSuccess(text) {
            const div = document.createElement('div');
            div.className = 'message claude-message';
            div.innerHTML = \`<p>✓ \${escapeHtml(text)}</p>\`;
            messagesDiv.appendChild(div);
            scrollToBottom();
        }

        function scrollToBottom() {
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function removeSuggestion(suggestionName) {
            // Find and remove the suggestion from the DOM
            const suggestions = window.currentSuggestions;
            const index = suggestions.findIndex(s => s.name === suggestionName);
            if (index >= 0) {
                const elem = document.getElementById(\`suggestion-\${index}\`);
                if (elem) {
                    elem.remove();
                }
                window.appliedCount++;

                // Hide Apply All button if all suggestions are applied
                const remainingCount = suggestions.length - window.appliedCount;
                if (remainingCount === 0) {
                    const applyAllBtn = document.getElementById('apply-all-btn');
                    if (applyAllBtn) {
                        applyAllBtn.style.display = 'none';
                    }
                }
            }
        }

        function applyAll() {
            const suggestions = window.currentSuggestions;
            if (!suggestions) return;

            // Apply all suggestions sequentially
            suggestions.forEach((suggestion, index) => {
                const elem = document.getElementById(\`suggestion-\${index}\`);
                if (elem && elem.style.display !== 'none') {
                    applySuggestion(index);
                }
            });
        }
    </script>
</body>
</html>`;
    }

    public updateConfigService(newService: ClaudeConfigService) {
        this.configService = newService;
        // Update plugin service with new base path
        this.pluginService.setBasePath((newService as any).basePath || '/home/thinkube');
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
