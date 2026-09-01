/**
 * Start-from-nothing (SPEC Amendment 1 §4, Option A): a new application
 * is born ONLY from the platform's template catalog. The candidates are
 * a metadata lookup (no AI); the human chooses and names; the platform's
 * own instantiation creates the real repository (Gitea + CI) the moment
 * the choice is made; the new repository is cloned into the apps root,
 * added to the workspace, enabled under the product, and attached to the
 * active project's context scope — so grounding reads INSTANTIATED code,
 * never raw template source.
 */
import * as path from "node:path";
import { catalogOf, controlReachedBy, createAppFromTemplate, nameIsUsable } from "./templateCore";
import type { CatalogTemplate, ControlAuth } from "./templateCore";
import { configuredStoreRoot } from "./spaceOps";
import { thinkingSpaceDirs } from "../core/spaces";
import { readContextScope, writeContextScope } from "../core/workProjects";
import { vs } from "../core/vscodeHost";


/** The editor's own settings first, then the way anything else finds it. */
function controlAuth(): ControlAuth | { reason: string } {
  const cfg = vs().workspace.getConfiguration("thinkubeTandem");
  const url = cfg.get<string>("controlUrl", "");
  const token = cfg.get<string>("controlToken", "");
  if (url && token) return { base: new URL(url).origin, token };
  return controlReachedBy();
}

async function newAppFromTemplate(args: {
  product: string;
  appsRoot: string;
  /** Attach the new repository to this project space's context scope. */
  attachScope?: (repoId: string) => void;
  refresh: () => void;
  activate: (cardId: string) => Promise<void>;
}): Promise<void> {
  const vsc = vs();
  const auth = controlAuth();
  if ("reason" in auth) {
    void vsc.window.showWarningMessage(`Tandem — ${auth.reason}`);
    return;
  }
  let catalog: CatalogTemplate[];
  try {
    catalog = await catalogOf(auth);
  } catch (e) {
    void vsc.window.showWarningMessage(`Tandem — the template catalog is unreachable: ${String(e)}`);
    return;
  }
  const tpl = await vsc.window.showQuickPick(
    catalog.map((t) => ({ label: t.name, detail: t.description, description: t.url, t })),
    { title: "Which starting point? (the platform's template catalog)" },
  );
  if (!tpl) return;
  const appName = await vsc.window.showInputBox({
    title: "Name the new application",
    prompt: "Lowercase letters, digits and dashes — it becomes the repository name.",
    validateInput: (v) => nameIsUsable(v),
  });
  if (!appName) return;
  const description =
    (await vsc.window.showInputBox({ title: "One line: what is this application?" })) ?? "";

  // Everything that touches the world happens in the core; this is the
  // asking and the watching, which is all an editor adds.
  const made = await vsc.window.withProgress(
    {
      location: vsc.ProgressLocation.Notification,
      title: `Tandem — creating "${appName}" from ${tpl.label}…`,
    },
    (progress) =>
      createAppFromTemplate({
        auth,
        product: args.product,
        appName,
        templateUrl: tpl.t.url,
        description,
        appsRoot: args.appsRoot,
        storeRoot: configuredStoreRoot(),
        say: (line) => progress.report({ message: line }),
      }),
  );
  if (!made.ok) {
    void vsc.window.showErrorMessage(`Tandem — ${made.reason}`);
    return;
  }
  if (!(vsc.workspace.workspaceFolders ?? []).some((f) => f.uri.fsPath === made.at))
    vsc.workspace.updateWorkspaceFolders(vsc.workspace.workspaceFolders?.length ?? 0, 0, {
      uri: vsc.Uri.file(made.at),
    });
  args.attachScope?.(made.cardId);
  args.refresh();
  await args.activate(made.cardId);
}

/** The + gesture wrapper: wires the active project space's scope so the
 *  newborn repository is checked for reading automatically. */
export async function newAppGesture(args: {
  product: string;
  storeRoot: string;
  ownerKey?: string;
  activeSlug?: string;
  refresh: () => void;
  activate: (cardId: string) => Promise<void>;
}): Promise<void> {
  await newAppFromTemplate({
    product: args.product,
    appsRoot: path.join(process.env.HOME ?? "~", "apps"),
    ...(args.ownerKey?.startsWith("wp:") && args.activeSlug
      ? {
          attachScope: (repoId: string) => {
            const dirs = thinkingSpaceDirs(
              args.storeRoot,
              args.ownerKey!.slice(3),
              args.activeSlug!,
              "_",
              "project",
            );
            writeContextScope(dirs.foldDir, [...readContextScope(dirs.foldDir), repoId]);
          },
        }
      : {}),
    refresh: args.refresh,
    activate: args.activate,
  });
}
