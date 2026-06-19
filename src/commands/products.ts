/**
 * New Product / New Project / Promote-TEP commands (SP-tgvl81_SL-3, SP-tgvpbm_SL-4).
 * Thin vscode wrappers around the pure manifest writers + the implements ref
 * engine: prompt, write/move under the configured board root, refresh.
 */
import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  BoardNavigatorProvider,
  boardRootStatus,
  discoverRepos,
  type ProductNode,
} from "../views/boards/BoardNavigatorProvider";
import { ThinkubeStore } from "../store/ThinkubeStore";
import { namespaceForRepo } from "../store/boardNamespace";
import { discoverProjects } from "../store/projects";
import {
  normalizeTepId,
  rewriteImplementsForPromote,
} from "../store/implementsRef";
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
        const root = boardRootStatus().root;
        if (!root) {
          vscode.window.showErrorMessage(
            "Set `thinkube.boards.root` before promoting a TEP.",
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
        const projectNamespace = `${product}/projects/${projectId}`;

        const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
          name: f.name,
          path: f.uri.fsPath,
        }));
        const repos = discoverRepos()
          .filter((r) => r.enabled && !r.worktreeOf)
          .map((r) => ({
            ns: namespaceForRepo(r.path, folders),
            store: new ThinkubeStore(r.path, r.boardDir),
          }))
          .filter((r): r is { ns: string; store: ThinkubeStore } => !!r.ns);

        let originNs: string | undefined;
        let originDir: string | undefined;
        for (const r of repos) {
          if ((await r.store.listTeps()).some((t) => normalizeTepId(t.id) === tepId)) {
            originNs = r.ns;
            originDir = r.store.thinkubeDir;
            break;
          }
        }
        if (!originNs || !originDir) {
          vscode.window.showErrorMessage(`TEP-${tepId} not found in any repo.`);
          return;
        }

        const fileName = `TEP-${tepId}.md`;
        const projTepsDir = path.join(root, product, "projects", projectId, "teps");
        fs.mkdirSync(projTepsDir, { recursive: true });
        fs.renameSync(
          path.join(originDir, "teps", fileName),
          path.join(projTepsDir, fileName),
        );

        const rewritten: string[] = [];
        for (const r of repos) {
          for (const spec of await r.store.listSpecDirs()) {
            const rel = r.store.pathForSpecDoc(spec);
            const parsed = await r.store.getFile(rel);
            const fm = parsed?.frontmatter;
            const next = rewriteImplementsForPromote(
              r.ns,
              typeof fm?.implements === "string" ? fm.implements : undefined,
              originNs,
              tepId,
              projectNamespace,
            );
            if (next && parsed) {
              await r.store.writeFile(rel, { ...(fm ?? {}), implements: next }, parsed.body);
              rewritten.push(`SP-${spec}`);
            }
          }
        }
        provider.refresh();
        vscode.window.showInformationMessage(
          `Promoted TEP-${tepId} into ${projectNamespace}; rewrote ${rewritten.length} spec(s).`,
        );
      },
    ),
  );
}
