import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as appCommands from './commands/app';
import { ClaudeConfigService } from './services/ClaudeConfigService';
import { PluginService, PluginInfo } from './services/PluginService';
import { ProjectAnalyzer, ConfigSuggestion } from './services/ProjectAnalyzer';
import { ConfigTreeProvider, ConfigTreeItem } from './views/sidebar/ConfigTreeProvider';
import { ChatPanel } from './views/sidebar/ChatPanel';
import { PluginCreationWizard, quickCreatePlugin } from './views/wizards/PluginCreationWizard';
import { Command } from './models/Command';
import { Skill } from './models/Skill';
import { Agent } from './models/Agent';

interface ClaudeConfig {
    directories: string[];
}

// Global instances
let configService: ClaudeConfigService | undefined;
let treeProvider: ConfigTreeProvider | undefined;
let chatPanel: ChatPanel | undefined;
let currentActiveContext: string | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Get the active project path based on current editor or workspace
 */
function getActiveProjectPath(): string | undefined {
    // 1. Try to get from active editor
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const filePath = editor.document.uri.fsPath;
        const projectRoot = findProjectRoot(filePath);
        if (projectRoot) {
            return projectRoot;
        }

        // If no project root found, use the workspace folder containing this file
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        if (workspaceFolder) {
            return workspaceFolder.uri.fsPath;
        }
    }

    // 2. Fall back to first workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        return workspaceFolders[0].uri.fsPath;
    }

    return undefined;
}

/**
 * Find the project root by searching upward for markers
 */
function findProjectRoot(startPath: string): string | undefined {
    let current = fs.statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);
    const workspaceFolders = vscode.workspace.workspaceFolders;

    // Don't search above workspace folders
    const workspacePaths = workspaceFolders?.map(f => f.uri.fsPath) || [];

    while (current !== path.dirname(current)) {
        // Check for project markers
        if (fs.existsSync(path.join(current, '.git')) ||
            fs.existsSync(path.join(current, 'package.json')) ||
            fs.existsSync(path.join(current, 'pyproject.toml')) ||
            fs.existsSync(path.join(current, 'Cargo.toml')) ||
            fs.existsSync(path.join(current, 'go.mod'))) {
            return current;
        }

        // Stop at workspace folder boundaries
        if (workspacePaths.includes(current)) {
            return current;
        }

        current = path.dirname(current);
    }

    return undefined;
}

/**
 * Update config service to point to the active project
 */
async function updateActiveContext(): Promise<void> {
    const activePath = getActiveProjectPath();

    // Only update if context changed
    if (activePath === currentActiveContext) {
        return;
    }

    currentActiveContext = activePath;

    if (activePath) {
        configService = new ClaudeConfigService(activePath);
        if (treeProvider) {
            treeProvider.setConfigService(configService);
        }
        if (chatPanel) {
            chatPanel.updateConfigService(configService);
        }

        await updateConfigContext();

        // Update status bar to show active context
        const contextName = path.basename(activePath);
        if (statusBarItem) {
            statusBarItem.text = `$(folder) ${contextName}`;
            statusBarItem.tooltip = `Claude Code context: ${activePath}`;
            statusBarItem.show();
        }

        vscode.commands.executeCommand('setContext', 'thinkube.activeContext', contextName);
    }
}

/**
 * Update the context variable for whether .claude config exists
 */
