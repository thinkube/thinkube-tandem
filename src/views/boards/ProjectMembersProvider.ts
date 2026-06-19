/**
 * ProjectMembersProvider (SP-tgvl81_SL-2; reworked to implements in SP-tgvpbm_SL-4)
 * — the flat member list for the Project selected in the navigator. A Project is
 * a code-less umbrella owning TEPs; its members are the specs (across enabled
 * boards) whose `implements:` resolves to one of those umbrella TEPs. Resolution
 * is host-side (per-repo `ThinkubeStore`); the pure filter is `projectTepGroups`.
 */
import * as vscode from "vscode";

import { ThinkubeStore } from "../../store/ThinkubeStore";
import { namespaceForRepo } from "../../store/boardNamespace";
import { projectTeps } from "../../store/projects";
import { discoverRepos } from "./BoardNavigatorProvider";
import { projectTepGroups, MemberDesc, SpecImpl } from "./productTree";

export interface SelectedProject {
  product: string;
  id: string;
  name: string;
}

export class ProjectMembersProvider
  implements vscode.TreeDataProvider<MemberDesc>
{
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private project: SelectedProject | undefined;
  private boardRoot: string | undefined;

  setProject(project: SelectedProject | undefined): void {
    this.project = project;
    this.boardRoot =
      vscode.workspace
        .getConfiguration("thinkube.boards")
        .get<string>("root")
        ?.trim() || undefined;
    this._onDidChange.fire();
  }

  async getChildren(): Promise<MemberDesc[]> {
    const project = this.project;
    const boardRoot = this.boardRoot;
    if (!project || !boardRoot) return [];
    const tepIds = projectTeps(boardRoot, project.product, project.id);
    if (tepIds.length === 0) return [];
    const projectNamespace = `${project.product}/projects/${project.id}`;

    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
      name: f.name,
      path: f.uri.fsPath,
    }));
    const specs: SpecImpl[] = [];
    for (const repo of discoverRepos()) {
      if (!repo.enabled || repo.worktreeOf) continue;
      const ns = namespaceForRepo(repo.path, folders);
      if (!ns) continue;
      const store = new ThinkubeStore(repo.path, repo.boardDir);
      try {
        for (const spec of await store.listSpecDirs()) {
          const fm = (await store.getFile(store.pathForSpecDoc(spec)))
            ?.frontmatter;
          specs.push({
            board: repo.name,
            namespace: ns,
            handle: `SP-${spec}`,
            implements:
              typeof fm?.implements === "string" ? fm.implements : undefined,
          });
        }
      } catch {
        // skip an unreadable board
      }
    }

    // Flatten the per-TEP groups into a deduped member list.
    const seen = new Set<string>();
    const members: MemberDesc[] = [];
    for (const g of projectTepGroups(projectNamespace, tepIds, specs)) {
      for (const s of g.specs) {
        if (seen.has(s.handle)) continue;
        seen.add(s.handle);
        members.push({ board: s.board, handle: s.handle, kind: "spec" });
      }
    }
    return members;
  }

  getTreeItem(node: MemberDesc): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.handle,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = node.board;
    item.tooltip = `${node.handle} — implementing spec in ${node.board}`;
    item.iconPath = new vscode.ThemeIcon("list-tree");
    return item;
  }
}
