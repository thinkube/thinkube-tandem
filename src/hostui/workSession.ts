/**
 * Sessions for PROJECT thinking spaces (work, not code — Amendment 1):
 * the space lives in the store, reads the repositories the human CHECKED
 * (the context scope, candidates bounded by the project's product), and
 * dispatches per repository through the scope machinery. Rounds get a
 * neutral working directory (the store root) plus the checked
 * repositories' absolute roots; every touchpoint must carry its
 * repository, and dispatch refuses what it cannot resolve — by name.
 */
import type * as vscodeTypes from "vscode";
import { createRequire } from "node:module";
import { EnabledProject } from "../core/identity";
import { nextTepNumber, thinkingSpaceDirs } from "../core/spaces";
import {
  listWorkProjects,
  readContextScope,
  WorkProject,
  writeContextScope,
} from "../core/workProjects";

const req: NodeRequire =
  typeof require !== "undefined" ? require : createRequire(__filename);
function vs(): typeof vscodeTypes {
  return req("vscode") as typeof vscodeTypes;
}

/** The multi-select over the PRODUCT's repositories (the human's boundary
 *  correction: never "whatever is open in the workspace"). Returns the
 *  checked ids, persisted beside the space's records. */
export async function editContextScope(
  storeRoot: string,
  wp: WorkProject,
  spaceSlug: string,
  openRepos: EnabledProject[],
): Promise<string[] | undefined> {
  const { foldDir } = thinkingSpaceDirs(storeRoot, wp.id, spaceSlug, "_", "project");
  const current = new Set(readContextScope(foldDir));
  const candidates = openRepos.filter((p) => (p.card.product ?? "") === wp.product);
  if (candidates.length === 0) {
    void vs().window.showWarningMessage(
      `Tandem — the product "${wp.product}" has no enabled repositories open; open and enable one first.`,
    );
    return undefined;
  }
  const picked = await vs().window.showQuickPick(
    candidates.map((p) => ({
      label: p.card.label,
      description: p.card.id,
      picked: current.has(p.card.id),
    })),
    {
      title: `Which repositories should "${spaceSlug}" read?`,
      placeHolder: "The thinking grounds only in what you check here.",
      canPickMany: true,
    },
  );
  if (!picked) return undefined;
  const ids = picked.map((p) => p.description!);
  writeContextScope(foldDir, ids);
  return ids;
}

export function findWorkProject(storeRoot: string, id: string): WorkProject | undefined {
  return listWorkProjects(storeRoot).find((w) => w.id === id);
}

/** The live scope reader a project session grounds through. */
function scopesReader(
  storeRoot: string,
  wp: WorkProject,
  spaceSlug: string,
  openRepos: () => EnabledProject[],
): () => { id: string; dir: string; label?: string }[] {
  const { foldDir } = thinkingSpaceDirs(storeRoot, wp.id, spaceSlug, "_", "project");
  return () => {
    const checked = new Set(readContextScope(foldDir));
    return openRepos()
      .filter((p) => checked.has(p.card.id))
      .map((p) => ({ id: p.card.id, dir: p.anchorDir, label: p.card.label }));
  };
}

/** Build (or reuse) the session for a project thinking space. */
export async function ensureWorkSession(args: {
  context: vscodeTypes.ExtensionContext;
  ownerKey: string;
  interactive: boolean;
  storeRoot: string;
  sessions: Map<string, import("../surfaces/session").TandemSession>;
  chooseSpace: (ownerKey: string, interactive: boolean) => Promise<string | undefined>;
  gitAuthor: (repoRoot: string) => Promise<string>;
  resolveForge: (
    gitRoot: string,
  ) => Promise<import("../dispatch/forge").Forge | undefined>;
  openRepos: () => EnabledProject[];
  onChanged: (message?: string) => void;
  storageDir: string;
}): Promise<import("../surfaces/session").TandemSession | undefined> {
  const wp = findWorkProject(args.storeRoot, args.ownerKey.slice(3));
  if (!wp) return undefined;
  const slug = await args.chooseSpace(args.ownerKey, args.interactive);
  if (!slug) return undefined;
  const key = `${args.ownerKey}/${slug}`;
  const existing = args.sessions.get(key);
  if (existing) return existing;
  const author = await args.gitAuthor(args.storeRoot);
  const dirs = thinkingSpaceDirs(args.storeRoot, wp.id, slug, author, "project");
  if (args.interactive && readContextScope(dirs.foldDir).length === 0)
    await editContextScope(args.storeRoot, wp, slug, args.openRepos());
  const config = vs().workspace.getConfiguration("thinkubeTandem");
  const { TandemSession } = await import("../surfaces/session");
  const s = new TandemSession({
    // Rounds get a neutral working directory; the checked repositories
    // arrive as member scopes and every touchpoint names its repository.
    round: { model: config.get<string>("groundingModel", "opus"), repoRoot: args.storeRoot },
    storeDir: dirs.storeDir,
    projectDir: dirs.foldDir,
    storageDir: args.storageDir,
    now: () => new Date().toISOString(),
    author,
    scope: { gitRoot: args.storeRoot, prefix: "", projectId: wp.id, label: `${wp.product} / ${wp.name}` },
    scopes: scopesReader(args.storeRoot, wp, slug, args.openRepos),
    resolveScope: async (scopeId) => {
      const p = args.openRepos().find((x) => x.card.id === scopeId);
      if (!p) return undefined;
      const forge = await args.resolveForge(p.gitRoot);
      return { gitRoot: p.gitRoot, prefix: p.prefix, ...(forge ? { forge } : {}) };
    },
    suiteCommand: config.get<string>("suiteCommand", "npm test").split(" ").filter(Boolean),
    workerModel: {
      workerModel: config.get<string>("workerModel", "sonnet"),
      workerModelByRole: config.get<Record<string, string>>("workerModelByRole", {}),
    },
    maxConcurrent: config.get<number>("maxConcurrent", 4),
    docsGateMode: config.get<"blocking" | "advisory">("docsGateMode", "blocking"),
    nextTepNumber: () => nextTepNumber(args.storeRoot, wp.id, author, "project"),
    onChanged: args.onChanged,
  });
  args.sessions.set(key, s);
  void s.renderAbstracts();
  return s;
}