async function updateConfigContext(): Promise<void> {
    if (configService) {
        const hasConfig = await configService.hasClaudeConfig();
        await vscode.commands.executeCommand('setContext', 'thinkube.hasClaudeConfig', hasConfig);
    } else {
        await vscode.commands.executeCommand('setContext', 'thinkube.hasClaudeConfig', false);
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Thinkube AI Integration is now active!');

    // Create status bar item to show active context
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'thinkube.refreshConfig';
    context.subscriptions.push(statusBarItem);

    // Initialize ClaudeConfigService with workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        const initialPath = workspaceFolders[0].uri.fsPath;
        configService = new ClaudeConfigService(initialPath);
        treeProvider = new ConfigTreeProvider(configService);

        // Register tree view
        const treeView = vscode.window.createTreeView('claudeConfigTree', {
            treeDataProvider: treeProvider,
            showCollapseAll: true
        });
        context.subscriptions.push(treeView);

        // Register chat panel
        console.log('[Extension] Registering ChatPanel with viewType:', ChatPanel.viewType);
        chatPanel = new ChatPanel(context.extensionUri, configService);
        const chatPanelProvider = vscode.window.registerWebviewViewProvider(
            ChatPanel.viewType,
            chatPanel
        );
        context.subscriptions.push(chatPanelProvider);
        console.log('[Extension] ChatPanel registered successfully');

        // Update context and refresh when config changes
        configService.onConfigChanged(() => {
            updateConfigContext();
        });

        // Initial context update
        updateActiveContext();

        // Update context when active editor changes
        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(() => {
                updateActiveContext();
            })
        );

        // Update context when workspace folders change
        context.subscriptions.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                updateActiveContext();
            })
        );
    } else {
        // No workspace - set context to false
        vscode.commands.executeCommand('setContext', 'thinkube.hasClaudeConfig', false);
    }

    // Register Claude Config sidebar commands
    registerConfigCommands(context);

    // Register existing Claude commands
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-ai.claude.openHere', (uri?: vscode.Uri) => {
            launchClaude(uri, false);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-ai.claude.continueHere', (uri?: vscode.Uri) => {
            launchClaude(uri, true);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-ai.claude.addDirectory', async () => {
            await addReferenceDirectory();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-ai.claude.configureProject', async () => {
            await configureProject();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-ai.claude.showConfiguration', async () => {
            await showCurrentConfiguration();
        })
    );

    // Register new app development commands
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-ai.app.createFromTemplate', appCommands.createFromTemplate)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-ai.app.addService', appCommands.addService)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-ai.app.generateComponent', appCommands.generateComponent)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-ai.app.generateAPI', appCommands.generateAPI)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-ai.deploy.preview', appCommands.deployPreview)
    );
}

function getTargetDirectory(uri?: vscode.Uri): string | undefined {
    if (uri && uri.fsPath) {
        return uri.fsPath;
    }

    const editor = vscode.window.activeTextEditor;
    if (editor) {
        return path.dirname(editor.document.uri.fsPath);
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        return workspaceFolders[0].uri.fsPath;
    }

    return undefined;
}

function findThinkubeConfig(startPath: string): string | null {
    let currentPath = startPath;
    while (currentPath !== path.dirname(currentPath)) {
        const configPath = path.join(currentPath, '.thinkube');
        if (fs.existsSync(configPath)) {
            return configPath;
        }
        currentPath = path.dirname(currentPath);
    }
    return null;
}

function loadClaudeConfig(projectPath: string): ClaudeConfig {
    const configDir = findThinkubeConfig(projectPath) || path.join(projectPath, '.thinkube');
    const configFile = path.join(configDir, 'claude-config');
    
    const config: ClaudeConfig = { directories: [] };
    
    if (!fs.existsSync(configFile)) {
        return config;
    }
    
    try {
        const content = fs.readFileSync(configFile, 'utf8');
        content.split('\n').forEach(line => {
            const match = line.match(/^add-dir:\s*(.+)$/);
            if (match) {
                config.directories.push(match[1].trim());
            }
        });
    } catch (error) {
        console.error('Error reading claude-config:', error);
    }
    
    return config;
}

function saveClaudeConfig(projectPath: string, config: ClaudeConfig): void {
    const configDir = findThinkubeConfig(projectPath) || path.join(projectPath, '.thinkube');
    
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    
    const configFile = path.join(configDir, 'claude-config');
    const content = [
        '# Thinkube Claude Code Configuration',
        '# Directories added here will be available to Claude for reference',
        '# Use ~ for home directory, relative paths are resolved from project root',
        '',
        ...config.directories.map(dir => `add-dir: ${dir}`)
    ].join('\n') + '\n';
    
    fs.writeFileSync(configFile, content, 'utf8');
}

function buildClaudeCommand(projectPath: string, continueSession: boolean): string {
    const config = loadClaudeConfig(projectPath);
    let cmd = 'claude';
    
    // Add configured directories
    config.directories.forEach(dir => {
        // Expand ~ to home directory
        if (dir.startsWith('~')) {
            dir = dir.replace('~', process.env.HOME || '');
        }
        
        // Make relative paths absolute
        const fullPath = path.isAbsolute(dir) ? dir : path.resolve(projectPath, dir);
        
        if (fs.existsSync(fullPath)) {
            cmd += ` --add-dir "${fullPath}"`;
        } else {
            console.warn(`Directory not found: ${fullPath}`);
        }
    });
    
    if (continueSession) {
        cmd += ' --continue';
    }
    
    return cmd;
}

