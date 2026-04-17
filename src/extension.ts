import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as appCommands from './commands/app';
import { ClaudeConfigService } from './services/ClaudeConfigService';
import { ClaudeLauncher } from './services/ClaudeLauncher';
import { QuickSetup } from './services/QuickSetup';
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
let claudeLauncher: ClaudeLauncher | undefined;
let currentActiveContext: string | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Schedule a tree refresh after Claude CLI finishes (terminal close).
 * Shows a notification with a refresh button since we can't detect terminal exit.
 */
function scheduleTreeRefresh(): void {
    vscode.window.showInformationMessage(
        'Claude is generating config in the terminal. Refresh when done.',
        'Refresh Tree'
    ).then(action => {
        if (action === 'Refresh Tree') {
            treeProvider?.refresh();
        }
    });
}

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
 * Update the active project context. In multi-root mode, this only affects
 * the ChatPanel target and status bar — the tree always shows all projects.
 */
async function updateActiveContext(newPath?: string): Promise<void> {
    const activePath = newPath || getActiveProjectPath();

    if (activePath === currentActiveContext) {
        return;
    }

    currentActiveContext = activePath;

    if (activePath && configService) {
        configService.setActiveProject(activePath);
        if (chatPanel) {
            chatPanel.updateConfigService(configService);
        }

        await updateConfigContext();

        const contextName = path.basename(activePath);
        if (statusBarItem) {
            statusBarItem.text = `$(folder) ${contextName}`;
            statusBarItem.tooltip = `Active project: ${activePath}`;
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

    // Check Claude CLI availability (non-blocking)
    import('./services/ClaudeAnalyzer').then(({ ClaudeAnalyzer }) => {
        ClaudeAnalyzer.isAvailable().then(available => {
            if (!available) {
                vscode.window.showWarningMessage(
                    'Claude Code CLI not found. Chat analysis features require the Claude CLI to be installed.'
                );
            }
        });
    });

    // Create status bar item to show active project
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'thinkube.switchProject';
    context.subscriptions.push(statusBarItem);

    // Initialize with first workspace folder or home
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const initialPath = workspaceFolders?.[0]?.uri.fsPath || '/home/thinkube';
    configService = new ClaudeConfigService(initialPath);
    treeProvider = new ConfigTreeProvider(configService);
    claudeLauncher = new ClaudeLauncher();

    // Register tree view
    const treeView = vscode.window.createTreeView('claudeConfigTree', {
        treeDataProvider: treeProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(treeView);

    // Track active project from tree selection
    context.subscriptions.push(
        treeView.onDidChangeSelection(e => {
            const item = e.selection[0];
            if (item?.projectPath && item.projectPath !== currentActiveContext) {
                updateActiveContext(item.projectPath);
            }
        })
    );

    // Register chat panel
    chatPanel = new ChatPanel(context.extensionUri, configService);
    const chatPanelProvider = vscode.window.registerWebviewViewProvider(
        ChatPanel.viewType,
        chatPanel
    );
    context.subscriptions.push(chatPanelProvider);

    // Update context and refresh when config changes
    configService.onConfigChanged(() => {
        updateConfigContext();
    });

    // Initial context update
    updateActiveContext();

    // Update active project when editor changes
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            updateActiveContext();
        })
    );

    // Always show config tree (multi-root always has content)
    vscode.commands.executeCommand('setContext', 'thinkube.hasClaudeConfig', true);

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
                config.event as any,
                {
                    matcher: config.matcher as string,
                    type: (config.type as any) || 'command',
                    command: config.command as string,
                    url: config.url as string | undefined,
                    prompt: config.prompt as string | undefined,
                    agent: config.agent as string | undefined
                }
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
                config.model as string | undefined
            );
            break;
        case 'mcp-server':
            if (config.type === 'http') {
                await service.addMcpServer(
                    config.id as string,
                    {
                        type: 'http',
                        url: config.url as string,
                        headers: config.headers as Record<string, string> | undefined
                    }
                );
            } else {
                await service.addMcpServer(
                    config.id as string,
                    {
                        command: config.command as string,
                        args: config.args as string[],
                        env: config.env as Record<string, string> | undefined
                    }
                );
            }
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

    // Switch Project — sets active project for ChatPanel
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.switchProject', async (projectPath?: string) => {
            if (projectPath) {
                await updateActiveContext(projectPath);
                return;
            }

            // Show quick pick of all projects
            const sections = [
                { path: '/home/thinkube/thinkube-platform', prefix: 'Platform' },
                { path: '/home/thinkube/apps', prefix: 'Apps' },
                { path: '/home/thinkube/user-templates', prefix: 'Templates' },
            ];

            const items: vscode.QuickPickItem[] = [];
            for (const section of sections) {
                try {
                    const entries = fs.readdirSync(section.path, { withFileTypes: true });
                    for (const entry of entries) {
                        if (entry.isDirectory() && !entry.name.startsWith('.')) {
                            const fullPath = path.join(section.path, entry.name);
                            if (fs.existsSync(path.join(fullPath, '.git'))) {
                                const configured = fs.existsSync(path.join(fullPath, '.claude')) ||
                                                   fs.existsSync(path.join(fullPath, 'CLAUDE.md'));
                                items.push({
                                    label: `${section.prefix}: ${entry.name}`,
                                    description: configured ? '$(check)' : '(no config)',
                                    detail: fullPath,
                                });
                            }
                        }
                    }
                } catch { /* ignore */ }
            }

            const choice = await vscode.window.showQuickPick(items, {
                placeHolder: 'Set active project (for chat analysis)',
                title: 'Switch Active Project',
                matchOnDetail: true
            });

            if (choice?.detail) {
                await updateActiveContext(choice.detail);
                vscode.window.showInformationMessage(`Active project: ${path.basename(choice.detail)}`);
            }
        })
    );

    // Initialize Claude Config — accepts optional projectPath
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.initializeConfig', async (projectPath?: string) => {
            if (!configService) {
                return;
            }
            const targetPath = projectPath || currentActiveContext;
            if (!targetPath) {
                vscode.window.showErrorMessage('No project selected');
                return;
            }

            const choice = await vscode.window.showQuickPick([
                {
                    label: '$(play) Claude Init',
                    description: 'Run claude init to create CLAUDE.md',
                    detail: 'Interactive CLI session — Claude analyzes your project and generates CLAUDE.md',
                    id: 'init'
                },
                {
                    label: '$(sparkle) Quick Setup',
                    description: 'Detect tools and generate starter config',
                    detail: 'Creates hooks, commands, and permissions based on detected tooling, then runs claude init for CLAUDE.md',
                    id: 'quick'
                },
                {
                    label: '$(sparkle) Full Setup with Claude',
                    description: 'Use Claude CLI for intelligent setup',
                    detail: 'Opens Claude in terminal to analyze your project and create comprehensive config',
                    id: 'claude'
                },
                {
                    label: '$(new-folder) Empty Config',
                    description: 'Create empty .claude/ folder',
                    detail: 'For manual configuration',
                    id: 'empty'
                }
            ], {
                placeHolder: `Set up Claude Code for ${path.basename(targetPath)}`,
                title: 'Initialize Configuration'
            });

            if (!choice) return;

            try {
                if (choice.id === 'quick') {
                    const quickSetup = new QuickSetup();
                    const result = await quickSetup.setup(targetPath);
                    vscode.window.showInformationMessage(result.summary, { modal: true });
                    if (result.needsInit) {
                        const terminal = vscode.window.createTerminal({
                            name: `Claude Init: ${path.basename(targetPath)}`,
                            cwd: targetPath,
                        });
                        terminal.show();
                        terminal.sendText('claude init');
                    } else {
                        const settingsPath = path.join(targetPath, '.claude', 'settings.json');
                        if (fs.existsSync(settingsPath)) {
                            const doc = await vscode.workspace.openTextDocument(settingsPath);
                            await vscode.window.showTextDocument(doc);
                        }
                    }
                } else if (choice.id === 'init') {
                    const terminal = vscode.window.createTerminal({
                        name: `Claude Init: ${path.basename(targetPath)}`,
                        cwd: targetPath,
                    });
                    terminal.show();
                    terminal.sendText('claude init');
                } else if (choice.id === 'claude') {
                    await claudeLauncher?.launchFullSetup(targetPath);
                } else {
                    await configService.initializeClaudeConfig(targetPath);
                    vscode.window.showInformationMessage(`Empty Claude config created in ${path.basename(targetPath)}`);
                }
                treeProvider?.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to initialize config: ${error}`);
            }
        })
    );

    // Run claude init
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.runClaudeInit', async (projectPath?: string) => {
            const targetPath = projectPath || currentActiveContext;
            if (!targetPath) {
                vscode.window.showErrorMessage('No project selected');
                return;
            }
            const terminal = vscode.window.createTerminal({
                name: `Claude Init: ${path.basename(targetPath)}`,
                cwd: targetPath,
            });
            terminal.show();
            terminal.sendText('claude init');
        })
    );

    // Add Hook
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.addHook', async (item?: ConfigTreeItem) => {
            if (!configService) {
                return;
            }
            const projectPath = item?.projectPath || currentActiveContext;
            if (!projectPath) { vscode.window.showErrorMessage('No project selected'); return; }

            const { HOOK_EVENTS } = await import('./models/Hook');

            const event = await vscode.window.showQuickPick(
                [...HOOK_EVENTS],
                { placeHolder: 'Select hook event' }
            );
            if (!event) {
                return;
            }

            const hookType = await vscode.window.showQuickPick(
                [
                    { label: 'command', description: 'Run a shell command' },
                    { label: 'http', description: 'Send HTTP request' },
                    { label: 'prompt', description: 'Inject a prompt' },
                    { label: 'agent', description: 'Invoke an agent' }
                ],
                { placeHolder: 'Select hook type' }
            );
            if (!hookType) {
                return;
            }

            const matcher = await vscode.window.showInputBox({
                prompt: 'Enter tool matcher pattern (e.g., "Bash", "Edit", "*", or empty for non-tool events)',
                value: ''
            });
            if (matcher === undefined) {
                return;
            }

            try {
                const type = hookType.label as 'command' | 'http' | 'prompt' | 'agent';
                if (type === 'command') {
                    const command = await vscode.window.showInputBox({
                        prompt: 'Enter command to execute',
                        placeHolder: 'e.g., ./scripts/validate.sh'
                    });
                    if (!command) { return; }
                    await configService.addHook(event as any, { matcher, type: 'command', command }, projectPath);
                } else if (type === 'http') {
                    const url = await vscode.window.showInputBox({
                        prompt: 'Enter URL to call',
                        placeHolder: 'e.g., https://example.com/webhook'
                    });
                    if (!url) { return; }
                    await configService.addHook(event as any, { matcher, type: 'http', url }, projectPath);
                } else if (type === 'prompt') {
                    const prompt = await vscode.window.showInputBox({
                        prompt: 'Enter prompt text to inject',
                        placeHolder: 'e.g., Always check for security issues'
                    });
                    if (!prompt) { return; }
                    await configService.addHook(event as any, { matcher, type: 'prompt', prompt }, projectPath);
                } else if (type === 'agent') {
                    const agent = await vscode.window.showInputBox({
                        prompt: 'Enter agent name',
                        placeHolder: 'e.g., code-reviewer'
                    });
                    if (!agent) { return; }
                    await configService.addHook(event as any, { matcher, type: 'agent', agent }, projectPath);
                }

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
                await configService.deleteHook(hook.event as any, hook.id, item.projectPath);
                vscode.window.showInformationMessage('Hook deleted');
                treeProvider?.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to delete hook: ${error}`);
            }
        })
    );

    // Add Command
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.addCommand', async (item?: ConfigTreeItem) => {
            if (!configService) {
                return;
            }
            const projectPath = item?.projectPath || currentActiveContext;
            if (!projectPath) { vscode.window.showErrorMessage('No project selected'); return; }

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
                    '# Add your prompt here\n\nDescribe what Claude should do when this command is invoked.',
                    undefined,
                    projectPath
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
                    await configService.deleteCommand(cmd.name, item.projectPath);
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
        vscode.commands.registerCommand('thinkube.addSkill', async (item?: ConfigTreeItem) => {
            if (!configService) {
                return;
            }
            const projectPath = item?.projectPath || currentActiveContext;
            if (!projectPath) { vscode.window.showErrorMessage('No project selected'); return; }

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
                    '# Skill Instructions\n\nDescribe what this skill does and how it should behave.',
                    [],
                    undefined,
                    projectPath
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
                    await configService.deleteSkill(skill.name, item.projectPath);
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
        vscode.commands.registerCommand('thinkube.addAgent', async (item?: ConfigTreeItem) => {
            if (!configService) {
                return;
            }
            const projectPath = item?.projectPath || currentActiveContext;
            if (!projectPath) { vscode.window.showErrorMessage('No project selected'); return; }

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
                    '# Agent Instructions\n\nDescribe what this agent does and how it should behave.',
                    [],
                    undefined,
                    projectPath
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
                    await configService.deleteAgent(agent.name, item.projectPath);
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
        vscode.commands.registerCommand('thinkube.addMcpServer', async (item?: ConfigTreeItem) => {
            if (!configService) {
                return;
            }
            const projectPath = item?.projectPath || currentActiveContext;
            if (!projectPath) { vscode.window.showErrorMessage('No project selected'); return; }

            const id = await vscode.window.showInputBox({
                prompt: 'Enter server ID',
                placeHolder: 'e.g., github-mcp'
            });
            if (!id) {
                return;
            }

            const serverType = await vscode.window.showQuickPick(
                [
                    { label: 'stdio', description: 'Local process (command + args)' },
                    { label: 'http', description: 'Remote HTTP/SSE server (URL)' }
                ],
                { placeHolder: 'Select server transport type' }
            );
            if (!serverType) {
                return;
            }

            try {
                if (serverType.label === 'http') {
                    const url = await vscode.window.showInputBox({
                        prompt: 'Enter server URL',
                        placeHolder: 'e.g., https://example.com/mcp'
                    });
                    if (!url) { return; }

                    await configService.addMcpServer(id, { type: 'http', url }, projectPath);
                } else {
                    const command = await vscode.window.showInputBox({
                        prompt: 'Enter command to run the server',
                        placeHolder: 'e.g., npx, node, python3'
                    });
                    if (!command) { return; }

                    const argsStr = await vscode.window.showInputBox({
                        prompt: 'Enter command arguments (comma-separated)',
                        placeHolder: 'e.g., -y, @modelcontextprotocol/server-github'
                    });
                    const args = argsStr ? argsStr.split(',').map(a => a.trim()) : [];

                    await configService.addMcpServer(id, { command, args }, projectPath);
                }

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
                    await configService.removeMcpServer(server.id, item.projectPath);
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
        vscode.commands.registerCommand('thinkube.editPermissions', async (item?: ConfigTreeItem) => {
            if (!configService) {
                return;
            }
            const projectPath = item?.projectPath || currentActiveContext;

            const permissions = await configService.getPermissions(projectPath);
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
                await configService.setPermissions(permissions, projectPath);
                vscode.window.showInformationMessage('Permissions updated');
                treeProvider?.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to update permissions: ${error}`);
            }
        })
    );

    // ========== Generate with Claude Commands ==========

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.generateHook', async (event?: string, projectPath?: string) => {
            if (!claudeLauncher) return;
            const targetPath = projectPath || currentActiveContext;
            if (!targetPath) { vscode.window.showErrorMessage('No project selected'); return; }
            const { HOOK_EVENTS } = await import('./models/Hook');
            const hookEvent = event && HOOK_EVENTS.includes(event as any) ? event : undefined;
            if (!hookEvent) { vscode.window.showErrorMessage('Invalid hook event'); return; }
            await claudeLauncher.launch(targetPath, { kind: 'hook', event: hookEvent as any });
            scheduleTreeRefresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.generateCommand', async (projectPath?: string) => {
            if (!claudeLauncher) return;
            const targetPath = projectPath || currentActiveContext;
            if (!targetPath) { vscode.window.showErrorMessage('No project selected'); return; }
            await claudeLauncher.launch(targetPath, { kind: 'command' });
            scheduleTreeRefresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.generateSkill', async (projectPath?: string) => {
            if (!claudeLauncher) return;
            const targetPath = projectPath || currentActiveContext;
            if (!targetPath) { vscode.window.showErrorMessage('No project selected'); return; }
            await claudeLauncher.launch(targetPath, { kind: 'skill' });
            scheduleTreeRefresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.generateAgent', async (projectPath?: string) => {
            if (!claudeLauncher) return;
            const targetPath = projectPath || currentActiveContext;
            if (!targetPath) { vscode.window.showErrorMessage('No project selected'); return; }
            await claudeLauncher.launch(targetPath, { kind: 'agent' });
            scheduleTreeRefresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.generateMcpServer', async (projectPath?: string) => {
            if (!claudeLauncher) return;
            const targetPath = projectPath || currentActiveContext;
            if (!targetPath) { vscode.window.showErrorMessage('No project selected'); return; }
            await claudeLauncher.launch(targetPath, { kind: 'mcp-server' });
            scheduleTreeRefresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.generateFullSetup', async (projectPath?: string) => {
            if (!claudeLauncher) return;
            const targetPath = projectPath || currentActiveContext;
            if (!targetPath) { vscode.window.showErrorMessage('No project selected'); return; }
            await claudeLauncher.launchFullSetup(targetPath);
            scheduleTreeRefresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.generateWorkspaceConfig', async (workspacePath?: string) => {
            if (!claudeLauncher) return;
            if (!workspacePath) { vscode.window.showErrorMessage('No workspace path provided'); return; }
            await claudeLauncher.launch(workspacePath, { kind: 'workspace-config' });
            scheduleTreeRefresh();
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