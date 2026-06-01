/**
 * ConfigTreeProvider - Multi-root tree for Claude Code Configuration
 *
 * Tree structure:
 *   Global (~/.claude)
 *     ├── Settings (opens file)
 *     ├── Installed Plugins
 *     ├── MCP Servers (from settings.json mcpServers)
 *     ├── Hooks
 *     └── Permissions
 *   Platform
 *     ├── project-a ✓
 *     │   ├── Project Config
 *     │   ├── Hooks (N)
 *     │   ├── Commands / Skills / Agents
 *     │   ├── MCP Servers (from .mcp.json)
 *     │   └── Permissions
 *     └── project-b (no config)
 *   Apps
 *     └── ...
 *   Templates
 *     └── ...
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { ClaudeConfigService } from "../../services/ClaudeConfigService";
import { PluginService, InstalledPlugin } from "../../services/PluginService";
import { Hook, HookEvent, HOOK_EVENTS } from "../../models/Hook";
import { Command } from "../../models/Command";
import { Skill } from "../../models/Skill";
import { Agent } from "../../models/Agent";
import { McpServer, isHttpServer } from "../../models/McpServer";

export type ConfigItemType =
  | "scope-section"
  | "project-node"
  | "project-node-unconfigured"
  | "plugins-section"
  | "plugin"
  | "browse-marketplace"
  | "project-config-section"
  | "claude-md"
  | "settings-json"
  | "hooks-section"
  | "commands-section"
  | "skills-section"
  | "agents-section"
  | "mcp-section"
  | "permissions-section"
  | "hook-event"
  | "hook-event-empty"
  | "hook"
  | "command"
  | "skill"
  | "agent"
  | "mcp-server"
  | "permission-allow"
  | "permission-deny"
  | "permission-ask"
  | "permission-item"
  | "init-action";

interface WorkspaceSection {
  label: string;
  rootPath: string;
  icon: string;
}

const WORKSPACE_SECTIONS: WorkspaceSection[] = [
  {
    label: "Platform",
    rootPath: "/home/thinkube/thinkube-platform",
    icon: "server",
  },
  { label: "Apps", rootPath: "/home/thinkube/apps", icon: "code" },
  {
    label: "Templates",
    rootPath: "/home/thinkube/user-templates",
    icon: "file-symlink-directory",
  },
];

const GLOBAL_HOME = process.env.HOME || "/home/thinkube";

export class ConfigTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly itemType: ConfigItemType,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly data?:
      | Hook
      | Command
      | Skill
      | Agent
      | McpServer
      | InstalledPlugin
      | string
      | WorkspaceSection,
    public readonly parentType?: ConfigItemType,
    public readonly projectPath?: string,
  ) {
    super(label, collapsibleState);
    this.contextValue = itemType;
    this.setIconAndTooltip();
  }

  private setIconAndTooltip(): void {
    switch (this.itemType) {
      case "scope-section":
        if (
          this.data &&
          typeof this.data === "object" &&
          "rootPath" in this.data
        ) {
          const section = this.data as WorkspaceSection;
          this.iconPath = new vscode.ThemeIcon(section.icon);
          this.tooltip = section.rootPath;
        } else {
          this.iconPath = new vscode.ThemeIcon("home");
          this.tooltip = "Global Claude Code configuration";
        }
        break;
      case "project-node":
        this.iconPath = new vscode.ThemeIcon("folder-opened");
        this.tooltip = this.projectPath || "";
        break;
      case "project-node-unconfigured":
        this.iconPath = new vscode.ThemeIcon("folder");
        this.tooltip = `${this.projectPath}\n(no Claude config)`;
        this.description = "(no config)";
        break;
      case "init-action":
        this.iconPath = new vscode.ThemeIcon("add");
        this.tooltip = "Initialize Claude configuration for this project";
        break;
      case "plugins-section":
        this.iconPath = new vscode.ThemeIcon("extensions");
        this.tooltip = "Installed Claude Code plugins";
        break;
      case "plugin":
        if (this.data) {
          const plugin = this.data as InstalledPlugin;
          this.iconPath = new vscode.ThemeIcon(
            plugin.enabled ? "check" : "circle-outline",
          );
          this.tooltip = `${plugin.name}@${plugin.marketplace}\nEnabled: ${plugin.enabled}`;
          this.description = plugin.enabled ? "enabled" : "disabled";
        }
        break;
      case "browse-marketplace":
        this.iconPath = new vscode.ThemeIcon("add");
        this.tooltip = "Browse and install plugins from marketplace";
        this.command = {
          command: "thinkube.browsePlugins",
          title: "Browse Marketplace",
        };
        break;
      case "project-config-section":
        this.iconPath = new vscode.ThemeIcon("file-code");
        this.tooltip = "Project configuration files";
        break;
      case "claude-md":
        this.iconPath = new vscode.ThemeIcon("markdown");
        this.tooltip = "Project instructions for Claude";
        break;
      case "settings-json":
        this.iconPath = new vscode.ThemeIcon("settings-gear");
        this.tooltip = "Claude Code settings";
        break;
      case "hooks-section":
        this.iconPath = new vscode.ThemeIcon("zap");
        this.tooltip = "Event hooks for tool execution";
        break;
      case "commands-section":
        this.iconPath = new vscode.ThemeIcon("terminal");
        this.tooltip = "Custom slash commands";
        break;
      case "skills-section":
        this.iconPath = new vscode.ThemeIcon("lightbulb");
        this.tooltip = "Reusable capabilities";
        break;
      case "agents-section":
        this.iconPath = new vscode.ThemeIcon("person");
        this.tooltip = "Subagent definitions";
        break;
      case "mcp-section":
        this.iconPath = new vscode.ThemeIcon("plug");
        this.tooltip = "MCP Server configurations";
        break;
      case "permissions-section":
        this.iconPath = new vscode.ThemeIcon("shield");
        this.tooltip = "Tool permissions";
        break;
      case "hook-event":
        this.iconPath = new vscode.ThemeIcon("symbol-event");
        break;
      case "hook-event-empty":
        this.iconPath = new vscode.ThemeIcon("symbol-event");
        this.description = "(click to generate)";
        this.tooltip = `No hooks configured for ${this.label}. Click to generate with Claude.`;
        break;
      case "hook":
        if (this.data) {
          const hook = this.data as Hook;
          const typeIcons: Record<string, string> = {
            command: "terminal",
            http: "cloud",
            prompt: "comment",
            agent: "robot",
          };
          this.iconPath = new vscode.ThemeIcon(
            typeIcons[hook.hookType] || "symbol-function",
          );
          const detail =
            hook.command || hook.url || hook.prompt || hook.agent || "";
          this.tooltip = `Type: ${hook.hookType}\nMatcher: ${hook.matcher}\nDetail: ${detail}\n\nClick to open settings.json`;
          // Open settings.json on click
          if (this.projectPath) {
            const settingsPath = path.join(
              this.projectPath,
              ".claude",
              "settings.json",
            );
            this.command = {
              command: "vscode.open",
              title: "Open Settings",
              arguments: [vscode.Uri.file(settingsPath)],
            };
          }
        } else {
          this.iconPath = new vscode.ThemeIcon("symbol-function");
        }
        break;
      case "command":
        this.iconPath = new vscode.ThemeIcon("symbol-method");
        if (this.data) {
          const cmd = this.data as Command;
          this.tooltip = cmd.description || "No description";
          this.command = {
            command: "thinkube.openCommand",
            title: "Open Command",
            arguments: [cmd],
          };
        }
        break;
      case "skill":
        this.iconPath = new vscode.ThemeIcon("symbol-class");
        if (this.data) {
          const skill = this.data as Skill;
          this.tooltip = skill.description || "No description";
          this.command = {
            command: "thinkube.openSkill",
            title: "Open Skill",
            arguments: [skill],
          };
        }
        break;
      case "agent":
        this.iconPath = new vscode.ThemeIcon("hubot");
        if (this.data) {
          const agent = this.data as Agent;
          this.tooltip = agent.description || "No description";
          this.command = {
            command: "thinkube.openAgent",
            title: "Open Agent",
            arguments: [agent],
          };
        }
        break;
      case "mcp-server":
        if (this.data) {
          const server = this.data as McpServer;
          if (isHttpServer(server.config)) {
            this.iconPath = new vscode.ThemeIcon("cloud");
            this.tooltip = `Type: HTTP\nURL: ${server.config.url}\n\nClick to open config`;
          } else {
            this.iconPath = new vscode.ThemeIcon("terminal");
            this.tooltip = `Type: stdio\nCommand: ${server.config.command}${server.config.args?.length ? "\nArgs: " + server.config.args.join(" ") : ""}\n\nClick to open config`;
          }
          // Open the relevant config file on click
          if (this.projectPath) {
            const GLOBAL = process.env.HOME || "/home/thinkube";
            const configFile =
              this.projectPath === GLOBAL
                ? path.join(GLOBAL, ".claude", "settings.json")
                : path.join(this.projectPath, ".mcp.json");
            this.command = {
              command: "vscode.open",
              title: "Open Config",
              arguments: [vscode.Uri.file(configFile)],
            };
          }
        } else {
          this.iconPath = new vscode.ThemeIcon("circle-outline");
        }
        break;
      case "permission-allow":
        this.iconPath = new vscode.ThemeIcon(
          "check",
          new vscode.ThemeColor("charts.green"),
        );
        this.tooltip = "Allowed tools/commands";
        break;
      case "permission-deny":
        this.iconPath = new vscode.ThemeIcon(
          "x",
          new vscode.ThemeColor("charts.red"),
        );
        this.tooltip = "Denied tools/commands";
        break;
      case "permission-ask":
        this.iconPath = new vscode.ThemeIcon(
          "question",
          new vscode.ThemeColor("charts.yellow"),
        );
        this.tooltip = "Tools requiring confirmation";
        break;
      case "permission-item":
        this.iconPath = new vscode.ThemeIcon("symbol-string");
        break;
    }
  }
}

export class ConfigTreeProvider implements vscode.TreeDataProvider<ConfigTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    ConfigTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private pluginService: PluginService;
  private projectCache: Map<
    string,
    { name: string; path: string; hasConfig: boolean }[]
  > = new Map();

  constructor(private configService: ClaudeConfigService) {
    this.pluginService = new PluginService(GLOBAL_HOME);

    configService.onConfigChanged(() => {
      this.refresh();
    });

    this.pluginService.onPluginsChanged(() => {
      this.refresh();
    });
  }

  updateConfigService(newService: ClaudeConfigService): void {
    this.configService = newService;

    newService.onConfigChanged(() => {
      this.refresh();
    });

    this.refresh();
  }

  getPluginService(): PluginService {
    return this.pluginService;
  }

  refresh(): void {
    this.projectCache.clear();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ConfigTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ConfigTreeItem): Promise<ConfigTreeItem[]> {
    if (!element) {
      return this.getRootChildren();
    }

    switch (element.itemType) {
      case "scope-section":
        if (
          element.data &&
          typeof element.data === "object" &&
          "rootPath" in element.data
        ) {
          return this.getWorkspaceSectionChildren(
            element.data as WorkspaceSection,
          );
        }
        return this.getGlobalChildren();

      case "project-node":
        return this.getProjectNodeChildren(element.projectPath!);
      case "project-node-unconfigured":
        return this.getUnconfiguredProjectChildren(element.projectPath!);

      case "plugins-section":
        return this.getPluginsChildren();
      case "project-config-section":
        return this.getProjectConfigChildren(element.projectPath!);
      case "hooks-section":
        return this.getHooksChildren(element.projectPath!);
      case "hook-event":
        return this.getHookEventChildren(
          element.label as HookEvent,
          element.projectPath!,
        );
      case "commands-section":
        return this.getCommandsChildren(element.projectPath!);
      case "skills-section":
        return this.getSkillsChildren(element.projectPath!);
      case "agents-section":
        return this.getAgentsChildren(element.projectPath!);
      case "mcp-section":
        return this.getMcpChildren(element.projectPath!);
      case "permissions-section":
        return this.getPermissionsChildren(element.projectPath!);
      case "permission-allow":
      case "permission-deny":
      case "permission-ask":
        return this.getPermissionItemsChildren(
          element.itemType,
          element.projectPath!,
        );
      default:
        return [];
    }
  }

  // ========== Root ==========

  private getRootChildren(): ConfigTreeItem[] {
    const items: ConfigTreeItem[] = [];

    // Global scope
    const globalItem = new ConfigTreeItem(
      "Global",
      "scope-section",
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    globalItem.description = "~/.claude";
    items.push(globalItem);

    // Workspace sections
    for (const section of WORKSPACE_SECTIONS) {
      if (fs.existsSync(section.rootPath)) {
        const item = new ConfigTreeItem(
          section.label,
          "scope-section",
          vscode.TreeItemCollapsibleState.Collapsed,
          section,
        );
        items.push(item);
      }
    }

    return items;
  }

  // ========== Global scope ==========

  private async getGlobalChildren(): Promise<ConfigTreeItem[]> {
    const globalPath = GLOBAL_HOME;
    const settingsPath = path.join(globalPath, ".claude", "settings.json");
    const items: ConfigTreeItem[] = [];

    // Settings file link
    if (fs.existsSync(settingsPath)) {
      const settingsItem = new ConfigTreeItem(
        "settings.json",
        "settings-json",
        vscode.TreeItemCollapsibleState.None,
        undefined,
        undefined,
        globalPath,
      );
      settingsItem.command = {
        command: "vscode.open",
        title: "Open Global Settings",
        arguments: [vscode.Uri.file(settingsPath)],
      };
      items.push(settingsItem);
    }

    // Plugins
    items.push(
      new ConfigTreeItem(
        "Installed Plugins",
        "plugins-section",
        vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        undefined,
        globalPath,
      ),
    );

    // Global MCP Servers (from settings.json mcpServers)
    const mcpItem = new ConfigTreeItem(
      "MCP Entries (.claude/.mcp.json)",
      "mcp-section",
      vscode.TreeItemCollapsibleState.Collapsed,
      undefined,
      undefined,
      globalPath,
    );
    items.push(mcpItem);

    // Global Hooks
    const hooksItem = new ConfigTreeItem(
      "Hooks",
      "hooks-section",
      vscode.TreeItemCollapsibleState.Collapsed,
      undefined,
      undefined,
      globalPath,
    );
    items.push(hooksItem);

    // Global Permissions
    items.push(
      new ConfigTreeItem(
        "Permissions",
        "permissions-section",
        vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        undefined,
        globalPath,
      ),
    );

    return items;
  }

  // ========== Workspace sections ==========

  private getWorkspaceSectionChildren(
    section: WorkspaceSection,
  ): ConfigTreeItem[] {
    const items: ConfigTreeItem[] = [];
    const rootPath = section.rootPath;

    // Workspace-level config (shared across all repos in this section)
    const hasWorkspaceClaudeMd = fs.existsSync(
      path.join(rootPath, "CLAUDE.md"),
    );
    const hasWorkspaceSettings = fs.existsSync(
      path.join(rootPath, ".claude", "settings.json"),
    );
    if (hasWorkspaceClaudeMd || hasWorkspaceSettings) {
      const wsConfig = new ConfigTreeItem(
        "Workspace Config",
        "project-config-section",
        vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        undefined,
        rootPath,
      );
      wsConfig.description = "shared across repos";
      wsConfig.tooltip = `Inherited by all projects under ${rootPath}`;
      wsConfig.iconPath = new vscode.ThemeIcon("library");
      items.push(wsConfig);
    }

    // Individual projects
    const projects = this.scanProjects(section.rootPath);
    for (const proj of projects) {
      const itemType = proj.hasConfig
        ? "project-node"
        : "project-node-unconfigured";
      const item = new ConfigTreeItem(
        proj.name,
        itemType,
        vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        undefined,
        proj.path,
      );
      if (proj.hasConfig) {
        item.description = "✓";
      }
      items.push(item);
    }

    if (projects.length === 0) {
      items.push(
        new ConfigTreeItem(
          "No projects found",
          "init-action",
          vscode.TreeItemCollapsibleState.None,
        ),
      );
    }

    return items;
  }

  private scanProjects(
    rootPath: string,
  ): { name: string; path: string; hasConfig: boolean }[] {
    const cached = this.projectCache.get(rootPath);
    if (cached) return cached;

    const results: { name: string; path: string; hasConfig: boolean }[] = [];
    try {
      const entries = fs.readdirSync(rootPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          const fullPath = path.join(rootPath, entry.name);
          if (fs.existsSync(path.join(fullPath, ".git"))) {
            const hasConfig =
              fs.existsSync(path.join(fullPath, ".claude")) ||
              fs.existsSync(path.join(fullPath, "CLAUDE.md"));
            results.push({ name: entry.name, path: fullPath, hasConfig });
          } else {
            // Scan one level deeper for categorized structures (e.g. core/, templates/)
            try {
              const subEntries = fs.readdirSync(fullPath, {
                withFileTypes: true,
              });
              for (const subEntry of subEntries) {
                if (subEntry.isDirectory() && !subEntry.name.startsWith(".")) {
                  const subFullPath = path.join(fullPath, subEntry.name);
                  if (fs.existsSync(path.join(subFullPath, ".git"))) {
                    const hasConfig =
                      fs.existsSync(path.join(subFullPath, ".claude")) ||
                      fs.existsSync(path.join(subFullPath, "CLAUDE.md"));
                    results.push({
                      name: `${entry.name}/${subEntry.name}`,
                      path: subFullPath,
                      hasConfig,
                    });
                  }
                }
              }
            } catch {
              // ignore read errors on subdirectory
            }
          }
        }
      }
    } catch {
      // ignore read errors
    }

    results.sort((a, b) => {
      if (a.hasConfig !== b.hasConfig) return a.hasConfig ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    this.projectCache.set(rootPath, results);
    return results;
  }

  // ========== Project node ==========

  private async getProjectNodeChildren(
    projectPath: string,
  ): Promise<ConfigTreeItem[]> {
    const items: ConfigTreeItem[] = [];
    const pp = projectPath;

    items.push(
      new ConfigTreeItem(
        "Project Config",
        "project-config-section",
        vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        undefined,
        pp,
      ),
    );

    // Hooks with count
    const hooks = await this.configService.getHooks(undefined, pp);
    const hooksItem = new ConfigTreeItem(
      "Hooks",
      "hooks-section",
      vscode.TreeItemCollapsibleState.Collapsed,
      undefined,
      undefined,
      pp,
    );
    if (hooks.length > 0) hooksItem.description = `(${hooks.length})`;
    items.push(hooksItem);

    // Commands with count
    const commands = await this.configService.getCommands(pp);
    const cmdsItem = new ConfigTreeItem(
      "Commands",
      "commands-section",
      vscode.TreeItemCollapsibleState.Collapsed,
      undefined,
      undefined,
      pp,
    );
    if (commands.length > 0) cmdsItem.description = `(${commands.length})`;
    items.push(cmdsItem);

    // Skills with count
    const skills = await this.configService.getSkills(pp);
    const skillsItem = new ConfigTreeItem(
      "Skills",
      "skills-section",
      vscode.TreeItemCollapsibleState.Collapsed,
      undefined,
      undefined,
      pp,
    );
    if (skills.length > 0) skillsItem.description = `(${skills.length})`;
    items.push(skillsItem);

    // Agents with count
    const agents = await this.configService.getAgents(pp);
    const agentsItem = new ConfigTreeItem(
      "Agents",
      "agents-section",
      vscode.TreeItemCollapsibleState.Collapsed,
      undefined,
      undefined,
      pp,
    );
    if (agents.length > 0) agentsItem.description = `(${agents.length})`;
    items.push(agentsItem);

    // MCP Servers with count
    const servers = await this.configService.getMcpServers(pp);
    const mcpItem = new ConfigTreeItem(
      "MCP Entries (.claude/.mcp.json)",
      "mcp-section",
      vscode.TreeItemCollapsibleState.Collapsed,
      undefined,
      undefined,
      pp,
    );
    if (servers.length > 0) mcpItem.description = `(${servers.length})`;
    items.push(mcpItem);

    // Permissions
    items.push(
      new ConfigTreeItem(
        "Permissions",
        "permissions-section",
        vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        undefined,
        pp,
      ),
    );

    return items;
  }

  private getUnconfiguredProjectChildren(
    projectPath: string,
  ): ConfigTreeItem[] {
    // A single entry point for project setup. `thinkube.initializeConfig`
    // presents a quick-pick with every path (Claude Init / Quick Setup /
    // Full Setup with Claude / Empty config), so we don't duplicate those
    // as separate rows here.
    const setupItem = new ConfigTreeItem(
      "Set up Claude config…",
      "init-action",
      vscode.TreeItemCollapsibleState.None,
      projectPath,
      undefined,
      projectPath,
    );
    setupItem.description = "Claude init, quick setup, or empty";
    setupItem.command = {
      command: "thinkube.initializeConfig",
      title: "Set up Claude config",
      arguments: [projectPath],
    };
    setupItem.tooltip =
      "Set up Claude Code for this project — Claude init, quick setup (detect tools), full Claude setup, or an empty .claude/ folder";
    setupItem.iconPath = new vscode.ThemeIcon("new-folder");

    return [setupItem];
  }

  // ========== Plugins ==========

  private async getPluginsChildren(): Promise<ConfigTreeItem[]> {
    const plugins = await this.pluginService.getInstalledPlugins();
    const items: ConfigTreeItem[] = [];

    for (const plugin of plugins) {
      items.push(
        new ConfigTreeItem(
          plugin.name,
          "plugin",
          vscode.TreeItemCollapsibleState.None,
          plugin,
        ),
      );
    }

    items.push(
      new ConfigTreeItem(
        "+ Browse Marketplace...",
        "browse-marketplace",
        vscode.TreeItemCollapsibleState.None,
      ),
    );

    return items;
  }

  // ========== Project Config files ==========

  private getProjectConfigChildren(projectPath: string): ConfigTreeItem[] {
    const items: ConfigTreeItem[] = [];

    const addFileEntry = (
      label: string,
      filePath: string,
      itemType: ConfigItemType,
    ) => {
      if (fs.existsSync(filePath)) {
        const item = new ConfigTreeItem(
          label,
          itemType,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          undefined,
          projectPath,
        );
        item.command = {
          command: "vscode.open",
          title: `Open ${label}`,
          arguments: [vscode.Uri.file(filePath)],
        };
        items.push(item);
      }
    };

    const claudeMdExists = fs.existsSync(path.join(projectPath, "CLAUDE.md"));
    if (claudeMdExists) {
      addFileEntry(
        "CLAUDE.md",
        path.join(projectPath, "CLAUDE.md"),
        "claude-md",
      );
    } else {
      const initItem = new ConfigTreeItem(
        "No CLAUDE.md",
        "init-action",
        vscode.TreeItemCollapsibleState.None,
        undefined,
        undefined,
        projectPath,
      );
      initItem.description = "open a Claude session and run /init";
      initItem.tooltip =
        "This project has no CLAUDE.md. Open a Claude session here (Explorer → Claude Code → Open Here) and run /init to generate one.";
      items.push(initItem);
    }
    addFileEntry(
      "CLAUDE.local.md",
      path.join(projectPath, "CLAUDE.local.md"),
      "claude-md",
    );
    addFileEntry(
      "settings.json",
      path.join(projectPath, ".claude", "settings.json"),
      "settings-json",
    );
    addFileEntry(
      "settings.local.json",
      path.join(projectPath, ".claude", "settings.local.json"),
      "settings-json",
    );
    addFileEntry(
      ".mcp.json",
      path.join(projectPath, ".mcp.json"),
      "settings-json",
    );

    return items;
  }

  // ========== Hooks ==========

  private async getHooksChildren(
    projectPath: string,
  ): Promise<ConfigTreeItem[]> {
    const allHooks = await this.configService.getHooks(undefined, projectPath);
    const eventsWithHooks = new Set(allHooks.map((h) => h.event));

    const items: ConfigTreeItem[] = [];

    for (const event of HOOK_EVENTS) {
      if (eventsWithHooks.has(event)) {
        items.push(
          new ConfigTreeItem(
            event,
            "hook-event",
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            undefined,
            projectPath,
          ),
        );
      }
    }

    for (const event of HOOK_EVENTS) {
      if (!eventsWithHooks.has(event)) {
        const item = new ConfigTreeItem(
          event,
          "hook-event-empty",
          vscode.TreeItemCollapsibleState.None,
          event,
          undefined,
          projectPath,
        );
        item.description = "no hook";
        items.push(item);
      }
    }

    return items;
  }

  private async getHookEventChildren(
    event: HookEvent,
    projectPath: string,
  ): Promise<ConfigTreeItem[]> {
    const hooks = await this.configService.getHooks(event, projectPath);
    if (hooks.length === 0) {
      return [
        new ConfigTreeItem(
          "No hooks configured",
          "hook",
          vscode.TreeItemCollapsibleState.None,
          undefined,
          undefined,
          projectPath,
        ),
      ];
    }
    return hooks.map((hook) => {
      const item = new ConfigTreeItem(
        hook.matcher || "*",
        "hook",
        vscode.TreeItemCollapsibleState.None,
        hook,
        undefined,
        projectPath,
      );
      item.description = `[${hook.hookType}]`;
      return item;
    });
  }

  // ========== Commands ==========

  private async getCommandsChildren(
    projectPath: string,
  ): Promise<ConfigTreeItem[]> {
    const commands = await this.configService.getCommands(projectPath);
    if (commands.length === 0) {
      return [
        new ConfigTreeItem(
          "No commands — use + to add",
          "command",
          vscode.TreeItemCollapsibleState.None,
          undefined,
          undefined,
          projectPath,
        ),
      ];
    }
    return commands.map(
      (cmd) =>
        new ConfigTreeItem(
          `/${cmd.name}`,
          "command",
          vscode.TreeItemCollapsibleState.None,
          cmd,
          undefined,
          projectPath,
        ),
    );
  }

  // ========== Skills ==========

  private async getSkillsChildren(
    projectPath: string,
  ): Promise<ConfigTreeItem[]> {
    const skills = await this.configService.getSkills(projectPath);
    if (skills.length === 0) {
      return [
        new ConfigTreeItem(
          "No skills — use + to add",
          "skill",
          vscode.TreeItemCollapsibleState.None,
          undefined,
          undefined,
          projectPath,
        ),
      ];
    }
    return skills.map(
      (skill) =>
        new ConfigTreeItem(
          skill.name,
          "skill",
          vscode.TreeItemCollapsibleState.None,
          skill,
          undefined,
          projectPath,
        ),
    );
  }

  // ========== Agents ==========

  private async getAgentsChildren(
    projectPath: string,
  ): Promise<ConfigTreeItem[]> {
    const agents = await this.configService.getAgents(projectPath);
    if (agents.length === 0) {
      return [
        new ConfigTreeItem(
          "No subagents — use + to add",
          "agent",
          vscode.TreeItemCollapsibleState.None,
          undefined,
          undefined,
          projectPath,
        ),
      ];
    }
    return agents.map(
      (agent) =>
        new ConfigTreeItem(
          agent.name,
          "agent",
          vscode.TreeItemCollapsibleState.None,
          agent,
          undefined,
          projectPath,
        ),
    );
  }

  // ========== MCP Servers ==========

  private async getMcpChildren(projectPath: string): Promise<ConfigTreeItem[]> {
    let servers: McpServer[];

    if (projectPath === GLOBAL_HOME) {
      servers = await this.configService.getGlobalMcpServers();
    } else {
      servers = await this.configService.getMcpServers(projectPath);
    }

    if (servers.length === 0) {
      if (projectPath === GLOBAL_HOME) {
        return [
          new ConfigTreeItem(
            "No MCP servers configured",
            "mcp-server",
            vscode.TreeItemCollapsibleState.None,
            undefined,
            undefined,
            projectPath,
          ),
        ];
      }
      return [
        new ConfigTreeItem(
          "No MCP servers — use + to add",
          "mcp-server",
          vscode.TreeItemCollapsibleState.None,
          undefined,
          undefined,
          projectPath,
        ),
      ];
    }
    return servers.map(
      (server) =>
        new ConfigTreeItem(
          server.name,
          "mcp-server",
          vscode.TreeItemCollapsibleState.None,
          server,
          undefined,
          projectPath,
        ),
    );
  }

  // ========== Permissions ==========

  private getPermissionsChildren(projectPath: string): ConfigTreeItem[] {
    return [
      new ConfigTreeItem(
        "Allow",
        "permission-allow",
        vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        undefined,
        projectPath,
      ),
      new ConfigTreeItem(
        "Deny",
        "permission-deny",
        vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        undefined,
        projectPath,
      ),
      new ConfigTreeItem(
        "Ask",
        "permission-ask",
        vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        undefined,
        projectPath,
      ),
    ];
  }

  private async getPermissionItemsChildren(
    type: "permission-allow" | "permission-deny" | "permission-ask",
    projectPath: string,
  ): Promise<ConfigTreeItem[]> {
    const permissions = await this.configService.getPermissions(projectPath);
    let items: string[] = [];

    switch (type) {
      case "permission-allow":
        items = permissions.allow;
        break;
      case "permission-deny":
        items = permissions.deny;
        break;
      case "permission-ask":
        items = permissions.ask;
        break;
    }

    if (items.length === 0) {
      return [
        new ConfigTreeItem(
          "(empty)",
          "permission-item",
          vscode.TreeItemCollapsibleState.None,
          undefined,
          undefined,
          projectPath,
        ),
      ];
    }

    return items.map(
      (item) =>
        new ConfigTreeItem(
          item,
          "permission-item",
          vscode.TreeItemCollapsibleState.None,
          item,
          type,
          projectPath,
        ),
    );
  }
}
