/**
 * PluginService - Service for managing Claude Code plugins
 *
 * Handles:
 * - Fetching marketplace catalogs
 * - Installing/enabling plugins
 * - Reading installed plugins from settings.json
 * - Scaffolding new plugins from templates
 * - Publishing plugins to marketplace
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Plugin metadata from marketplace
export interface PluginInfo {
    name: string;
    description: string;
    version?: string;
    source: {
        type: 'github' | 'local';
        repo?: string;
        path?: string;
    };
}

// Marketplace catalog
export interface Marketplace {
    name: string;
    description?: string;
    plugins: PluginInfo[];
}

// Installed plugin with status
export interface InstalledPlugin {
    name: string;
    marketplace: string;
    enabled: boolean;
    source: PluginInfo['source'];
    localPath?: string;
}

// Plugin template types
export type PluginTemplate = 'empty' | 'hooks-only' | 'commands-only' | 'full-stack' | 'analyzer';

// Plugin creation options
export interface PluginCreationOptions {
    name: string;
    description: string;
    template: PluginTemplate;
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

// Known marketplace sources
// Using local paths for development; switch to GitHub for production
const KNOWN_MARKETPLACES: Record<string, { type: 'github' | 'local'; repo?: string; path?: string }> = {
    'thinkube': {
        type: 'local',
        path: '/home/thinkube/thinkube-platform/thinkube-claude-marketplace'
    },
    'thinkube-platform': {
        type: 'local',
        path: '/home/thinkube/thinkube-platform/thinkube-claude-marketplace-platform'
    }
};

// GitHub URLs for production (uncomment when repos are pushed)
// const KNOWN_MARKETPLACES: Record<string, { type: 'github' | 'local'; repo?: string; path?: string }> = {
//     'thinkube': {
//         type: 'github',
//         repo: 'thinkube/thinkube-claude-marketplace'
//     },
//     'thinkube-platform': {
//         type: 'github',
//         repo: 'thinkube/thinkube-claude-marketplace-platform'
//     }
// };

export class PluginService {
    private _onPluginsChanged = new vscode.EventEmitter<void>();
    readonly onPluginsChanged = this._onPluginsChanged.event;

    private marketplaceCache: Map<string, Marketplace> = new Map();

    constructor(private basePath: string) {}

    // ========== Marketplace Operations ==========

    /**
     * Get list of available marketplaces (known + extra from settings)
     */
    async getMarketplaces(projectPath?: string): Promise<{ name: string; source: PluginInfo['source'] }[]> {
        const marketplaces: { name: string; source: PluginInfo['source'] }[] = [];

        // Add known marketplaces
        for (const [name, source] of Object.entries(KNOWN_MARKETPLACES)) {
            marketplaces.push({ name, source });
        }

        // Add extra marketplaces from settings
        const settingsPath = path.join(projectPath || this.basePath, '.claude', 'settings.json');
        if (fs.existsSync(settingsPath)) {
            try {
                const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                const extraMarketplaces = settings.extraKnownMarketplaces || [];
                for (const extra of extraMarketplaces) {
                    if (!marketplaces.find(m => m.name === extra.name)) {
                        marketplaces.push({
                            name: extra.name,
                            source: extra.source
                        });
                    }
                }
            } catch (error) {
                console.error('Error reading settings for extra marketplaces:', error);
            }
        }

        return marketplaces;
    }

    /**
     * Fetch marketplace catalog
     */
    async fetchMarketplace(marketplaceName: string): Promise<Marketplace | undefined> {
        // Check cache first
        if (this.marketplaceCache.has(marketplaceName)) {
            return this.marketplaceCache.get(marketplaceName);
        }

        const marketplaces = await this.getMarketplaces();
        const marketplace = marketplaces.find(m => m.name === marketplaceName);

        if (!marketplace) {
            console.error(`Marketplace ${marketplaceName} not found`);
            return undefined;
        }

        try {
            let catalog: Marketplace;

            if (marketplace.source.type === 'local' && marketplace.source.path) {
                // Load from local path
                const catalogPath = path.join(marketplace.source.path, 'marketplace.json');
                const content = fs.readFileSync(catalogPath, 'utf8');
                catalog = JSON.parse(content);
            } else if (marketplace.source.type === 'github' && marketplace.source.repo) {
                // Fetch from GitHub raw content
                const url = `https://raw.githubusercontent.com/${marketplace.source.repo}/main/marketplace.json`;
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`Failed to fetch marketplace: ${response.statusText}`);
                }
                catalog = await response.json() as Marketplace;
            } else {
                throw new Error('Invalid marketplace source configuration');
            }

            this.marketplaceCache.set(marketplaceName, catalog);
            return catalog;
        } catch (error) {
            console.error(`Error fetching marketplace ${marketplaceName}:`, error);
            return undefined;
        }
    }

    /**
     * Get all available plugins from all marketplaces
     */
    async getAvailablePlugins(): Promise<{ plugin: PluginInfo; marketplace: string }[]> {
        const result: { plugin: PluginInfo; marketplace: string }[] = [];
        const marketplaces = await this.getMarketplaces();

        for (const marketplace of marketplaces) {
            const catalog = await this.fetchMarketplace(marketplace.name);
            if (catalog) {
                for (const plugin of catalog.plugins) {
                    result.push({ plugin, marketplace: marketplace.name });
                }
            }
        }

        return result;
    }

    // ========== Installed Plugins Operations ==========

    /**
     * Get installed plugins from settings.json
     */
    async getInstalledPlugins(projectPath?: string): Promise<InstalledPlugin[]> {
        const basePath = projectPath || this.basePath;
        const settingsPath = path.join(basePath, '.claude', 'settings.json');

        if (!fs.existsSync(settingsPath)) {
            return [];
        }

        try {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            const enabledPlugins = settings.enabledPlugins || {};
            const result: InstalledPlugin[] = [];

            for (const [pluginKey, enabled] of Object.entries(enabledPlugins)) {
                // Parse plugin key: "pluginName@marketplaceName"
                const match = pluginKey.match(/^(.+)@(.+)$/);
                if (match) {
                    const [, pluginName, marketplaceName] = match;

                    // Try to get plugin info from marketplace
                    const catalog = await this.fetchMarketplace(marketplaceName);
                    const pluginInfo = catalog?.plugins.find(p => p.name === pluginName);

                    result.push({
                        name: pluginName,
                        marketplace: marketplaceName,
                        enabled: Boolean(enabled),
                        source: pluginInfo?.source || { type: 'github' }
                    });
                }
            }

            return result;
        } catch (error) {
            console.error('Error reading installed plugins:', error);
            return [];
        }
    }

    /**
     * Install a plugin (add to enabledPlugins in settings.json)
     */
    async installPlugin(pluginName: string, marketplaceName: string, projectPath?: string): Promise<void> {
        const basePath = projectPath || this.basePath;
        const claudeDir = path.join(basePath, '.claude');
        const settingsPath = path.join(claudeDir, 'settings.json');

        // Ensure .claude directory exists
        if (!fs.existsSync(claudeDir)) {
            fs.mkdirSync(claudeDir, { recursive: true });
        }

        // Load or create settings
        let settings: Record<string, unknown> = {};
        if (fs.existsSync(settingsPath)) {
            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        }

        // Initialize enabledPlugins if needed
        if (!settings.enabledPlugins) {
            settings.enabledPlugins = {};
        }

        // Add the plugin
        const pluginKey = `${pluginName}@${marketplaceName}`;
        (settings.enabledPlugins as Record<string, boolean>)[pluginKey] = true;

        // Add marketplace to extraKnownMarketplaces if not known
        if (!KNOWN_MARKETPLACES[marketplaceName]) {
            if (!settings.extraKnownMarketplaces) {
                settings.extraKnownMarketplaces = [];
            }
            const extras = settings.extraKnownMarketplaces as Array<{ name: string; source: unknown }>;
            if (!extras.find(e => e.name === marketplaceName)) {
                // We'd need to know the source - skip for now
                console.warn(`Marketplace ${marketplaceName} source not known, plugin may not work`);
            }
        }

        // Save settings
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        this._onPluginsChanged.fire();
    }

    /**
     * Uninstall a plugin (remove from enabledPlugins)
     */
    async uninstallPlugin(pluginName: string, marketplaceName: string, projectPath?: string): Promise<void> {
        const basePath = projectPath || this.basePath;
        const settingsPath = path.join(basePath, '.claude', 'settings.json');

        if (!fs.existsSync(settingsPath)) {
            return;
        }

        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        if (settings.enabledPlugins) {
            const pluginKey = `${pluginName}@${marketplaceName}`;
            delete settings.enabledPlugins[pluginKey];
        }

        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        this._onPluginsChanged.fire();
    }

    /**
     * Enable/disable a plugin
     */
    async setPluginEnabled(pluginName: string, marketplaceName: string, enabled: boolean, projectPath?: string): Promise<void> {
        const basePath = projectPath || this.basePath;
        const settingsPath = path.join(basePath, '.claude', 'settings.json');

        if (!fs.existsSync(settingsPath)) {
            if (enabled) {
                await this.installPlugin(pluginName, marketplaceName, projectPath);
            }
            return;
        }

        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        if (!settings.enabledPlugins) {
            settings.enabledPlugins = {};
        }

        const pluginKey = `${pluginName}@${marketplaceName}`;
        settings.enabledPlugins[pluginKey] = enabled;

        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        this._onPluginsChanged.fire();
    }

    // ========== Plugin Creation ==========

    /**
     * Create a new plugin from template
     */
    async createPlugin(options: PluginCreationOptions): Promise<string> {
        const pluginDir = path.join(options.outputPath, `tk-claude-plugin-${options.name}`);

        // Create directory structure
        fs.mkdirSync(path.join(pluginDir, '.claude-plugin'), { recursive: true });

        if (options.components.commands) {
            fs.mkdirSync(path.join(pluginDir, 'commands'), { recursive: true });
        }
        if (options.components.hooks) {
            fs.mkdirSync(path.join(pluginDir, 'hooks'), { recursive: true });
            fs.mkdirSync(path.join(pluginDir, 'scripts'), { recursive: true });
        }
        if (options.components.skills) {
            fs.mkdirSync(path.join(pluginDir, 'skills', `${options.name}-skill`), { recursive: true });
        }
        if (options.components.agents) {
            fs.mkdirSync(path.join(pluginDir, 'agents'), { recursive: true });
        }

        // Create plugin.json
        const pluginJson = {
            name: `tk-${options.name}`,
            version: '1.0.0',
            description: options.description,
            ...(options.components.commands && { commands: './commands' }),
            ...(options.components.hooks && { hooks: './hooks/hooks.json' }),
            ...(options.components.skills && { skills: './skills' }),
            ...(options.components.agents && { agents: './agents' })
        };

        fs.writeFileSync(
            path.join(pluginDir, '.claude-plugin', 'plugin.json'),
            JSON.stringify(pluginJson, null, 2)
        );

        // Create template files based on components
        if (options.components.commands) {
            fs.writeFileSync(
                path.join(pluginDir, 'commands', 'example.md'),
                `# Example Command

Example command for ${options.name} plugin.

## Instructions

Add your command instructions here.

## Arguments

- \`$ARGUMENTS\` - Arguments passed to the command
`
            );
        }

        if (options.components.hooks) {
            fs.writeFileSync(
                path.join(pluginDir, 'hooks', 'hooks.json'),
                JSON.stringify({
                    PreToolUse: [],
                    PostToolUse: []
                }, null, 2)
            );
        }

        if (options.components.skills) {
            fs.writeFileSync(
                path.join(pluginDir, 'skills', `${options.name}-skill`, 'SKILL.md'),
                `# ${options.name} Skill

${options.description}

## Instructions

Add your skill instructions here.
`
            );
        }

        if (options.components.agents) {
            fs.writeFileSync(
                path.join(pluginDir, 'agents', 'assistant.md'),
                `# ${options.name} Assistant

An agent specialized in ${options.description.toLowerCase()}.

## Role

Describe the agent's role and capabilities here.

## Capabilities

- Capability 1
- Capability 2

## Constraints

- Constraint 1
- Constraint 2
`
            );
        }

        // Create README.md
        fs.writeFileSync(
            path.join(pluginDir, 'README.md'),
            `# tk-${options.name}

${options.description}

## Features

${options.components.hooks ? '### Hooks\n\n- Add your hooks description here\n\n' : ''}
${options.components.commands ? '### Commands\n\n| Command | Description |\n|---------|-------------|\n| \\`/example\\` | Example command |\n\n' : ''}
${options.components.skills ? '### Skills\n\n- **' + options.name + '-skill**: Add description here\n\n' : ''}
${options.components.agents ? '### Agents\n\n- **assistant**: Add description here\n\n' : ''}

## Installation

Add to your project's \`.claude/settings.json\`:

\`\`\`json
{
  "extraKnownMarketplaces": [
    {
      "name": "${options.marketplace}",
      "source": {
        "type": "github",
        "repo": "thinkube/${options.marketplace === 'thinkube-platform' ? 'thinkube-claude-marketplace-platform' : 'thinkube-claude-marketplace'}"
      }
    }
  ],
  "enabledPlugins": {
    "tk-${options.name}@${options.marketplace}": true
  }
}
\`\`\`
`
        );

        return pluginDir;
    }

    /**
     * Detect if current workspace is a plugin folder
     */
    isPluginFolder(folderPath: string): boolean {
        return fs.existsSync(path.join(folderPath, '.claude-plugin', 'plugin.json'));
    }

    /**
     * Get plugin info from a plugin folder
     */
    getPluginInfo(folderPath: string): { name: string; version: string; description: string } | undefined {
        const pluginJsonPath = path.join(folderPath, '.claude-plugin', 'plugin.json');
        if (!fs.existsSync(pluginJsonPath)) {
            return undefined;
        }

        try {
            const content = fs.readFileSync(pluginJsonPath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            console.error('Error reading plugin.json:', error);
            return undefined;
        }
    }

    // ========== Plugin Suggestion ==========

    /**
     * Suggest plugins based on project analysis
     */
    async suggestPlugins(projectPath?: string): Promise<{ plugin: PluginInfo; marketplace: string; reason: string }[]> {
        const basePath = projectPath || this.basePath;
        const suggestions: { plugin: PluginInfo; marketplace: string; reason: string }[] = [];

        // Check for project markers
        const hasAnsible = fs.existsSync(path.join(basePath, 'ansible')) ||
                         fs.existsSync(path.join(basePath, 'playbooks')) ||
                         fs.existsSync(path.join(basePath, 'roles'));

        const hasKubernetes = fs.existsSync(path.join(basePath, 'k8s')) ||
                            fs.existsSync(path.join(basePath, 'kubernetes')) ||
                            fs.existsSync(path.join(basePath, 'helm'));

        const hasFastAPI = fs.existsSync(path.join(basePath, 'main.py')) &&
                         fs.existsSync(path.join(basePath, 'requirements.txt'));

        const hasReact = fs.existsSync(path.join(basePath, 'package.json')) &&
                        fs.existsSync(path.join(basePath, 'src', 'App.tsx'));

        const hasJupyter = fs.existsSync(path.join(basePath, '*.ipynb'));

        // Get available plugins
        const availablePlugins = await this.getAvailablePlugins();
        const installedPlugins = await this.getInstalledPlugins(basePath);

        // Filter out already installed plugins
        const isInstalled = (name: string, marketplace: string) =>
            installedPlugins.some(p => p.name === name && p.marketplace === marketplace);

        for (const { plugin, marketplace } of availablePlugins) {
            if (isInstalled(plugin.name, marketplace)) continue;

            if (plugin.name === 'tk-ansible' && hasAnsible) {
                suggestions.push({
                    plugin,
                    marketplace,
                    reason: 'Detected Ansible files in project'
                });
            }

            if (plugin.name === 'tk-kubernetes' && hasKubernetes) {
                suggestions.push({
                    plugin,
                    marketplace,
                    reason: 'Detected Kubernetes/Helm files in project'
                });
            }

            if (plugin.name === 'tk-fastapi' && hasFastAPI) {
                suggestions.push({
                    plugin,
                    marketplace,
                    reason: 'Detected FastAPI project structure'
                });
            }

            if (plugin.name === 'tk-react' && hasReact) {
                suggestions.push({
                    plugin,
                    marketplace,
                    reason: 'Detected React project structure'
                });
            }

            if (plugin.name === 'tk-jupyterhub' && hasJupyter) {
                suggestions.push({
                    plugin,
                    marketplace,
                    reason: 'Detected Jupyter notebooks in project'
                });
            }
        }

        return suggestions;
    }

    /**
     * Clear marketplace cache
     */
    clearCache(): void {
        this.marketplaceCache.clear();
    }

    /**
     * Update base path (when workspace changes)
     */
    setBasePath(basePath: string): void {
        this.basePath = basePath;
        this.clearCache();
    }
}
