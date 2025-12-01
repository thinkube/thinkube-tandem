/**
 * PluginCreationWizard - Multi-step wizard dialog for creating plugins
 *
 * Guides users through:
 * 1. Plugin name and description
 * 2. Template selection
 * 3. Component selection
 * 4. Output location
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { PluginService, PluginCreationOptions, PluginTemplate } from '../../services/PluginService';
import { getTemplates, getTemplate, generateTemplateFiles, PluginTemplate as Template } from '../../services/PluginTemplates';
import * as fs from 'fs';

interface WizardState {
    name: string;
    description: string;
    template: string;
    marketplace: 'thinkube' | 'thinkube-platform';
    components: {
        commands: boolean;
        hooks: boolean;
        skills: boolean;
        agents: boolean;
        mcpServers: boolean;
    };
    outputPath: string;
}

export class PluginCreationWizard {
    private state: WizardState = {
        name: '',
        description: '',
        template: 'empty',
        marketplace: 'thinkube',
        components: {
            commands: false,
            hooks: false,
            skills: false,
            agents: false,
            mcpServers: false
        },
        outputPath: ''
    };

    constructor(private pluginService: PluginService) {}

    /**
     * Run the wizard and return the created plugin path
     */
    async run(): Promise<string | undefined> {
        // Step 1: Plugin name
        const name = await this.stepName();
        if (!name) return undefined;
        this.state.name = name;

        // Step 2: Plugin description
        const description = await this.stepDescription();
        if (!description) return undefined;
        this.state.description = description;

        // Step 3: Template selection
        const template = await this.stepTemplate();
        if (!template) return undefined;
        this.state.template = template;

        // Step 4: Marketplace selection
        const marketplace = await this.stepMarketplace();
        if (!marketplace) return undefined;
        this.state.marketplace = marketplace;

        // Step 5: Components (if not using template defaults)
        if (template === 'empty') {
            const components = await this.stepComponents();
            if (!components) return undefined;
            this.state.components = components;
        } else {
            // Use template's default components
            const templateDef = getTemplate(template);
            if (templateDef) {
                this.state.components = templateDef.components;
            }
        }

        // Step 6: Output location
        const outputPath = await this.stepOutputLocation();
        if (!outputPath) return undefined;
        this.state.outputPath = outputPath;

        // Create the plugin
        return await this.createPlugin();
    }

    private async stepName(): Promise<string | undefined> {
        return await vscode.window.showInputBox({
            title: 'Create Plugin (1/6)',
            prompt: 'Enter plugin name (without tk- prefix)',
            placeHolder: 'e.g., my-plugin',
            validateInput: (value) => {
                if (!value) return 'Plugin name is required';
                if (!/^[a-z][a-z0-9-]*$/.test(value)) {
                    return 'Name must be lowercase letters, numbers, and hyphens only';
                }
                return undefined;
            }
        });
    }

    private async stepDescription(): Promise<string | undefined> {
        return await vscode.window.showInputBox({
            title: 'Create Plugin (2/6)',
            prompt: 'Enter plugin description',
            placeHolder: 'e.g., Helpful tools for my workflow',
            value: `Tools for ${this.state.name}`,
            validateInput: (value) => {
                if (!value) return 'Description is required';
                return undefined;
            }
        });
    }

    private async stepTemplate(): Promise<string | undefined> {
        const templates = getTemplates();
        const items: vscode.QuickPickItem[] = templates.map(t => ({
            label: `$(${t.icon}) ${t.name}`,
            description: t.description,
            detail: this.getTemplateDetail(t)
        }));

        const selected = await vscode.window.showQuickPick(items, {
            title: 'Create Plugin (3/6)',
            placeHolder: 'Select a template',
            ignoreFocusOut: true
        });

        if (!selected) return undefined;

        // Extract template name from label (remove icon)
        const match = selected.label.match(/\$\([^)]+\) (.+)/);
        return match ? match[1] : undefined;
    }

    private getTemplateDetail(template: Template): string {
        const parts: string[] = [];
        if (template.components.commands) parts.push('Commands');
        if (template.components.hooks) parts.push('Hooks');
        if (template.components.skills) parts.push('Skills');
        if (template.components.agents) parts.push('Agents');
        if (template.components.mcpServers) parts.push('MCP Servers');

        return parts.length > 0 ? `Includes: ${parts.join(', ')}` : 'Empty template';
    }

    private async stepMarketplace(): Promise<'thinkube' | 'thinkube-platform' | undefined> {
        const items: vscode.QuickPickItem[] = [
            {
                label: '$(globe) Public Marketplace (thinkube)',
                description: 'For app developers',
                detail: 'Visible to all users building applications on thinkube'
            },
            {
                label: '$(lock) Platform Marketplace (thinkube-platform)',
                description: 'For platform developers',
                detail: 'Internal plugins for thinkube platform development'
            }
        ];

        const selected = await vscode.window.showQuickPick(items, {
            title: 'Create Plugin (4/6)',
            placeHolder: 'Select target marketplace',
            ignoreFocusOut: true
        });

        if (!selected) return undefined;

        return selected.label.includes('Platform') ? 'thinkube-platform' : 'thinkube';
    }

    private async stepComponents(): Promise<WizardState['components'] | undefined> {
        const items: vscode.QuickPickItem[] = [
            {
                label: '$(terminal) Commands',
                description: 'Slash commands (/*.md files)',
                picked: true
            },
            {
                label: '$(shield) Hooks',
                description: 'Pre/Post tool use hooks',
                picked: false
            },
            {
                label: '$(mortar-board) Skills',
                description: 'Reusable knowledge modules',
                picked: false
            },
            {
                label: '$(hubot) Agents',
                description: 'Specialized subagents',
                picked: false
            },
            {
                label: '$(server) MCP Servers',
                description: 'Model Context Protocol servers',
                picked: false
            }
        ];

        const selected = await vscode.window.showQuickPick(items, {
            title: 'Create Plugin (5/6)',
            placeHolder: 'Select components to include',
            canPickMany: true,
            ignoreFocusOut: true
        });

        if (!selected) return undefined;

        return {
            commands: selected.some(s => s.label.includes('Commands')),
            hooks: selected.some(s => s.label.includes('Hooks')),
            skills: selected.some(s => s.label.includes('Skills')),
            agents: selected.some(s => s.label.includes('Agents')),
            mcpServers: selected.some(s => s.label.includes('MCP Servers'))
        };
    }

    private async stepOutputLocation(): Promise<string | undefined> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const defaultPath = workspaceFolders?.[0]?.uri.fsPath || '';

        const options: vscode.OpenDialogOptions = {
            title: 'Select output directory for plugin (6/6)',
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri: vscode.Uri.file(defaultPath),
            openLabel: 'Select'
        };

        const selected = await vscode.window.showOpenDialog(options);
        return selected?.[0]?.fsPath;
    }

    private async createPlugin(): Promise<string | undefined> {
        try {
            // Get the template
            const template = getTemplate(this.state.template);

            if (template) {
                // Use template-based creation
                const pluginDir = path.join(
                    this.state.outputPath,
                    `tk-claude-plugin-${this.state.name}`
                );

                // Generate files from template
                const files = generateTemplateFiles(template, {
                    pluginName: this.state.name,
                    description: this.state.description,
                    marketplace: this.state.marketplace
                });

                // Create directories and write files
                for (const file of files) {
                    const filePath = path.join(pluginDir, file.path);
                    const dir = path.dirname(filePath);

                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }

                    fs.writeFileSync(filePath, file.content);

                    // Make shell scripts executable
                    if (file.path.endsWith('.sh')) {
                        fs.chmodSync(filePath, '755');
                    }
                }

                // Show success message
                const action = await vscode.window.showInformationMessage(
                    `Plugin tk-${this.state.name} created successfully!`,
                    'Open Folder',
                    'Open in New Window'
                );

                if (action === 'Open Folder') {
                    const folderUri = vscode.Uri.file(pluginDir);
                    await vscode.commands.executeCommand('vscode.openFolder', folderUri, false);
                } else if (action === 'Open in New Window') {
                    const folderUri = vscode.Uri.file(pluginDir);
                    await vscode.commands.executeCommand('vscode.openFolder', folderUri, true);
                }

                return pluginDir;
            } else {
                // Fall back to PluginService creation
                const options: PluginCreationOptions = {
                    name: this.state.name,
                    description: this.state.description,
                    template: this.state.template as PluginTemplate,
                    marketplace: this.state.marketplace,
                    components: this.state.components,
                    outputPath: this.state.outputPath
                };

                const pluginDir = await this.pluginService.createPlugin(options);

                vscode.window.showInformationMessage(
                    `Plugin tk-${this.state.name} created at ${pluginDir}`
                );

                return pluginDir;
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create plugin: ${error}`);
            return undefined;
        }
    }
}

/**
 * Quick create a plugin with minimal prompts
 */
export async function quickCreatePlugin(
    pluginService: PluginService,
    name?: string,
    template?: string
): Promise<string | undefined> {
    // Get name if not provided
    if (!name) {
        name = await vscode.window.showInputBox({
            prompt: 'Plugin name (without tk- prefix)',
            placeHolder: 'e.g., my-plugin',
            validateInput: (value) => {
                if (!value) return 'Plugin name is required';
                if (!/^[a-z][a-z0-9-]*$/.test(value)) {
                    return 'Name must be lowercase letters, numbers, and hyphens only';
                }
                return undefined;
            }
        });
        if (!name) return undefined;
    }

    // Get template if not provided
    if (!template) {
        const templates = getTemplates();
        const items = templates.map(t => ({
            label: t.name,
            description: t.description
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select template'
        });
        if (!selected) return undefined;
        template = selected.label;
    }

    // Get output path
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const outputPath = workspaceFolders?.[0]?.uri.fsPath;
    if (!outputPath) {
        vscode.window.showErrorMessage('No workspace folder open');
        return undefined;
    }

    // Create with defaults
    const templateDef = getTemplate(template);
    if (!templateDef) {
        vscode.window.showErrorMessage(`Template ${template} not found`);
        return undefined;
    }

    const pluginDir = path.join(outputPath, `tk-claude-plugin-${name}`);
    const files = generateTemplateFiles(templateDef, {
        pluginName: name,
        description: `Plugin for ${name}`,
        marketplace: 'thinkube'
    });

    for (const file of files) {
        const filePath = path.join(pluginDir, file.path);
        const dir = path.dirname(filePath);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(filePath, file.content);

        if (file.path.endsWith('.sh')) {
            fs.chmodSync(filePath, '755');
        }
    }

    vscode.window.showInformationMessage(`Plugin tk-${name} created!`);
    return pluginDir;
}
