/**
 * INVARIANT — the projects tree marks a space's row as open by asking the
 * tab registry which keys have an open tab; with several tabs open for the
 * same owner, every one of those spaces must show up, not only the most
 * recently opened. This must always hold as more spaces open tabs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { SpaceTabs } from "./panels";
import { isSpaceOpen, spaceOpenMarker } from "../hostui/hostDecisions";

/**
 * `projectsTree.ts` imports `vscode`, which exists only inside the editor
 * host. Standing this minimal double in the module cache before the tree is
 * loaded is what lets the REAL `ProjectsTreeProvider` be driven here: the
 * marking rule is only worth proving where the tree actually consumes it,
 * one row at a time, and a rule proved apart from its consumer would stay
 * green if the tree stopped calling it per row.
 */
function installVscodeStub(): void {
  class TreeItem {
    label: string;
    collapsibleState: number;
    id?: string;
    contextValue?: string;
    description?: string | boolean;
    tooltip?: string;
    iconPath?: unknown;
    command?: unknown;
    constructor(label: string, collapsibleState: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }
  const stub = {
    TreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: class {
      constructor(public readonly icon: string) {}
    },
    EventEmitter: class {
      private cbs: (() => void)[] = [];
      event = (cb: () => void) => {
        this.cbs.push(cb);
        return { dispose: () => {} };
      };
      fire() {
        for (const cb of this.cbs) cb();
      }
      dispose() {}
    },
    workspace: { asRelativePath: (p: string) => p },
  };
  const Mod = require("node:module") as {
    _load(request: string, parent: unknown, isMain: boolean): unknown;
  };
  const realLoad = Mod._load;
  Mod._load = function (request: string, parent: unknown, isMain: boolean) {
    if (request === "vscode") return stub;
    return realLoad.call(this, request, parent, isMain);
  };
}

interface FakeTab {
  key: string;
  title: string;
  reveal(): void;
  push(payload: unknown): void;
  dispose(): void;
}

function fakeFactory(): (key: string, title: string) => FakeTab {
  return (key, title) => ({
    key,
    title,
    reveal() {},
    push() {},
    dispose() {},
  });
}

test("with tabs open for two spaces of the same owner, the tree marks both rows as open, not only the last one chosen", () => {
  const tabs = new SpaceTabs(fakeFactory());

  tabs.open("repo-a/alpha", "Alpha");
  tabs.open("repo-a/beta", "Beta");

  const open = new Set(tabs.keys());

  assert.equal(open.has("repo-a/alpha"), true, "the earlier-opened space must still be marked open");
  assert.equal(open.has("repo-a/beta"), true, "the most recently opened space must be marked open");
  assert.equal(open.size, 2);

  // The marking rule the tree is actually given must say the same: BOTH
  // rows of one owner are marked, not only the last one chosen.
  const keys = tabs.keys();
  assert.equal(isSpaceOpen(keys, "repo-a", "alpha"), true, "the earlier-opened row must be marked");
  assert.equal(isSpaceOpen(keys, "repo-a", "beta"), true, "the later-opened row must be marked");
  assert.equal(isSpaceOpen(keys, "repo-a", "never-opened"), false, "a space with no tab must not be marked");
  // A different owner sharing a slug must not borrow another owner's mark.
  assert.equal(isSpaceOpen(keys, "repo-b", "alpha"), false, "marking must be per owner, not per slug");

  // The predicate the tree is ACTUALLY handed — built the same way the host
  // builds it, over this registry — must mark both rows too. Driving only
  // `isSpaceOpen` would leave the wiring that feeds it untested.
  const marked = spaceOpenMarker(() => tabs.keys());
  assert.equal(marked("repo-a", "alpha"), true, "the earlier-opened row must be marked through the tree's own predicate");
  assert.equal(marked("repo-a", "beta"), true, "the later-opened row must be marked through the tree's own predicate");
  assert.equal(marked("repo-a", "never-opened"), false);
  assert.equal(marked("repo-b", "alpha"), false, "marking must stay per owner through the tree's own predicate");

  // The predicate reads the registry as each row is drawn: a tab opened
  // after wiring must mark its row, and one closed must stop marking it.
  // A predicate built over a snapshot of the keys would fail both.
  tabs.open("repo-a/gamma", "Gamma");
  assert.equal(marked("repo-a", "gamma"), true, "a space opened after wiring must be marked");
  tabs.close("repo-a/alpha");
  assert.equal(marked("repo-a", "alpha"), false, "a space closed after wiring must stop being marked");
  assert.equal(marked("repo-a", "beta"), true, "closing one space must not unmark another");

  // The tree consumes the predicate ONE ROW AT A TIME, per owner and slug,
  // as it draws each space of an owner (`ThinkingSpacesProvider` calls
  // `this.isSpaceOpen(ownerKey, s.slug)` once per space). Driving it the
  // way the tree holds it — mapping a whole owner's rows through the one
  // predicate — is what catches a rule that answers for only one space of
  // an owner: a per-owner rule passes every single-row assertion above and
  // fails only here, where two rows of one owner are drawn together.
  const drawOwnerRows = (
    ownerKey: string,
    slugs: readonly string[],
    isSpaceOpen: (ownerKey: string, slug: string) => boolean,
  ) => slugs.map((slug) => ({ slug, open: isSpaceOpen(ownerKey, slug) }));

  const rows = drawOwnerRows("repo-a", ["beta", "gamma", "never-opened"], marked);
  assert.deepEqual(
    rows,
    [
      { slug: "beta", open: true },
      { slug: "gamma", open: true },
      { slug: "never-opened", open: false },
    ],
    "drawing one owner's rows must mark every space that has a tab, not only the last one chosen",
  );
  assert.equal(
    rows.filter((r) => r.open).length,
    2,
    "two spaces of one owner hold tabs, so two of that owner's rows must be marked open",
  );

  // The rule must hold where the tree ACTUALLY applies it. Everything above
  // drives the marking rule and the predicate directly; this drives the real
  // `ProjectsTreeProvider` — the code this promise lands in — and reads the
  // rows it builds. A tree that marked only one space per owner, or dropped
  // the predicate entirely, passes every assertion above and fails here.
  installVscodeStub();
  let treeMod: typeof import("../hostui/projectsTree");
  try {
    treeMod = require("../hostui/projectsTree") as typeof import("../hostui/projectsTree");
  } catch (err) {
    throw new Error(`loading the real projects tree failed: ${(err as Error).message}`);
  }
  const { ProjectsTreeProvider, ProductItem } = treeMod;

  const repoCard = {
    card: { id: "repo-a", label: "Repo A", product: "Prod" },
    anchorDir: path.join("/tmp", "repo-a"),
    gitRoot: path.join("/tmp", "repo-a"),
    prefix: "",
  };
  const tree = new ProjectsTreeProvider(
    () => ["Prod"],
    () => [repoCard] as never,
    () => undefined,
    (ownerKey) =>
      ownerKey === "repo-a"
        ? [
            { slug: "beta", label: "Beta" },
            { slug: "gamma", label: "Gamma" },
            { slug: "never-opened", label: "Never Opened" },
          ]
        : [],
    marked,
    () => [],
  );

  const products = tree.getChildren();
  const product = products.find((p) => p instanceof ProductItem)!;
  assert.ok(product, "the tree must draw the product row");
  const repoRow = tree.getChildren(product)[0];
  assert.ok(repoRow, "the product must hold the repository row");
  const spaceRows = tree
    .getChildren(repoRow)
    .filter((n) => n.contextValue === "tandem-thinking-space");

  // The tree marks an open space with the "●" description on its row.
  const marks = spaceRows.map((n) => ({
    id: String(n.id),
    open: n.description === "●",
  }));
  assert.deepEqual(
    marks,
    [
      { id: "repo-a/beta", open: true },
      { id: "repo-a/gamma", open: true },
      { id: "repo-a/never-opened", open: false },
    ],
    "the tree must mark every space of an owner that holds a tab, not only the last one chosen",
  );
  assert.equal(
    marks.filter((m) => m.open).length,
    2,
    "two spaces of one owner hold tabs, so the tree must draw two marked rows",
  );
});
