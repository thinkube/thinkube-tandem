/**
 * Host-side thinking-space gestures (SPEC Amendment 1): resolving which
 * thinking space a repository is working in — remembered per repository, a
 * lone space picked silently, several asked, none prompting to name the
 * first — and the store root they all live under.
 */
import type * as vscodeTypes from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { createThinkingSpace, DeletionCost, listThinkingSpaces, SpaceOwnerKind } from "../core/spaces";
import { vs } from "../core/vscodeHost";

/** Owner keys: a repository card id, or "wp:<project-id>" for a project. */
function parseOwner(ownerKey: string): { id: string; kind: SpaceOwnerKind } {
  return ownerKey.startsWith("wp:")
    ? { id: ownerKey.slice(3), kind: "project" }
    : { id: ownerKey, kind: "repository" };
}

/** The name a thinking space is known by: what the human wrote in
 *  name.txt when they created it, or the directory slug when no name was
 *  ever recorded (a space made before naming, or read by slug alone). A
 *  panel titles itself with this and never re-derives it later. */
export function spaceTitle(storeRoot: string, ownerKey: string, slug: string): string {
  const owner = parseOwner(ownerKey);
  const home = owner.kind === "project" ? "projects" : "spaces";
  const nameFile = path.join(storeRoot, home, owner.id, slug, "name.txt");
  try {
    const t = fs.readFileSync(nameFile, "utf8").trim();
    if (t) return t;
  } catch {
    /* no name.txt — the slug is the title */
  }
  return slug;
}

export function configuredStoreRoot(): string {
  return (
    vs().workspace.getConfiguration("thinkubeTandem").get<string>("storeRoot", "") ||
    path.join(process.env.HOME ?? "~", "thinkube-tandem-store")
  );
}

/** The three v1 gestures on the tree: open a space, create one from the
 *  permanent row, delete one (refused only once something was merged). */
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
      kind?: SpaceOwnerKind,
    ) => { ok: boolean; reason?: string };
    costOfDeleting: (
      storeRoot: string,
      ownerId: string,
      slug: string,
      now: () => string,
      kind?: SpaceOwnerKind,
    ) => DeletionCost;
    /** Remove what the space's runs created OUTSIDE its directory —
     *  worktrees, oracle stores, locks, branches (forge included). Returns
     *  notes for whatever could not go. */
    sweepResidue: (ownerKey: string, cost: DeletionCost) => Promise<string[]>;
  },
): vscodeTypes.Disposable[] {
  const vsc = vs();
  return [
    vsc.commands.registerCommand(
      "thinkube-tandem.openThinkingSpace",
      async (ownerKey: string, slug: string) => {
        await context.workspaceState.update(`tandem.space.${ownerKey}`, slug);
        await deps.openSpaceFor(ownerKey);
      },
    ),
    vsc.commands.registerCommand("thinkube-tandem.newThinkingSpace", async (ownerKey: string) => {
      const name = await vsc.window.showInputBox({
        title: "Name the new thinking space",
        prompt: "One stream of thinking — independent of the others.",
        placeHolder: "e.g. plugin delivery, rebrand",
      });
      if (!name) return;
      const owner = parseOwner(ownerKey);
      const made = createThinkingSpace(configuredStoreRoot(), owner.id, name, owner.kind);
      if (!made.ok) {
        void vsc.window.showWarningMessage(`Tandem — ${made.reason}`);
        return;
      }
      deps.refreshTree();
      await context.workspaceState.update(`tandem.space.${ownerKey}`, made.slug);
      await deps.openSpaceFor(ownerKey);
    }),
    vsc.commands.registerCommand(
      "thinkube-tandem.deleteThinkingSpace",
      async (node?: { id?: string }) => {
        const [ownerId, slug] = (node?.id ?? "").split("/");
        if (!ownerId || !slug) return;
        const owner = parseOwner(ownerId);
        // What it costs is said BEFORE the press, in the same breath as
        // the question. A refusal afterwards teaches a rule the surface
        // never taught.
        const cost = deps.costOfDeleting(configuredStoreRoot(), owner.id, slug, () =>
          new Date().toISOString(), owner.kind,
        );
        const detail = [
          `${cost.asks} sentence${cost.asks === 1 ? "" : "s"} you wrote, and everything read from them, exist only here and go with it.`,
          cost.teps.length
            ? `Everything ${cost.teps.join(", ")} created goes too: the worktrees, run records and locks on this machine, and the branch${cost.branches.length === 1 ? "" : "es"} ${cost.branches.join(", ") || "it pushed"} — from this repository and from the forge. Only the TEP number${cost.teps.length === 1 ? "" : "s"} stay${cost.teps.length === 1 ? "s" : ""} spent; numbers are never reused.`
            : "",
          cost.merged.length
            ? `${cost.merged.join(", ")} was accepted and merged, so this cannot be deleted.`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        const sure = await vsc.window.showWarningMessage(
          `Delete the thinking space "${slug}"?`,
          { modal: true, detail },
          "Delete",
        );
        if (sure !== "Delete") return;
        const r = deps.deleteSpace(configuredStoreRoot(), owner.id, slug, () =>
          new Date().toISOString(), owner.kind,
        );
        if (!r.ok) {
          void vsc.window.showWarningMessage(`Tandem — ${r.reason}`);
          return;
        }
        // What the runs created outside the space goes with it. The cost
        // was computed BEFORE the directory went — it is the only list of
        // what to sweep. Notes surface; cleanup never blocks the deletion.
        const notes = await deps.sweepResidue(ownerId, cost).catch((err) => [
          `the run residue was not swept: ${err instanceof Error ? err.message : String(err)}`,
        ]);
        if (notes.length)
          void vsc.window.showWarningMessage(`Tandem — ${notes.join(" · ")}`);
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
  ownerKey: string,
  interactive: boolean,
): Promise<string | undefined> {
  const storeRoot = configuredStoreRoot();
  const owner = parseOwner(ownerKey);
  const spacesNow = listThinkingSpaces(storeRoot, owner.id, owner.kind);
  const savedKey = `tandem.space.${ownerKey}`;
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
    const made = createThinkingSpace(storeRoot, owner.id, name, owner.kind);
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
