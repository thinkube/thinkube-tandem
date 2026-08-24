/**
 * Commands that create or reclassify a product, repository, or project:
 * new product, new repository/project/app under a product, marking a
 * project done, choosing its context scope, and setting a repository's
 * product. Self-contained registrations, kept out of activation so that
 * function stays a wiring diagram rather than a program.
 */
import * as vscode from "vscode";
import {
  createProduct,
  EnabledProject,
  listProducts,
  setCardProduct,
} from "../core/identity";
import { createWorkProject, setWorkProjectState } from "../core/workProjects";
import { newProjectFlow } from "./projectOps";
import { newAppGesture } from "./templateFlow";
import { editContextScope, findWorkProject } from "./workSession";
import type { ProductItem } from "./projectsTree";

export function productCommands(a: {
  context: vscode.ExtensionContext;
  storeRootOf: () => string;
  configuredStoreRoot: () => string;
  openProjects: () => EnabledProject[];
  refreshTree: () => void;
  activeOwnerKey: (context: vscode.ExtensionContext) => string | undefined;
  rememberedProject: (context: vscode.ExtensionContext) => EnabledProject | undefined;
  openSpaceFor: (id?: string) => Promise<void>;
}): vscode.Disposable[] {
  const {
    context,
    storeRootOf,
    configuredStoreRoot,
    openProjects,
    refreshTree,
    activeOwnerKey,
    rememberedProject,
    openSpaceFor,
  } = a;
  return [
    vscode.commands.registerCommand("thinkube-tandem.newProduct", async () => {
      const name = await vscode.window.showInputBox({
        title: "New Product — the top-level grouping (e.g. KubeXlat)",
        placeHolder: "product name",
      });
      if (!name?.trim()) return;
      const r = createProduct(storeRootOf(), name);
      if (!r.ok) {
        void vscode.window.showErrorMessage(`Tandem: ${r.reason}`);
        return;
      }
      refreshTree();
    }),
    vscode.commands.registerCommand(
      "thinkube-tandem.newProject",
      async (node?: ProductItem) => {
        let product = node?.product;
        if (!product || product === "(unassigned)") {
          const names = listProducts(storeRootOf(), openProjects());
          if (names.length === 0) {
            void vscode.window.showErrorMessage(
              "Tandem: create a Product first (the + on the Projects view title).",
            );
            return;
          }
          product = await vscode.window.showQuickPick(names, {
            title: "New Repository — under which product?",
          });
          if (!product) return;
        }
        const kind = await vscode.window.showQuickPick(
          [
            { label: "Enable a repository", description: "an existing folder in the open workspace", k: "repo" },
            { label: "New project", description: "work that may touch several repositories — no code of its own", k: "work" },
            { label: "New application from a template", description: "the platform instantiates it (Gitea + CI); thinking grounds in the real code", k: "app" },
          ],
          { title: `New under ${product}` },
        );
        if (!kind) return;
        if (kind.k === "repo") {
          await newProjectFlow(product, openProjects, refreshTree);
          return;
        }
        if (kind.k === "app") {
          const owner = activeOwnerKey(context);
          const slug = owner ? context.workspaceState.get<string>(`tandem.space.${owner}`) : undefined;
          await newAppGesture({
            product,
            storeRoot: configuredStoreRoot(),
            ...(owner ? { ownerKey: owner } : {}),
            ...(slug ? { activeSlug: slug } : {}),
            refresh: refreshTree,
            activate: (cardId) => openSpaceFor(cardId),
          });
          return;
        }
        const name = await vscode.window.showInputBox({
          title: `Name the project under ${product}`,
          placeHolder: "e.g. plugin delivery — a bounded piece of work, open until done",
        });
        if (!name?.trim()) return;
        const made = createWorkProject(configuredStoreRoot(), product, name);
        if (!made.ok) {
          void vscode.window.showErrorMessage(`Tandem: ${made.reason}`);
          return;
        }
        refreshTree();
        await openSpaceFor(`wp:${made.project.id}`);
      },
    ),
    vscode.commands.registerCommand(
      "thinkube-tandem.toggleProjectDone",
      (node?: { wp?: { id: string; state: string } }) => {
        if (!node?.wp) return;
        const r = setWorkProjectState(
          configuredStoreRoot(),
          node.wp.id,
          node.wp.state === "done" ? "open" : "done",
        );
        if (!r.ok) void vscode.window.showWarningMessage(`Tandem — ${r.reason}`);
        refreshTree();
      },
    ),
    vscode.commands.registerCommand(
      "thinkube-tandem.setContextScope",
      async (node?: { id?: string }) => {
        const [ownerKey, slug] = (node?.id ?? "").split("/");
        if (!ownerKey?.startsWith("wp:") || !slug) return;
        const wp = findWorkProject(configuredStoreRoot(), ownerKey.slice(3));
        if (!wp) return;
        await editContextScope(configuredStoreRoot(), wp, slug, openProjects());
      },
    ),
    vscode.commands.registerCommand(
      "thinkube-tandem.setProduct",
      async (node?: { project?: EnabledProject }) => {
        const project =
          node?.project ??
          openProjects().find((p) => p.card.id === rememberedProject(context)?.card.id);
        if (!project) return;
        const names = listProducts(storeRootOf(), openProjects());
        const pick = await vscode.window.showQuickPick(
          [...names.map((n) => ({ label: n })), { label: "$(add) New product…" }],
          { title: `Which product does “${project.card.label}” belong to?` },
        );
        if (!pick) return;
        let product = pick.label;
        if (product.startsWith("$(add)")) {
          const typed = await vscode.window.showInputBox({ title: "New product name" });
          if (!typed?.trim()) return;
          createProduct(storeRootOf(), typed);
          product = typed.trim();
        }
        const r = setCardProduct(project.anchorDir, product);
        if (!r.ok) void vscode.window.showErrorMessage(`Tandem: ${r.reason}`);
        refreshTree();
      },
    ),
  ];
}
