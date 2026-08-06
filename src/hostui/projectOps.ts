/**
 * The three births of a project, always under a product (the v1 rule):
 * enable an open folder · a new sub-project folder inside an open
 * repository · a brand new repository (git init + first commit), added to
 * the workspace. Every path ends the same way: card minted, tree
 * refreshed, project activated.
 */
import { execFile } from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";
import { EnabledProject, mintCard } from "../core/identity";

export async function newProjectFlow(
  product: string,
  openProjects: () => EnabledProject[],
  refresh: () => void,
): Promise<void> {
  const kind = await vscode.window.showQuickPick(
    [
      { label: "Enable an open folder", k: "enable", description: "it exists and is open — make it a Tandem project" },
      { label: "New sub-project in an open repository", k: "sub", description: "a folder inside a monorepo" },
      { label: "New repository", k: "repo", description: "a brand new folder with git initialized" },
    ],
    { title: `New Repository under ${product} — where does it live?` },
  );
  if (!kind) return;
  const folders = vscode.workspace.workspaceFolders ?? [];
  const run = (cwd: string, args: string[]): Promise<void> =>
    new Promise((resolve, reject) =>
      execFile("git", ["-C", cwd, ...args], (err) => (err ? reject(err) : resolve())),
    );
  let anchorDir: string | undefined;
  if (kind.k === "enable") {
    const carded = new Set(openProjects().map((p) => path.resolve(p.anchorDir)));
    const candidates = folders.filter((f) => !carded.has(path.resolve(f.uri.fsPath)));
    const pick = await vscode.window.showQuickPick(
      candidates.map((f) => ({ label: f.name, description: f.uri.fsPath })),
      { title: "Which open folder?" },
    );
    if (!pick) return;
    anchorDir = pick.description!;
  } else if (kind.k === "sub") {
    const repo = await vscode.window.showQuickPick(
      folders.map((f) => ({ label: f.name, description: f.uri.fsPath })),
      { title: "Inside which open repository?" },
    );
    if (!repo) return;
    const rel = await vscode.window.showInputBox({
      title: `Folder inside ${repo.label} (e.g. extensions/my-tool)`,
    });
    if (!rel?.trim()) return;
    anchorDir = path.join(repo.description!, rel.trim());
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(anchorDir));
  } else {
    const parent = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      title: "Where should the new repository live?",
    });
    if (!parent?.[0]) return;
    const name = await vscode.window.showInputBox({ title: "Repository folder name" });
    if (!name?.trim()) return;
    anchorDir = path.join(parent[0].fsPath, name.trim());
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(anchorDir));
    await run(anchorDir, ["init", "-q"]);
  }
  const label = await vscode.window.showInputBox({
    title: "Project label (a name, never an identity)",
    value: path.basename(anchorDir),
  });
  if (!label?.trim()) return;
  const remote = await new Promise<string | undefined>((resolve) =>
    execFile("git", ["-C", anchorDir!, "remote", "get-url", "origin"], { encoding: "utf8" }, (err, out) =>
      resolve(err ? undefined : out.trim()),
    ),
  );
  const minted = mintCard(anchorDir, {
    label: label.trim(),
    product,
    ...(remote ? { remote } : {}),
  });
  if (!minted.ok) {
    void vscode.window.showErrorMessage(`Tandem: ${minted.reason}`);
    return;
  }
  if (kind.k === "repo") {
    await run(anchorDir, ["add", "-A"]);
    await run(anchorDir, ["commit", "-qm", "tandem: project created"]).catch(() => {});
    vscode.workspace.updateWorkspaceFolders(folders.length, 0, {
      uri: vscode.Uri.file(anchorDir),
    });
  }
  refresh();
  await vscode.commands.executeCommand("thinkube-tandem.activateProject", minted.card.id);
}

/** Retire a merged TEP's worktrees (code, tester snapshot, oracle runners) —
 *  best-effort: a missing tree is a no-op, the accept never fails on cleanup. */
export async function retireTepWorktrees(repoRoot: string, tepId: string): Promise<void> {
  const run = (args: string[]): Promise<string> =>
    new Promise((resolve) =>
      execFile("git", ["-C", repoRoot, ...args], { encoding: "utf8" }, (_e, out) =>
        resolve(out ?? ""),
      ),
    );
  const wtRoot = path.join(
    path.dirname(repoRoot),
    `${path.basename(repoRoot)}-worktrees`,
  );
  const listed = await run(["worktree", "list", "--porcelain"]);
  const targets = listed
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length))
    .filter(
      (p) =>
        p === path.join(wtRoot, tepId) ||
        p === path.join(wtRoot, `${tepId}-tester`) ||
        p.startsWith(path.join(wtRoot, "oracle-runners", `${tepId}-`)),
    );
  for (const t of targets) await run(["worktree", "remove", "--force", t]);
  await run(["worktree", "prune"]);
}
