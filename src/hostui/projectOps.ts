/**
 * Bringing a repository under Tandem respects the platform's order: a
 * repository is NEVER created here — new applications are born only by
 * template instantiation (the start-from-nothing flow). The candidates
 * are the git repositories FOUND INSIDE the open workspace roots
 * (apps/*, user-templates/*, the platform's nested repos) — the roots
 * themselves are containers (a root's own git, when present, is
 * housekeeping, not a repository) and are never offered. The card is
 * minted in place; nothing on disk is created.
 */
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { EnabledProject, mintCard, scopesNotOpen } from "../core/identity";

/** Git repositories nested inside a root — the root itself is never a
 *  candidate; found repos are leaves (no descent into them). */
function reposInside(root: string, depth = 3): string[] {
  const out: string[] = [];
  const walk = (dir: string, level: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
      const child = path.join(dir, e.name);
      if (fs.existsSync(path.join(child, ".git"))) out.push(child);
      else if (level < depth) walk(child, level + 1);
    }
  };
  walk(root, 1);
  return out;
}

export async function newProjectFlow(
  product: string,
  openProjects: () => EnabledProject[],
  refresh: () => void,
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const carded = new Set(openProjects().map((p) => path.resolve(p.anchorDir)));
  const items = folders.flatMap((f) =>
    reposInside(f.uri.fsPath)
      .filter((d) => !carded.has(path.resolve(d)))
      .map((d) => ({
        label: path.relative(path.dirname(f.uri.fsPath), d),
        description: d,
      })),
  );
  if (items.length === 0) {
    void vscode.window.showInformationMessage(
      "Tandem — every repository inside the open roots is already enabled. New applications come from a template.",
    );
    return;
  }
  const pick = await vscode.window.showQuickPick(items, {
    title: `Enable a repository under ${product}`,
    placeHolder: "Repositories found inside the open roots. Nothing is created here.",
  });
  if (!pick) return;
  const anchorDir = pick.description;
  if (!anchorDir) return;
  const label = await vscode.window.showInputBox({
    title: "Repository label (a name, never an identity)",
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

export async function chooseProject(
  context: vscode.ExtensionContext,
  openProjects: () => EnabledProject[],
): Promise<EnabledProject | undefined> {
  const open = openProjects();
  const folders = vscode.workspace.workspaceFolders ?? [];
  type Item = vscode.QuickPickItem & { project?: EnabledProject; enableDir?: string };
  const items: Item[] = [];
  const byProduct = new Map<string, EnabledProject[]>();
  for (const p of open) {
    const k = p.card.product ?? "";
    if (!byProduct.has(k)) byProduct.set(k, []);
    byProduct.get(k)!.push(p);
  }
  for (const [product, ps] of [...byProduct.entries()].sort()) {
    if (product)
      items.push({ label: product, kind: vscode.QuickPickItemKind.Separator });
    for (const p of ps) {
      const missing = scopesNotOpen(p, open);
      items.push({
        label: p.card.label,
        description: p.prefix ? `${path.basename(p.gitRoot)}/${p.prefix}` : path.basename(p.gitRoot),
        detail: missing.length
          ? `⚠ scope(s) not open in this workspace: ${missing.map((s) => s.label ?? s.id ?? s.remote ?? "?").join(", ")}`
          : undefined,
        project: p,
      });
    }
  }
  const carded = new Set(open.map((p) => path.resolve(p.anchorDir)));
  const enableable = folders.filter((f) => !carded.has(path.resolve(f.uri.fsPath)));
  if (enableable.length) {
    items.push({ label: "Enable as a project", kind: vscode.QuickPickItemKind.Separator });
    for (const f of enableable)
      items.push({
        label: `$(add) Enable ${f.name}…`,
        description: f.uri.fsPath,
        enableDir: f.uri.fsPath,
      });
  }
  const pick = await vscode.window.showQuickPick(items, {
    title: "Tandem — which project are you working on?",
  });
  if (!pick) return undefined;
  if (pick.enableDir) {
    const label = await vscode.window.showInputBox({
      title: "Project label (a name, never an identity)",
      value: path.basename(pick.enableDir),
    });
    if (!label) return undefined;
    const product = await vscode.window.showInputBox({
      title: "Product grouping label (optional — e.g. KubeXlat, Platform)",
      value: "",
    });
    const remote = await new Promise<string | undefined>((resolve) =>
      execFile(
        "git",
        ["-C", pick.enableDir!, "remote", "get-url", "origin"],
        { encoding: "utf8" },
        (err, out) => resolve(err ? undefined : out.trim()),
      ),
    );
    const minted = mintCard(pick.enableDir, {
      label,
      ...(product ? { product } : {}),
      ...(remote ? { remote } : {}),
    });
    if (!minted.ok) {
      void vscode.window.showErrorMessage(`Tandem: ${minted.reason}`);
      return undefined;
    }
    const enabled = openProjects().find((p) => p.card.id === minted.card.id);
    if (enabled) await context.workspaceState.update("tandem.activeProject", enabled.card.id);
    return enabled;
  }
  await context.workspaceState.update("tandem.activeProject", pick.project!.card.id);
  return pick.project;
}