function launchClaude(uri: vscode.Uri | undefined, continueSession: boolean): void {
    const folderPath = getTargetDirectory(uri);
    
    if (!folderPath) {
        vscode.window.showErrorMessage('No folder selected');
        return;
    }
    
    const terminalName = continueSession 
        ? `Claude Continue: ${path.basename(folderPath)}`
        : `Claude Code: ${path.basename(folderPath)}`;
    
    const terminal = vscode.window.createTerminal({
        name: terminalName,
        cwd: folderPath
    });
    
    terminal.show();
    
    const command = buildClaudeCommand(folderPath, continueSession);
    terminal.sendText(command);
    
    // Show what directories are being added
    const config = loadClaudeConfig(folderPath);
    if (config.directories.length > 0 && vscode.workspace.getConfiguration('thinkube-ai').get('claude.showNotifications', true)) {
        vscode.window.showInformationMessage(
            `Claude launched with ${config.directories.length} reference director${config.directories.length === 1 ? 'y' : 'ies'}`
        );
    }
}

async function addReferenceDirectory(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
    }
    
    const projectPath = workspaceFolders[0].uri.fsPath;
    
    const selectedUri = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Add Reference Directory',
        title: 'Select directory to add as Claude reference'
    });
    
    if (selectedUri && selectedUri[0]) {
        const config = loadClaudeConfig(projectPath);
        const newDir = selectedUri[0].fsPath;
        
        // Check if already exists
        if (!config.directories.includes(newDir)) {
            config.directories.push(newDir);
            saveClaudeConfig(projectPath, config);
            
            const showNotifications = vscode.workspace.getConfiguration('thinkube-ai').get('claude.showNotifications', true);
            if (showNotifications) {
                vscode.window.showInformationMessage(`Added reference directory: ${newDir}`);
            }
        } else {
            vscode.window.showInformationMessage('Directory already in configuration');
        }
    }
}

async function configureProject(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
    }
    
    const projectPath = workspaceFolders[0].uri.fsPath;
    const config = loadClaudeConfig(projectPath);
    
    if (config.directories.length === 0) {
        vscode.window.showInformationMessage('No reference directories configured. Use "Add Reference Directory" to add some.');
        return;
    }
    
    const quickPick = vscode.window.createQuickPick();
    quickPick.title = 'Claude Code Reference Directories';
    quickPick.placeholder = 'Select directories to remove or press ESC to close';
    quickPick.canSelectMany = true;
    quickPick.items = config.directories.map(dir => ({ 
        label: dir,
        description: fs.existsSync(dir) ? '' : '(not found)',
        picked: false 
    }));
    
    quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems.map(item => item.label);
        if (selected.length > 0) {
            config.directories = config.directories.filter(dir => !selected.includes(dir));
            saveClaudeConfig(projectPath, config);
            
            const showNotifications = vscode.workspace.getConfiguration('thinkube-ai').get('claude.showNotifications', true);
            if (showNotifications) {
                vscode.window.showInformationMessage(`Removed ${selected.length} director${selected.length === 1 ? 'y' : 'ies'}`);
            }
        }
        quickPick.dispose();
    });
    
    quickPick.show();
}

async function showCurrentConfiguration(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
    }
    
    const projectPath = workspaceFolders[0].uri.fsPath;
    const config = loadClaudeConfig(projectPath);
    
    if (config.directories.length === 0) {
        vscode.window.showInformationMessage('No reference directories configured.');
        return;
    }
    
    const message = config.directories.map((dir, index) => 
        `${index + 1}. ${dir}${fs.existsSync(dir) ? '' : ' (not found)'}`
    ).join('\n');
    
    vscode.window.showInformationMessage(`Claude Code Reference Directories:\n${message}`, { modal: true });
}

// Helper functions for smart setup

function getIconForType(type: string): string {
    switch (type) {
        case 'hook': return 'symbol-event';
        case 'command': return 'terminal';
        case 'skill': return 'mortar-board';
        case 'agent': return 'hubot';
        case 'mcp-server': return 'server';
        default: return 'gear';
    }
}

interface Template {
    name: string;
    description: string;
    icon: string;
    includes: string[];
    suggestions: ConfigSuggestion[];
}

