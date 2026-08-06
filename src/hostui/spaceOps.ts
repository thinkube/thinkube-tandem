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
