/**
 * New Product / New Project / Promote-TEP commands (SP-tgvl81_SL-3, SP-tgvpbm_SL-4).
 * Thin vscode wrappers around the pure manifest writers + the implements ref
 * engine: prompt, write/move under the configured thinking space root, refresh.
 */
import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  ThinkingSpaceNavigatorProvider,
  thinkingSpaceRootStatus,
  discoverRepos,
  type ProductNode,
} from "../views/thinkingSpaces/ThinkingSpaceNavigatorProvider";
import { discoverProjects } from "../store/projects";
import { normalizeTepId } from "../store/implementsRef";
import { promoteTep, ThinkingSpaceRegistry } from "../mcp/kanbanMcpServer";
import {
  slugifyId,
  writeProductManifest,
  writeProjectManifest,
} from "./manifestWriters";

export function registerProductCommands(
  context: vscode.ExtensionContext,
  provider: ThinkingSpaceNavigatorProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube.products.new", async () => {
      const root = thinkingSpaceRootStatus().root;
      if (!root) {
        vscode.window.showErrorMessage(
          "Set `thinkube.thinkingSpace.root` (the sidecar thinking space) before creating a Product.",
        );
        return;
      }
      const name = await vscode.window.showInputBox({
        prompt: "New Product name",
        placeHolder: "e.g. Thinkube Platform",
      });
      if (!name?.trim()) return;
      const id = slugifyId(name);
      if (!id) {
        vscode.window.showErrorMessage(`Can't derive a folder name from "${name}".`);
        return;
      }
      await writeProductManifest(root, { id, name: name.trim() });
      provider.refresh();
      vscode.window.showInformationMessage(`Created Product “${name.trim()}”.`);
    }),

    vscode.commands.registerCommand(
      "thinkube.projects.new",
      async (node?: ProductNode) => {
        const root = thinkingSpaceRootStatus().root;
        if (!root) {
          vscode.window.showErrorMessage(
            "Set `thinkube.thinkingSpace.root` (the sidecar thinking space) before creating a Project.",
          );
          return;
        }
        const product = node?.kind === "product" ? node.id : undefined;
        if (!product) {
          vscode.window.showErrorMessage(
            "Run “New Project” from a Product node in the Thinking Spaces view.",
          );
          return;
        }
        const name = await vscode.window.showInputBox({
          prompt: `New Project under ${product}`,
          placeHolder: "e.g. The Rebrand",
        });
        if (!name?.trim()) return;
        const id = slugifyId(name);
        if (!id) {
          vscode.window.showErrorMessage(`Can't derive a folder name from "${name}".`);
          return;
        }
        // A Project is a code-less umbrella; membership is by `implements:`, not a
        // tag — so New Project just creates the umbrella (name/state). TEPs are
        // added by authoring/promoting into its teps/.
        await writeProjectManifest(root, product, { id, name: name.trim() });
        provider.refresh();
        vscode.window.showInformationMessage(
          `Created Project “${name.trim()}” in ${product}. Promote or author a TEP into it.`,
        );
      },
    ),

    // Promote a repo TEP into an existing Project's umbrella (SP-tgvpbm_SL-4):
    // move the TEP under the project + rewrite every dependent's implements:.
    vscode.commands.registerCommand(
      "thinkube.tep.promote",
      async (node?: { tepId?: string }) => {
        const root = thinkingSpaceRootStatus().root;
        if (!root) {
          vscode.window.showErrorMessage(
            "Set `thinkube.thinkingSpace.root` before promoting a TEP.",
          );
          return;
        }
        const tepId = normalizeTepId(node?.tepId ?? "");
        if (!tepId) {
          vscode.window.showErrorMessage("Run “Promote to Project” from a TEP.");
          return;
        }
        const projects = discoverProjects(root);
        if (projects.length === 0) {
          vscode.window.showErrorMessage(
            "No Projects yet — create one with “New Project” first.",
          );
          return;
        }
        const pick = await vscode.window.showQuickPick(
          projects.map((p) => ({
            label: p.name,
            description: `${p.product}/${p.id}`,
            project: p,
          })),
          { placeHolder: `Promote TEP-${tepId} into which Project?` },
        );
        if (!pick) return;
        const { product, id: projectId } = pick.project;

        // Delegate to the server's promoteTep — ONE implementation of the
        // move + implements-rewrite. (The old command-side copy joined a bare
        // `teps/` path, ignoring the maintainer org tree: a wrong-path bug.)
        const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
          name: f.name,
          path: f.uri.fsPath,
        }));
        const env = {
          roots: folders.map((f) => f.path),
          folders,
          thinkingSpaceRoot: root,
          allowAIWrites: true,
          docsGateMode: "advisory" as const,
        };
        try {
          const res = (await promoteTep(
            { env, thinkingSpaces: new ThinkingSpaceRegistry(env) },
            tepId,
            product,
            projectId,
          )) as { tep: string; movedTo: string; rewritten: string[] };
          provider.refresh();
          vscode.window.showInformationMessage(
            `Promoted ${res.tep} into ${res.movedTo}; rewrote ${res.rewritten.length} spec(s).`,
          );
        } catch (err) {
          vscode.window.showErrorMessage(
            `Promote failed: ${(err as Error).message}`,
          );
        }
      },
    ),
  );
}