function getTemplates(): Template[] {
    return [
        {
            name: 'Code Quality',
            description: 'Linting and formatting hooks',
            icon: 'check',
            includes: ['ESLint hook', 'Prettier hook'],
            suggestions: [
                {
                    type: 'hook',
                    name: 'Lint on Edit',
                    description: 'Run linter after edits',
                    reason: 'Code quality template',
                    config: {
                        event: 'PostToolUse',
                        matcher: 'Edit',
                        command: 'npm run lint -- --fix "$CLAUDE_FILE_PATH" 2>/dev/null || true'
                    }
                },
                {
                    type: 'hook',
                    name: 'Format on Edit',
                    description: 'Format code after edits',
                    reason: 'Code quality template',
                    config: {
                        event: 'PostToolUse',
                        matcher: 'Edit',
                        command: 'npx prettier --write "$CLAUDE_FILE_PATH" 2>/dev/null || true'
                    }
                }
            ]
        },
        {
            name: 'Testing Workflow',
            description: 'Commands for running and writing tests',
            icon: 'beaker',
            includes: ['Run tests command', 'Test writer skill'],
            suggestions: [
                {
                    type: 'command',
                    name: 'run-tests',
                    description: 'Run test suite',
                    reason: 'Testing template',
                    config: {
                        name: 'run-tests',
                        description: 'Run the test suite and analyze results',
                        content: 'Run the project tests and report any failures. Suggest fixes for failing tests.'
                    }
                },
                {
                    type: 'skill',
                    name: 'test-writer',
                    description: 'Generate tests for code',
                    reason: 'Testing template',
                    config: {
                        name: 'test-writer',
                        description: 'Writes comprehensive tests for code',
                        content: '# Test Writer Skill\n\nWhen writing tests:\n1. Cover happy path and edge cases\n2. Test error conditions\n3. Use descriptive test names\n4. Follow existing test patterns in the project'
                    }
                }
            ]
        },
        {
            name: 'Code Review',
            description: 'Skills and commands for code review',
            icon: 'eye',
            includes: ['Code reviewer skill', 'Security check command'],
            suggestions: [
                {
                    type: 'skill',
                    name: 'code-reviewer',
                    description: 'Review code for issues',
                    reason: 'Code review template',
                    config: {
                        name: 'code-reviewer',
                        description: 'Reviews code for bugs, security issues, and best practices',
                        content: '# Code Reviewer\n\nAnalyze code for:\n- Potential bugs\n- Security vulnerabilities\n- Performance issues\n- Code style and readability\n\nProvide specific, actionable feedback.'
                    }
                },
                {
                    type: 'command',
                    name: 'security-check',
                    description: 'Check for security issues',
                    reason: 'Code review template',
                    config: {
                        name: 'security-check',
                        description: 'Scan code for security vulnerabilities',
                        content: 'Review the codebase for security vulnerabilities including:\n- SQL injection\n- XSS\n- Authentication issues\n- Secrets in code\n- Insecure dependencies'
                    }
                }
            ]
        },
        {
            name: 'Documentation',
            description: 'Tools for writing documentation',
            icon: 'book',
            includes: ['Doc generator command', 'README updater'],
            suggestions: [
                {
                    type: 'command',
                    name: 'generate-docs',
                    description: 'Generate documentation',
                    reason: 'Documentation template',
                    config: {
                        name: 'generate-docs',
                        description: 'Generate documentation for code',
                        content: 'Generate or update documentation for the specified code. Include:\n- Function/class descriptions\n- Parameter documentation\n- Usage examples\n- Return value descriptions'
                    }
                },
                {
                    type: 'command',
                    name: 'update-readme',
                    description: 'Update project README',
                    reason: 'Documentation template',
                    config: {
                        name: 'update-readme',
                        description: 'Update the README based on current project state',
                        content: 'Review and update the README.md to reflect:\n- Current features\n- Installation steps\n- Usage examples\n- API documentation'
                    }
                }
            ]
        }
    ];
}

async function applySuggestion(service: ClaudeConfigService, suggestion: ConfigSuggestion): Promise<void> {
    const config = suggestion.config as unknown as Record<string, unknown>;

    switch (suggestion.type) {
        case 'hook':
            await service.addHook(
                config.event as 'PreToolUse' | 'PostToolUse',
                { matcher: config.matcher as string, command: config.command as string }
            );
            break;
        case 'command':
            await service.createCommand(
                config.name as string,
                config.description as string,
                config.content as string
            );
            break;
        case 'skill':
            await service.createSkill(
                config.name as string,
                config.description as string,
                config.content as string
            );
            break;
        case 'agent':
            await service.createAgent(
                config.name as string,
                config.description as string,
                config.content as string,
                config.tools as string[] | undefined,
                config.model as 'inherit' | 'haiku' | 'sonnet' | 'opus' | undefined
            );
            break;
        case 'mcp-server':
            await service.addMcpServer(
                config.id as string,
                {
                    command: config.command as string,
                    args: config.args as string[],
                    env: config.env as Record<string, string> | undefined
                }
            );
            break;
    }
}

