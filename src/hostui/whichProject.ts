/**
 * Which project and space the editor is working in.
 *
 * Three questions with one answer between them — what projects are open,
 * which is active, and which space under it — and one shared cost: finding
 * the projects walks every workspace folder and asks git what each
 * repository ignores. The tree asked that question about fourteen times
 * per draw, so it lived here in the activation file and grew a cache;
 * apart, it is a small thing with one subject.
 */
import * as vscode from "vscode";
import { discoverProjects } from "../core/identity";
import type { EnabledProject } from "../core/identity";
import { configuredStoreRoot } from "./spaceOps";

/**
 * The enabled projects, found once and kept until something can change
 * them.
 *
 * Finding them walks every workspace folder and asks git what each
 * repository ignores — a third of a second, measured, for four folders.
 * The tree asks for them at the TOP of every getChildren, and again per
 * repository row through `activeId`, so drawing a tree of three products
 * and three repositories did that walk about fourteen times: five seconds
 * of staring at nothing, repeated on every refresh — and the store watcher
 * refreshes constantly while a run is in flight.
 *
 * Nothing here expires on a timer. The set changes when a card is minted
 * or removed, or when the workspace folders change; every one of those
 * already calls the tree's refresh, so that is where the cache is dropped.
 */
let projectsCache: EnabledProject[] | undefined;

export function forgetProjects(): void {
  projectsCache = undefined;
}

export function openProjects(): EnabledProject[] {
  if (projectsCache) return projectsCache;
  const folders = vscode.workspace.workspaceFolders ?? [];
  const seen = new Map<string, EnabledProject>();
  for (const f of folders)
    for (const p of discoverProjects(f.uri.fsPath, configuredStoreRoot()))
      if (!seen.has(p.card.id)) seen.set(p.card.id, p);
  projectsCache = [...seen.values()];
  return projectsCache;
}

export function activeOwnerKey(context: vscode.ExtensionContext): string | undefined {
  const saved = context.workspaceState.get<string>("tandem.activeProject");
  if (saved?.startsWith("wp:")) return saved;
  return rememberedProject(context)?.card.id;
}

export function rememberedProject(context: vscode.ExtensionContext): EnabledProject | undefined {
  const open = openProjects();
  const saved = context.workspaceState.get<string>("tandem.activeProject");
  if (saved?.startsWith("wp:")) return undefined;
  const hit = saved ? open.find((p) => p.card.id === saved) : undefined;
  if (hit) return hit;
  if (open.length === 1) return open[0];
  return undefined;
}
