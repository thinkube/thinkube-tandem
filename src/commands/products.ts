/**
 * New Product / New Project commands (SP-tgvl81_SL-3). Thin vscode wrappers
 * around the pure manifest writers: prompt for a name (+ tag), write the
 * manifest under the configured board root, refresh the navigator.
 */
import * as vscode from "vscode";

import {
  BoardNavigatorProvider,
  boardRootStatus,
  type ProductNode,
} from "../views/boards/BoardNavigatorProvider";
import {
  slugifyId,
  writeProductManifest,
  writeProjectManifest,
} from "./manifestWriters";

export function registerProductCommands(
  context: vscode.ExtensionContext,
  provider: BoardNavigatorProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube.products.new", async () => {
      const root = boardRootStatus().root;
      if (!root) {
        vscode.window.showErrorMessage(
          "Set `thinkube.boards.root` (the sidecar board) before creating a Product.",
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
        const root = boardRootStatus().root;
        if (!root) {
          vscode.window.showErrorMessage(
            "Set `thinkube.boards.root` (the sidecar board) before creating a Project.",
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
        const tag =
          (
            await vscode.window.showInputBox({
              prompt: "Project tag — items carrying it become members",
              value: id,
            })
          )?.trim() || id;
        await writeProjectManifest(root, product, { id, name: name.trim(), tag });
        provider.refresh();
        vscode.window.showInformationMessage(
          `Created Project “${name.trim()}” in ${product} (tag #${tag}).`,
        );
      },
    ),
  );
}
