/**
 * Claude Code configuration commands (thinkube.* namespace).
 *
 * Registers the CRUD commands the config tree uses: hooks, slash commands,
 * skills, subagents, permissions, MCP-entry management, "Generate with
 * Claude" launchers, plugin browser/installer, project initialization.
 *
 * Extracted from src/extension.ts in chunk 1 (no behavior change). All state
 * (configService, treeProvider, claudeLauncher, active-context getter) is
 * injected via a single `deps` parameter so this module stays pure.
 */
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import { ClaudeConfigService } from "../services/ClaudeConfigService";
import {
  ConfigTreeProvider,
  ConfigTreeItem,
} from "../views/sidebar/ConfigTreeProvider";
import {
  PluginCreationWizard,
  quickCreatePlugin,
} from "../views/wizards/PluginCreationWizard";
import { Command } from "../models/Command";
import { Skill } from "../models/Skill";
import { Agent } from "../models/Agent";

export interface ConfigCommandsDeps {
  configService: ClaudeConfigService;
  treeProvider: ConfigTreeProvider;
  getCurrentActiveContext(): string | undefined;
  updateActiveContext(newPath?: string): Promise<void>;
  updateConfigContext(): Promise<void>;
}

export function registerConfigCommands(
  context: vscode.ExtensionContext,
  deps: ConfigCommandsDeps,
): void {
  const {
    configService,
    treeProvider,
    updateActiveContext,
    updateConfigContext,
  } = deps;
  const currentActiveContext = () => deps.getCurrentActiveContext();

  // Refresh configuration
  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube.refreshConfig", async () => {
      await updateConfigContext();
      treeProvider.refresh();
    }),
  );

  // Switch Project — sets active project for ChatPanel
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.switchProject",
      async (projectPath?: string) => {
        if (projectPath) {
          await updateActiveContext(projectPath);
          return;
        }

        // Show quick pick of all projects
        const sections = [
          { path: "/home/thinkube/thinkube-platform", prefix: "Platform" },
          { path: "/home/thinkube/apps", prefix: "Apps" },
          { path: "/home/thinkube/user-templates", prefix: "Templates" },
        ];

        const items: vscode.QuickPickItem[] = [];
        for (const section of sections) {
          try {
            const entries = fs.readdirSync(section.path, {
              withFileTypes: true,
            });
            for (const entry of entries) {
              if (entry.isDirectory() && !entry.name.startsWith(".")) {
                const fullPath = path.join(section.path, entry.name);
                if (fs.existsSync(path.join(fullPath, ".git"))) {
                  const configured =
                    fs.existsSync(path.join(fullPath, ".claude")) ||
                    fs.existsSync(path.join(fullPath, "CLAUDE.md"));
                  items.push({
                    label: `${section.prefix}: ${entry.name}`,
                    description: configured ? "$(check)" : "(no config)",
                    detail: fullPath,
                  });
                } else {
                  // Scan one level deeper for categorized structures
                  try {
                    const subEntries = fs.readdirSync(fullPath, {
                      withFileTypes: true,
                    });
                    for (const subEntry of subEntries) {
                      if (
                        subEntry.isDirectory() &&
                        !subEntry.name.startsWith(".")
                      ) {
                        const subFullPath = path.join(fullPath, subEntry.name);
                        if (fs.existsSync(path.join(subFullPath, ".git"))) {
                          const configured =
                            fs.existsSync(path.join(subFullPath, ".claude")) ||
                            fs.existsSync(path.join(subFullPath, "CLAUDE.md"));
                          items.push({
                            label: `${section.prefix}: ${entry.name}/${subEntry.name}`,
                            description: configured
                              ? "$(check)"
                              : "(no config)",
                            detail: subFullPath,
                          });
                        }
                      }
                    }
                  } catch {
                    /* ignore */
                  }
                }
              }
            }
          } catch {
            /* ignore */
          }
        }

        const choice = await vscode.window.showQuickPick(items, {
          placeHolder: "Set active project (for chat analysis)",
          title: "Switch Active Project",
          matchOnDetail: true,
        });

        if (choice?.detail) {
          await updateActiveContext(choice.detail);
          vscode.window.showInformationMessage(
            `Active project: ${path.basename(choice.detail)}`,
          );
        }
      },
    ),
  );

  // Initialize Claude Config — accepts optional projectPath
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.initializeConfig",
      async (projectPath?: string) => {
        const targetPath = projectPath || currentActiveContext();
        if (!targetPath) {
          vscode.window.showErrorMessage("No project selected");
          return;
        }

        // Create an empty `.claude/` skeleton. From there the user adds
        // items manually (the Configuration tree's per-type "+ Add"), installs
        // the methodology bundle, or opens a Claude session ("Open Here") to
        // build it interactively. We no longer fork into Claude-driven
        // generation here — that surface was removed in the IA simplification.
        try {
          await configService.initializeClaudeConfig(targetPath);
          vscode.window.showInformationMessage(
            `Empty Claude config created in ${path.basename(targetPath)}`,
          );
          treeProvider.refresh();
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to initialize config: ${error}`,
          );
        }
      },
    ),
  );

  // Add Hook
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.addHook",
      async (item?: ConfigTreeItem) => {
        const projectPath = item?.projectPath || currentActiveContext();
        if (!projectPath) {
          vscode.window.showErrorMessage("No project selected");
          return;
        }

        const { HOOK_EVENTS } = await import("../models/Hook");

        const event = await vscode.window.showQuickPick([...HOOK_EVENTS], {
          placeHolder: "Select hook event",
        });
        if (!event) {
          return;
        }

        const hookType = await vscode.window.showQuickPick(
          [
            { label: "command", description: "Run a shell command" },
            { label: "http", description: "Send HTTP request" },
            { label: "prompt", description: "Inject a prompt" },
            { label: "agent", description: "Invoke an agent" },
          ],
          { placeHolder: "Select hook type" },
        );
        if (!hookType) {
          return;
        }

        const matcher = await vscode.window.showInputBox({
          prompt:
            'Enter tool matcher pattern (e.g., "Bash", "Edit", "*", or empty for non-tool events)',
          value: "",
        });
        if (matcher === undefined) {
          return;
        }

        try {
          const type = hookType.label as
            | "command"
            | "http"
            | "prompt"
            | "agent";
          if (type === "command") {
            const command = await vscode.window.showInputBox({
              prompt: "Enter command to execute",
              placeHolder: "e.g., ./scripts/validate.sh",
            });
            if (!command) {
              return;
            }
            await configService.addHook(
              event as any,
              { matcher, type: "command", command },
              projectPath,
            );
          } else if (type === "http") {
            const url = await vscode.window.showInputBox({
              prompt: "Enter URL to call",
              placeHolder: "e.g., https://example.com/webhook",
            });
            if (!url) {
              return;
            }
            await configService.addHook(
              event as any,
              { matcher, type: "http", url },
              projectPath,
            );
          } else if (type === "prompt") {
            const prompt = await vscode.window.showInputBox({
              prompt: "Enter prompt text to inject",
              placeHolder: "e.g., Always check for security issues",
            });
            if (!prompt) {
              return;
            }
            await configService.addHook(
              event as any,
              { matcher, type: "prompt", prompt },
              projectPath,
            );
          } else if (type === "agent") {
            const agent = await vscode.window.showInputBox({
              prompt: "Enter agent name",
              placeHolder: "e.g., code-reviewer",
            });
            if (!agent) {
              return;
            }
            await configService.addHook(
              event as any,
              { matcher, type: "agent", agent },
              projectPath,
            );
          }

          vscode.window.showInformationMessage("Hook added");
          treeProvider.refresh();
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to add hook: ${error}`);
        }
      },
    ),
  );

  // Delete Hook
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.deleteHook",
      async (item: ConfigTreeItem) => {
        if (!item.data) {
          return;
        }
        const hook = item.data as { id: string; event: string };
        try {
          await configService.deleteHook(
            hook.event as any,
            hook.id,
            item.projectPath,
          );
          vscode.window.showInformationMessage("Hook deleted");
          treeProvider.refresh();
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to delete hook: ${error}`);
        }
      },
    ),
  );

  // Add Command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.addCommand",
      async (item?: ConfigTreeItem) => {
        const projectPath = item?.projectPath || currentActiveContext();
        if (!projectPath) {
          vscode.window.showErrorMessage("No project selected");
          return;
        }

        const name = await vscode.window.showInputBox({
          prompt: "Enter command name (without /)",
          placeHolder: "e.g., review-code",
        });
        if (!name) {
          return;
        }

        const description = await vscode.window.showInputBox({
          prompt: "Enter command description",
          placeHolder: "e.g., Review the current file for issues",
        });

        try {
          const command = await configService.createCommand(
            name,
            description || "",
            "# Add your prompt here\n\nDescribe what Claude should do when this command is invoked.",
            undefined,
            projectPath,
          );
          // Open the created file
          const doc = await vscode.workspace.openTextDocument(command.filePath);
          await vscode.window.showTextDocument(doc);
          treeProvider.refresh();
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to create command: ${error}`);
        }
      },
    ),
  );

  // Open Command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.openCommand",
      async (cmd: Command) => {
        if (cmd && cmd.filePath) {
          const doc = await vscode.workspace.openTextDocument(cmd.filePath);
          await vscode.window.showTextDocument(doc);
        }
      },
    ),
  );

  // Delete Command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.deleteCommand",
      async (item: ConfigTreeItem) => {
        if (!item.data) {
          return;
        }
        const cmd = item.data as Command;
        const confirm = await vscode.window.showWarningMessage(
          `Delete command "/${cmd.name}"?`,
          { modal: true },
          "Delete",
        );
        if (confirm === "Delete") {
          try {
            await configService.deleteCommand(cmd.name, item.projectPath);
            vscode.window.showInformationMessage("Command deleted");
            treeProvider.refresh();
          } catch (error) {
            vscode.window.showErrorMessage(
              `Failed to delete command: ${error}`,
            );
          }
        }
      },
    ),
  );

  // Add Skill
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.addSkill",
      async (item?: ConfigTreeItem) => {
        const projectPath = item?.projectPath || currentActiveContext();
        if (!projectPath) {
          vscode.window.showErrorMessage("No project selected");
          return;
        }

        const name = await vscode.window.showInputBox({
          prompt: "Enter skill name",
          placeHolder: "e.g., code-reviewer",
        });
        if (!name) {
          return;
        }

        const description = await vscode.window.showInputBox({
          prompt: "Enter skill description",
          placeHolder: "e.g., Reviews code for best practices and issues",
        });

        try {
          const skill = await configService.createSkill(
            name,
            description || "",
            "# Skill Instructions\n\nDescribe what this skill does and how it should behave.",
            [],
            undefined,
            projectPath,
          );
          const doc = await vscode.workspace.openTextDocument(skill.filePath);
          await vscode.window.showTextDocument(doc);
          treeProvider.refresh();
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to create skill: ${error}`);
        }
      },
    ),
  );

  // Open Skill
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.openSkill",
      async (skill: Skill) => {
        if (skill && skill.filePath) {
          const doc = await vscode.workspace.openTextDocument(skill.filePath);
          await vscode.window.showTextDocument(doc);
        }
      },
    ),
  );

  // Delete Skill
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.deleteSkill",
      async (item: ConfigTreeItem) => {
        if (!item.data) {
          return;
        }
        const skill = item.data as Skill;
        const confirm = await vscode.window.showWarningMessage(
          `Delete skill "${skill.name}"?`,
          { modal: true },
          "Delete",
        );
        if (confirm === "Delete") {
          try {
            await configService.deleteSkill(skill.name, item.projectPath);
            vscode.window.showInformationMessage("Skill deleted");
            treeProvider.refresh();
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete skill: ${error}`);
          }
        }
      },
    ),
  );

  // Add Agent
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.addAgent",
      async (item?: ConfigTreeItem) => {
        const projectPath = item?.projectPath || currentActiveContext();
        if (!projectPath) {
          vscode.window.showErrorMessage("No project selected");
          return;
        }

        const name = await vscode.window.showInputBox({
          prompt: "Enter agent name",
          placeHolder: "e.g., test-runner",
        });
        if (!name) {
          return;
        }

        const description = await vscode.window.showInputBox({
          prompt: "Enter agent description",
          placeHolder: "e.g., Runs tests and reports results",
        });

        try {
          const agent = await configService.createAgent(
            name,
            description || "",
            "# Agent Instructions\n\nDescribe what this agent does and how it should behave.",
            [],
            undefined,
            projectPath,
          );
          const doc = await vscode.workspace.openTextDocument(agent.filePath);
          await vscode.window.showTextDocument(doc);
          treeProvider.refresh();
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to create agent: ${error}`);
        }
      },
    ),
  );

  // Open Agent
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.openAgent",
      async (agent: Agent) => {
        if (agent && agent.filePath) {
          const doc = await vscode.workspace.openTextDocument(agent.filePath);
          await vscode.window.showTextDocument(doc);
        }
      },
    ),
  );

  // Delete Agent
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.deleteAgent",
      async (item: ConfigTreeItem) => {
        if (!item.data) {
          return;
        }
        const agent = item.data as Agent;
        const confirm = await vscode.window.showWarningMessage(
          `Delete agent "${agent.name}"?`,
          { modal: true },
          "Delete",
        );
        if (confirm === "Delete") {
          try {
            await configService.deleteAgent(agent.name, item.projectPath);
            vscode.window.showInformationMessage("Agent deleted");
            treeProvider.refresh();
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete agent: ${error}`);
          }
        }
      },
    ),
  );

  // Add MCP Server
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.addMcpServer",
      async (item?: ConfigTreeItem) => {
        const projectPath = item?.projectPath || currentActiveContext();
        if (!projectPath) {
          vscode.window.showErrorMessage("No project selected");
          return;
        }

        const id = await vscode.window.showInputBox({
          prompt: "Enter server ID",
          placeHolder: "e.g., github-mcp",
        });
        if (!id) {
          return;
        }

        const serverType = await vscode.window.showQuickPick(
          [
            { label: "stdio", description: "Local process (command + args)" },
            { label: "http", description: "Remote HTTP/SSE server (URL)" },
          ],
          { placeHolder: "Select server transport type" },
        );
        if (!serverType) {
          return;
        }

        try {
          if (serverType.label === "http") {
            const url = await vscode.window.showInputBox({
              prompt: "Enter server URL",
              placeHolder: "e.g., https://example.com/mcp",
            });
            if (!url) {
              return;
            }

            await configService.addMcpServer(
              id,
              { type: "http", url },
              projectPath,
            );
          } else {
            const command = await vscode.window.showInputBox({
              prompt: "Enter command to run the server",
              placeHolder: "e.g., npx, node, python3",
            });
            if (!command) {
              return;
            }

            const argsStr = await vscode.window.showInputBox({
              prompt: "Enter command arguments (comma-separated)",
              placeHolder: "e.g., -y, @modelcontextprotocol/server-github",
            });
            const args = argsStr ? argsStr.split(",").map((a) => a.trim()) : [];

            await configService.addMcpServer(
              id,
              { command, args },
              projectPath,
            );
          }

          vscode.window.showInformationMessage(`MCP Server "${id}" added`);
          treeProvider.refresh();
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to add MCP server: ${error}`);
        }
      },
    ),
  );

  // Delete MCP Server
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.deleteMcpServer",
      async (item: ConfigTreeItem) => {
        if (!item.data) {
          return;
        }
        const server = item.data as { id: string; name: string };
        const confirm = await vscode.window.showWarningMessage(
          `Remove MCP server "${server.name}"?`,
          { modal: true },
          "Remove",
        );
        if (confirm === "Remove") {
          try {
            await configService.removeMcpServer(server.id, item.projectPath);
            vscode.window.showInformationMessage("MCP Server removed");
            treeProvider.refresh();
          } catch (error) {
            vscode.window.showErrorMessage(
              `Failed to remove MCP server: ${error}`,
            );
          }
        }
      },
    ),
  );

  // Edit Permissions
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.editPermissions",
      async (item?: ConfigTreeItem) => {
        const projectPath = item?.projectPath || currentActiveContext();

        const permissions = await configService.getPermissions(projectPath);
        const action = await vscode.window.showQuickPick(
          ["Add to Allow", "Add to Deny", "Add to Ask", "View Current"],
          { placeHolder: "Select action" },
        );

        if (!action) {
          return;
        }

        if (action === "View Current") {
          const message = [
            `Allow: ${permissions.allow.join(", ") || "(none)"}`,
            `Deny: ${permissions.deny.join(", ") || "(none)"}`,
            `Ask: ${permissions.ask.join(", ") || "(none)"}`,
          ].join("\n");
          vscode.window.showInformationMessage(message, { modal: true });
          return;
        }

        const pattern = await vscode.window.showInputBox({
          prompt: "Enter permission pattern",
          placeHolder: "e.g., Bash(git:*), Edit, Read(**/secrets/**)",
        });

        if (!pattern) {
          return;
        }

        try {
          if (action === "Add to Allow") {
            permissions.allow.push(pattern);
          } else if (action === "Add to Deny") {
            permissions.deny.push(pattern);
          } else {
            permissions.ask.push(pattern);
          }
          await configService.setPermissions(permissions, projectPath);
          vscode.window.showInformationMessage("Permissions updated");
          treeProvider.refresh();
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to update permissions: ${error}`,
          );
        }
      },
    ),
  );

  // ========== Plugin Commands ==========

  // Browse Plugins (marketplace browser)
  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube.browsePlugins", async () => {
      const pluginService = treeProvider.getPluginService();
      if (!pluginService) {
        vscode.window.showErrorMessage("Plugin service not available");
        return;
      }

      try {
        const availablePlugins = await pluginService.getAvailablePlugins();

        if (availablePlugins.length === 0) {
          vscode.window.showInformationMessage(
            "No plugins available in marketplaces",
          );
          return;
        }

        const items = availablePlugins.map(({ plugin, marketplace }) => ({
          label: `$(extensions) ${plugin.name}`,
          description: `@${marketplace}`,
          detail: plugin.description,
          plugin,
          marketplace,
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: "Select a plugin to install",
          title: "Browse Marketplace Plugins",
        });

        if (selected) {
          await pluginService.installPlugin(
            selected.plugin.name,
            selected.marketplace,
          );
          vscode.window.showInformationMessage(
            `Plugin ${selected.plugin.name} installed!`,
          );
          treeProvider.refresh();
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to browse plugins: ${error}`);
      }
    }),
  );

  // Install Plugin
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.installPlugin",
      async (pluginName?: string, marketplace?: string) => {
        const pluginService = treeProvider.getPluginService();
        if (!pluginService) {
          vscode.window.showErrorMessage("Plugin service not available");
          return;
        }

        if (!pluginName || !marketplace) {
          // Show browse dialog if not provided
          await vscode.commands.executeCommand("thinkube.browsePlugins");
          return;
        }

        try {
          await pluginService.installPlugin(pluginName, marketplace);
          vscode.window.showInformationMessage(
            `Plugin ${pluginName} installed!`,
          );
          treeProvider.refresh();
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to install plugin: ${error}`);
        }
      },
    ),
  );

  // Enable/Disable Plugin
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.togglePlugin",
      async (item: ConfigTreeItem) => {
        const pluginService = treeProvider.getPluginService();
        if (!pluginService || !item.data) {
          return;
        }

        const plugin = item.data as {
          name: string;
          marketplace: string;
          enabled: boolean;
        };

        try {
          await pluginService.setPluginEnabled(
            plugin.name,
            plugin.marketplace,
            !plugin.enabled,
          );
          vscode.window.showInformationMessage(
            `Plugin ${plugin.name} ${plugin.enabled ? "disabled" : "enabled"}`,
          );
          treeProvider.refresh();
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to toggle plugin: ${error}`);
        }
      },
    ),
  );

  // Create Plugin (wizard)
  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube.createPlugin", async () => {
      const pluginService = treeProvider.getPluginService();
      if (!pluginService) {
        vscode.window.showErrorMessage("Plugin service not available");
        return;
      }

      const wizard = new PluginCreationWizard(pluginService);
      const pluginPath = await wizard.run();

      if (pluginPath) {
        treeProvider.refresh();
      }
    }),
  );

  // Quick Create Plugin
  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube.quickCreatePlugin", async () => {
      const pluginService = treeProvider.getPluginService();
      if (!pluginService) {
        vscode.window.showErrorMessage("Plugin service not available");
        return;
      }

      const pluginPath = await quickCreatePlugin(pluginService);

      if (pluginPath) {
        treeProvider.refresh();
      }
    }),
  );

  // Suggest Plugins (analyze project and suggest)
  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube.suggestPlugins", async () => {
      const pluginService = treeProvider.getPluginService();
      if (!pluginService) {
        vscode.window.showErrorMessage("Plugin service not available");
        return;
      }

      try {
        const suggestions = await pluginService.suggestPlugins();

        if (suggestions.length === 0) {
          vscode.window.showInformationMessage(
            "No plugin suggestions for this project",
          );
          return;
        }

        const items = suggestions.map(({ plugin, marketplace, reason }) => ({
          label: `$(extensions) ${plugin.name}`,
          description: reason,
          detail: plugin.description,
          plugin,
          marketplace,
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: "Select plugins to install",
          canPickMany: true,
          title: "Suggested Plugins for Your Project",
        });

        if (selected && selected.length > 0) {
          for (const item of selected) {
            await pluginService.installPlugin(
              item.plugin.name,
              item.marketplace,
            );
          }
          vscode.window.showInformationMessage(
            `Installed ${selected.length} plugin(s)`,
          );
          treeProvider.refresh();
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to suggest plugins: ${error}`);
      }
    }),
  );

  // Uninstall Plugin
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.uninstallPlugin",
      async (item: ConfigTreeItem) => {
        const pluginService = treeProvider.getPluginService();
        if (!pluginService || !item.data) {
          return;
        }

        const plugin = item.data as { name: string; marketplace: string };

        const confirm = await vscode.window.showWarningMessage(
          `Uninstall plugin "${plugin.name}"?`,
          { modal: true },
          "Uninstall",
        );

        if (confirm === "Uninstall") {
          try {
            await pluginService.uninstallPlugin(
              plugin.name,
              plugin.marketplace,
            );
            vscode.window.showInformationMessage(
              `Plugin ${plugin.name} uninstalled`,
            );
            treeProvider.refresh();
          } catch (error) {
            vscode.window.showErrorMessage(
              `Failed to uninstall plugin: ${error}`,
            );
          }
        }
      },
    ),
  );
}
