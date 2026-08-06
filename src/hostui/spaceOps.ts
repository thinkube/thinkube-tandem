/**
 * Host-side thinking-space gestures (SPEC Amendment 1): resolving which
 * thinking space a repository is working in — remembered per repository, a
 * lone space picked silently, several asked, none prompting to name the
 * first — and the store root they all live under.
 */
import type * as vscodeTypes from "vscode";
import * as path from "node:path";
import { createRequire } from "node:module";
import { createThinkingSpace, listThinkingSpaces } from "../core/spaces";

const req: NodeRequire =
  typeof require !== "undefined" ? require : createRequire(__filename);
function vs(): typeof vscodeTypes {
  return req("vscode") as typeof vscodeTypes;
}

export function configuredStoreRoot(): string {
  return (
    vs().workspace.getConfiguration("thinkubeTandem").get<string>("storeRoot", "") ||
    path.join(process.env.HOME ?? "~", "thinkube-tandem-store")
  );
}

/** The three v1 gestures on the tree: open a space, create one from the
 *  permanent row, delete one (refused after any signature). */
export function registerSpaceCommands(
  context: vscodeTypes.ExtensionContext,
  deps: {
    openSpaceFor: (ownerId: string) => Promise<void>;
    refreshTree: () => void;
    dropSession: (key: string) => void;
    deleteSpace: (
      storeRoot: string,
      ownerId: string,
      slug: string,
      now: () => string,
    ) => { ok: boolean; reason?: string };
  },
): vscodeTypes.Disposable[] {
  const vsc = vs();
  return [
    vsc.commands.registerCommand(
      "thinkube-tandem.openThinkingSpace",
      async (ownerId: string, slug: string) => {
        await context.workspaceState.update(`tandem.space.${ownerId}`, slug);
        await deps.openSpaceFor(ownerId);
      },
    ),
    vsc.commands.registerCommand("thinkube-tandem.newThinkingSpace", async (ownerId: string) => {
      const name = await vsc.window.showInputBox({
        title: "Name the new thinking space",
        prompt: "One stream of thinking — independent of the others.",
        placeHolder: "e.g. plugin delivery, rebrand",
      });
      if (!name) return;
      const made = createThinkingSpace(configuredStoreRoot(), ownerId, name);
      if (!made.ok) {
        void vsc.window.showWarningMessage(`Tandem — ${made.reason}`);
        return;
      }
      deps.refreshTree();
      await context.workspaceState.update(`tandem.space.${ownerId}`, made.slug);
      await deps.openSpaceFor(ownerId);
    }),
    vsc.commands.registerCommand(
      "thinkube-tandem.deleteThinkingSpace",
      async (node?: { id?: string }) => {
        const [ownerId, slug] = (node?.id ?? "").split("/");
        if (!ownerId || !slug) return;
        const sure = await vsc.window.showWarningMessage(
          `Delete the thinking space "${slug}"? Everything unsigned in it is removed.`,
          { modal: true },
          "Delete",
        );
        if (sure !== "Delete") return;
        const r = deps.deleteSpace(configuredStoreRoot(), ownerId, slug, () =>
          new Date().toISOString(),
        );
        if (!r.ok) {
          void vsc.window.showWarningMessage(`Tandem — ${r.reason}`);
          return;
        }
        deps.dropSession(`${ownerId}/${slug}`);
        if (context.workspaceState.get<string>(`tandem.space.${ownerId}`) === slug)
          await context.workspaceState.update(`tandem.space.${ownerId}`, undefined);
        deps.refreshTree();
      },
    ),
  ];
}

/** Undefined = the human dismissed the prompt. */
export async function chooseThinkingSpace(
  context: vscodeTypes.ExtensionContext,
  ownerId: string,
  interactive: boolean,
): Promise<string | undefined> {
  const storeRoot = configuredStoreRoot();
  const spacesNow = listThinkingSpaces(storeRoot, ownerId);
  const savedKey = `tandem.space.${ownerId}`;
  const saved = context.workspaceState.get<string>(savedKey);
  if (saved && spacesNow.some((s) => s.slug === saved)) return saved;
  if (spacesNow.length === 1) {
    await context.workspaceState.update(savedKey, spacesNow[0].slug);
    return spacesNow[0].slug;
  }
  if (!interactive) return undefined;
  if (spacesNow.length === 0) {
    const name = await vs().window.showInputBox({
      title: "Name the first thinking space",
      prompt: "A thinking space is one stream of thinking — a project can hold several.",
      placeHolder: "e.g. main, plugin delivery, rebrand",
    });
    if (!name) return undefined;
    const made = createThinkingSpace(storeRoot, ownerId, name);
    if (!made.ok) {
      void vs().window.showWarningMessage(`Tandem — ${made.reason}`);
      return undefined;
    }
    await context.workspaceState.update(savedKey, made.slug);
    return made.slug;
  }
  const pick = await vs().window.showQuickPick(
    spacesNow.map((s) => ({ label: s.label, description: s.slug })),
    { title: "Which thinking space?" },
  );
  if (!pick) return undefined;
  await context.workspaceState.update(savedKey, pick.description);
  return pick.description;
}