function registerConfigCommands(context: vscode.ExtensionContext): void {
    // Refresh configuration
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.refreshConfig', async () => {
            await updateConfigContext();
            treeProvider?.refresh();
        })
    );

    // Switch Scope (Global vs Project)
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.switchScope', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                vscode.window.showErrorMessage('No workspace folder open');
                return;
            }

            const currentContext = currentActiveContext || workspaceFolders[0].uri.fsPath;
            const contextName = path.basename(currentContext);

            const choice = await vscode.window.showQuickPick([
                {
                    label: '$(home) Global Configuration',
                    description: '/home/thinkube/.claude/',
                    detail: 'Apply to all projects and apps',
                    path: '/home/thinkube'
                },
                {
                    label: `$(folder) Current Project (${contextName})`,
                    description: `${currentContext}/.claude/`,
                    detail: 'Only this project',
                    path: currentContext
                }
            ], {
                placeHolder: 'Switch to which configuration scope?',
                title: 'Switch Configuration Scope'
            });

            if (choice && choice.path !== currentContext) {
                // Switch to the chosen scope
                currentActiveContext = choice.path;
                configService = new ClaudeConfigService(choice.path);
                if (treeProvider) {
                    treeProvider.setConfigService(configService);
                }
                if (chatPanel) {
                    chatPanel.updateConfigService(configService);
                }
                await updateConfigContext();
                vscode.window.showInformationMessage(`Switched to ${choice.label}`);
            }
        })
    );

    // Switch Project - scan for actual projects with Claude config
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.switchProject', async (projectPath?: string) => {
            if (!projectPath) {
                // Helper to check if a directory is a git repo
                const isGitRepo = (dir: string): boolean => {
                    return fs.existsSync(path.join(dir, '.git'));
                };

                // Helper to check if a directory has Claude config
                const hasClaudeConfig = (dir: string): boolean => {
                    return fs.existsSync(path.join(dir, '.claude')) ||
                           fs.existsSync(path.join(dir, 'CLAUDE.md'));
                };

                // Collect git repos from a parent directory
                const getGitRepos = (parentDir: string, prefix: string): vscode.QuickPickItem[] => {
                    const items: vscode.QuickPickItem[] = [];
                    try {
                        const entries = fs.readdirSync(parentDir, { withFileTypes: true });
                        for (const entry of entries) {
                            if (entry.isDirectory() && !entry.name.startsWith('.')) {
                                const fullPath = path.join(parentDir, entry.name);
                                if (isGitRepo(fullPath)) {
                                    const configured = hasClaudeConfig(fullPath);
                                    items.push({
                                        label: `${prefix}: ${entry.name}`,
                                        description: configured ? '$(check)' : '(no config)',
                                        detail: fullPath,
                                    });
                                }
                            }
                        }
                    } catch (err) {
                        // Ignore read errors
                    }
                    return items;
                };

                // Get platform projects (inside thinkube-platform)
                const platformItems = getGitRepos('/home/thinkube/thinkube-platform', 'Platform');

                // Get app projects (direct children of /home/thinkube, excluding thinkube-platform)
                const appItems = getGitRepos('/home/thinkube', 'Apps')
                    .filter(item => !item.detail?.includes('thinkube-platform'));

                // Combine and sort by label
                const items = [...platformItems, ...appItems].sort((a, b) =>
                    a.label.localeCompare(b.label)
                );

                if (items.length === 0) {
                    vscode.window.showWarningMessage('No git repositories found.');
                    return;
                }

                const choice = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select a project to configure',
                    title: 'Switch Project',
                    matchOnDetail: true
                });

                if (choice && choice.detail) {
                    projectPath = choice.detail;
                } else {
                    return;
                }
            }

            // Switch to the chosen project
            currentActiveContext = projectPath;
            configService = new ClaudeConfigService(projectPath);
            if (treeProvider) {
                treeProvider.setConfigService(configService);
            }
            if (chatPanel) {
                chatPanel.updateConfigService(configService);
            }
            await updateConfigContext();
            vscode.window.showInformationMessage(`Switched to project: ${path.basename(projectPath)}`);
        })
    );

    // Initialize Claude Config
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.initializeConfig', async () => {
            if (!configService) {
                vscode.window.showErrorMessage('No workspace folder open');
                return;
            }
            try {
                await configService.initializeClaudeConfig();
                await updateConfigContext();
                vscode.window.showInformationMessage('Claude Code configuration initialized');
                treeProvider?.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to initialize config: ${error}`);
            }
        })
    );

    // Add Hook
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.addHook', async () => {
            if (!configService) {
                return;
            }

            const event = await vscode.window.showQuickPick(['PreToolUse', 'PostToolUse'], {
                placeHolder: 'Select hook event type'
            });
            if (!event) {
                return;
            }

            const matcher = await vscode.window.showInputBox({
                prompt: 'Enter tool matcher pattern (e.g., "Bash", "Edit", "*")',
                value: '*'
            });
            if (!matcher) {
                return;
            }

            const command = await vscode.window.showInputBox({
                prompt: 'Enter command to execute',
                placeHolder: 'e.g., ./scripts/validate.sh'
            });
            if (!command) {
                return;
            }

            try {
                await configService.addHook(event as 'PreToolUse' | 'PostToolUse', {
                    matcher,
                    command
                });
                vscode.window.showInformationMessage('Hook added');
                treeProvider?.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to add hook: ${error}`);
            }
        })
    );

    // Delete Hook
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.deleteHook', async (item: ConfigTreeItem) => {
            if (!configService || !item.data) {
                return;
            }
            const hook = item.data as { id: string; event: string };
            try {
                await configService.deleteHook(hook.event as 'PreToolUse' | 'PostToolUse', hook.id);
                vscode.window.showInformationMessage('Hook deleted');
                treeProvider?.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to delete hook: ${error}`);
            }
        })
    );

    // Add Command
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.addCommand', async () => {
            if (!configService) {
                return;
            }

            const name = await vscode.window.showInputBox({
                prompt: 'Enter command name (without /)',
                placeHolder: 'e.g., review-code'
            });
            if (!name) {
                return;
            }

            const description = await vscode.window.showInputBox({
                prompt: 'Enter command description',
                placeHolder: 'e.g., Review the current file for issues'
            });

            try {
                const command = await configService.createCommand(
                    name,
                    description || '',
                    '# Add your prompt here\n\nDescribe what Claude should do when this command is invoked.'
                );
                // Open the created file
                const doc = await vscode.workspace.openTextDocument(command.filePath);
                await vscode.window.showTextDocument(doc);
                treeProvider?.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to create command: ${error}`);
            }
        })
    );

    // Open Command
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.openCommand', async (cmd: Command) => {
            if (cmd && cmd.filePath) {
                const doc = await vscode.workspace.openTextDocument(cmd.filePath);
                await vscode.window.showTextDocument(doc);
            }
        })
    );

    // Delete Command
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.deleteCommand', async (item: ConfigTreeItem) => {
            if (!configService || !item.data) {
                return;
            }
            const cmd = item.data as Command;
            const confirm = await vscode.window.showWarningMessage(
                `Delete command "/${cmd.name}"?`,
                { modal: true },
                'Delete'
            );
            if (confirm === 'Delete') {
                try {
                    await configService.deleteCommand(cmd.name);
                    vscode.window.showInformationMessage('Command deleted');
                    treeProvider?.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to delete command: ${error}`);
                }
            }
        })
    );

    // Add Skill
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.addSkill', async () => {
            if (!configService) {
                return;
            }

            const name = await vscode.window.showInputBox({
                prompt: 'Enter skill name',
                placeHolder: 'e.g., code-reviewer'
            });
            if (!name) {
                return;
            }

            const description = await vscode.window.showInputBox({
                prompt: 'Enter skill description',
                placeHolder: 'e.g., Reviews code for best practices and issues'
            });

            try {
                const skill = await configService.createSkill(
                    name,
                    description || '',
                    '# Skill Instructions\n\nDescribe what this skill does and how it should behave.'
                );
                const doc = await vscode.workspace.openTextDocument(skill.filePath);
                await vscode.window.showTextDocument(doc);
                treeProvider?.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to create skill: ${error}`);
            }
        })
    );

    // Open Skill
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.openSkill', async (skill: Skill) => {
            if (skill && skill.filePath) {
                const doc = await vscode.workspace.openTextDocument(skill.filePath);
                await vscode.window.showTextDocument(doc);
            }
        })
    );

    // Delete Skill
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.deleteSkill', async (item: ConfigTreeItem) => {
            if (!configService || !item.data) {
                return;
            }
            const skill = item.data as Skill;
            const confirm = await vscode.window.showWarningMessage(
                `Delete skill "${skill.name}"?`,
                { modal: true },
                'Delete'
            );
            if (confirm === 'Delete') {
                try {
                    await configService.deleteSkill(skill.name);
                    vscode.window.showInformationMessage('Skill deleted');
                    treeProvider?.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to delete skill: ${error}`);
                }
            }
        })
    );

    // Add Agent
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.addAgent', async () => {
            if (!configService) {
                return;
            }

            const name = await vscode.window.showInputBox({
                prompt: 'Enter agent name',
                placeHolder: 'e.g., test-runner'
            });
            if (!name) {
                return;
            }

            const description = await vscode.window.showInputBox({
                prompt: 'Enter agent description',
                placeHolder: 'e.g., Runs tests and reports results'
            });

            try {
                const agent = await configService.createAgent(
                    name,
                    description || '',
                    '# Agent Instructions\n\nDescribe what this agent does and how it should behave.'
                );
                const doc = await vscode.workspace.openTextDocument(agent.filePath);
                await vscode.window.showTextDocument(doc);
                treeProvider?.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to create agent: ${error}`);
            }
        })
    );

    // Open Agent
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.openAgent', async (agent: Agent) => {
            if (agent && agent.filePath) {
                const doc = await vscode.workspace.openTextDocument(agent.filePath);
                await vscode.window.showTextDocument(doc);
            }
        })
    );

    // Delete Agent
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.deleteAgent', async (item: ConfigTreeItem) => {
            if (!configService || !item.data) {
                return;
            }
            const agent = item.data as Agent;
            const confirm = await vscode.window.showWarningMessage(
                `Delete agent "${agent.name}"?`,
                { modal: true },
                'Delete'
            );
            if (confirm === 'Delete') {
                try {
                    await configService.deleteAgent(agent.name);
                    vscode.window.showInformationMessage('Agent deleted');
                    treeProvider?.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to delete agent: ${error}`);
                }
            }
        })
    );

    // Add MCP Server
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.addMcpServer', async () => {
            if (!configService) {
                return;
            }

            const id = await vscode.window.showInputBox({
                prompt: 'Enter server ID',
                placeHolder: 'e.g., github-mcp'
            });
            if (!id) {
                return;
            }

            const command = await vscode.window.showInputBox({
                prompt: 'Enter command to run the server',
                placeHolder: 'e.g., npx, node, python3'
            });
            if (!command) {
                return;
            }

            const argsStr = await vscode.window.showInputBox({
                prompt: 'Enter command arguments (comma-separated)',
                placeHolder: 'e.g., -y, @modelcontextprotocol/server-github'
            });

            const args = argsStr ? argsStr.split(',').map(a => a.trim()) : [];

            try {
                await configService.addMcpServer(id, {
                    command,
                    args
                });
                vscode.window.showInformationMessage(`MCP Server "${id}" added`);
                treeProvider?.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to add MCP server: ${error}`);
            }
        })
    );

    // Delete MCP Server
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.deleteMcpServer', async (item: ConfigTreeItem) => {
            if (!configService || !item.data) {
                return;
            }
            const server = item.data as { id: string; name: string };
            const confirm = await vscode.window.showWarningMessage(
                `Remove MCP server "${server.name}"?`,
                { modal: true },
                'Remove'
            );
            if (confirm === 'Remove') {
                try {
                    await configService.removeMcpServer(server.id);
                    vscode.window.showInformationMessage('MCP Server removed');
                    treeProvider?.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to remove MCP server: ${error}`);
                }
            }
        })
    );

    // Edit Permissions
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.editPermissions', async () => {
            if (!configService) {
                return;
            }

            const permissions = await configService.getPermissions();
            const action = await vscode.window.showQuickPick(
                ['Add to Allow', 'Add to Deny', 'Add to Ask', 'View Current'],
                { placeHolder: 'Select action' }
            );

            if (!action) {
                return;
            }

            if (action === 'View Current') {
                const message = [
                    `Allow: ${permissions.allow.join(', ') || '(none)'}`,
                    `Deny: ${permissions.deny.join(', ') || '(none)'}`,
                    `Ask: ${permissions.ask.join(', ') || '(none)'}`
                ].join('\n');
                vscode.window.showInformationMessage(message, { modal: true });
                return;
            }

            const pattern = await vscode.window.showInputBox({
                prompt: 'Enter permission pattern',
                placeHolder: 'e.g., Bash(git:*), Edit, Read(**/secrets/**)'
            });

            if (!pattern) {
                return;
            }

            try {
                if (action === 'Add to Allow') {
                    permissions.allow.push(pattern);
                } else if (action === 'Add to Deny') {
                    permissions.deny.push(pattern);
                } else {
                    permissions.ask.push(pattern);
                }
                await configService.setPermissions(permissions);
                vscode.window.showInformationMessage('Permissions updated');
                treeProvider?.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to update permissions: ${error}`);
            }
        })
    );

    // ========== Plugin Commands ==========

    // Browse Plugins (marketplace browser)
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.browsePlugins', async () => {
            const pluginService = treeProvider?.getPluginService();
            if (!pluginService) {
                vscode.window.showErrorMessage('Plugin service not available');
                return;
            }

            try {
                const availablePlugins = await pluginService.getAvailablePlugins();

                if (availablePlugins.length === 0) {
                    vscode.window.showInformationMessage('No plugins available in marketplaces');
                    return;
                }

                const items = availablePlugins.map(({ plugin, marketplace }) => ({
                    label: `$(extensions) ${plugin.name}`,
                    description: `@${marketplace}`,
                    detail: plugin.description,
                    plugin,
                    marketplace
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select a plugin to install',
                    title: 'Browse Marketplace Plugins'
                });

                if (selected) {
                    await pluginService.installPlugin(selected.plugin.name, selected.marketplace);
                    vscode.window.showInformationMessage(`Plugin ${selected.plugin.name} installed!`);
                    treeProvider?.refresh();
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to browse plugins: ${error}`);
            }
        })
    );

    // Install Plugin
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.installPlugin', async (pluginName?: string, marketplace?: string) => {
            const pluginService = treeProvider?.getPluginService();
            if (!pluginService) {
                vscode.window.showErrorMessage('Plugin service not available');
                return;
            }

            if (!pluginName || !marketplace) {
                // Show browse dialog if not provided
                await vscode.commands.executeCommand('thinkube.browsePlugins');
                return;
            }

            try {
                await pluginService.installPlugin(pluginName, marketplace);
                vscode.window.showInformationMessage(`Plugin ${pluginName} installed!`);
                treeProvider?.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to install plugin: ${error}`);
            }
        })
    );

    // Enable/Disable Plugin
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.togglePlugin', async (item: ConfigTreeItem) => {
            const pluginService = treeProvider?.getPluginService();
            if (!pluginService || !item.data) {
                return;
            }

            const plugin = item.data as { name: string; marketplace: string; enabled: boolean };

            try {
                await pluginService.setPluginEnabled(plugin.name, plugin.marketplace, !plugin.enabled);
                vscode.window.showInformationMessage(`Plugin ${plugin.name} ${plugin.enabled ? 'disabled' : 'enabled'}`);
                treeProvider?.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to toggle plugin: ${error}`);
            }
        })
    );

    // Create Plugin (wizard)
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.createPlugin', async () => {
            const pluginService = treeProvider?.getPluginService();
            if (!pluginService) {
                vscode.window.showErrorMessage('Plugin service not available');
                return;
            }

            const wizard = new PluginCreationWizard(pluginService);
            const pluginPath = await wizard.run();

            if (pluginPath) {
                treeProvider?.refresh();
            }
        })
    );

    // Quick Create Plugin
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.quickCreatePlugin', async () => {
            const pluginService = treeProvider?.getPluginService();
            if (!pluginService) {
                vscode.window.showErrorMessage('Plugin service not available');
                return;
            }

            const pluginPath = await quickCreatePlugin(pluginService);

            if (pluginPath) {
                treeProvider?.refresh();
            }
        })
    );

    // Suggest Plugins (analyze project and suggest)
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.suggestPlugins', async () => {
            const pluginService = treeProvider?.getPluginService();
            if (!pluginService) {
                vscode.window.showErrorMessage('Plugin service not available');
                return;
            }

            try {
                const suggestions = await pluginService.suggestPlugins();

                if (suggestions.length === 0) {
                    vscode.window.showInformationMessage('No plugin suggestions for this project');
                    return;
                }

                const items = suggestions.map(({ plugin, marketplace, reason }) => ({
                    label: `$(extensions) ${plugin.name}`,
                    description: reason,
                    detail: plugin.description,
                    plugin,
                    marketplace
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select plugins to install',
                    canPickMany: true,
                    title: 'Suggested Plugins for Your Project'
                });

                if (selected && selected.length > 0) {
                    for (const item of selected) {
                        await pluginService.installPlugin(item.plugin.name, item.marketplace);
                    }
                    vscode.window.showInformationMessage(`Installed ${selected.length} plugin(s)`);
                    treeProvider?.refresh();
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to suggest plugins: ${error}`);
            }
        })
    );

    // Uninstall Plugin
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.uninstallPlugin', async (item: ConfigTreeItem) => {
            const pluginService = treeProvider?.getPluginService();
            if (!pluginService || !item.data) {
                return;
            }

            const plugin = item.data as { name: string; marketplace: string };

            const confirm = await vscode.window.showWarningMessage(
                `Uninstall plugin "${plugin.name}"?`,
                { modal: true },
                'Uninstall'
            );

            if (confirm === 'Uninstall') {
                try {
                    await pluginService.uninstallPlugin(plugin.name, plugin.marketplace);
                    vscode.window.showInformationMessage(`Plugin ${plugin.name} uninstalled`);
                    treeProvider?.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to uninstall plugin: ${error}`);
                }
            }
        })
    );
}

export function deactivate() {
    // Clean up if needed
}