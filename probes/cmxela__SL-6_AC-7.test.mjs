// WHY (INVARIANT): once a space's tab is closed, the tree must stop marking
// it open — an open dot left behind after the tab is gone would lie about
// what is actually on screen. This must hold for as long as the tree reads
// the open-space set.
//
// This check EXECUTES the real ProjectsTreeProvider. The module reaches the
// editor host only through a lazy `require("vscode")` accessor — a seam this
// repository defines — so filling that seam with a stand-in lets the real
// getChildren run twice, across a tab closing, and be observed. Reading the
// source text instead could never show that the SECOND render changed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installVscodeStub } from "./_vscodeStub.mjs";

installVscodeStub();

const { ProjectsTreeProvider, ProductItem } = await import(
  "../out-test/hostui/projectsTree.js"
);

const OWNER_ID = "repo-1";

function repository() {
  return {
    card: { id: OWNER_ID, label: "Repo One", product: "Tandem" },
    gitRoot: "/repo",
    prefix: "",
    anchorDir: "/repo",
  };
}

function isMarkedOpen(row) {
  return row.description === "●";
}

test("a space whose tab was closed is no longer marked open in the tree", () => {
  const spaces = [
    { slug: "alpha", label: "Alpha" },
    { slug: "beta", label: "Beta" },
  ];

  // The live set of open tabs. The tree is handed a READER of this set, not
  // a snapshot of it — closing a tab mutates what the next render sees.
  let open = ["alpha", "beta"];

  const provider = new ProjectsTreeProvider(
    () => ["Tandem"],
    () => [repository()],
    () => OWNER_ID,
    () => spaces,
    () => open,
    () => [],
  );

  const spaceRows = () => {
    const product = provider.getChildren().find((r) => r instanceof ProductItem);
    assert.ok(product, "the tree must render a product row");
    const repoRow = provider
      .getChildren(product)
      .find((r) => r.project?.card?.id === OWNER_ID);
    assert.ok(repoRow, "the tree must render the repository row");
    const bySlug = new Map();
    for (const row of provider.getChildren(repoRow)) {
      const id = String(row.id ?? "");
      bySlug.set(id.slice(id.indexOf("/") + 1), row);
    }
    return bySlug;
  };

  const before = spaceRows();
  assert.ok(isMarkedOpen(before.get("alpha")), "alpha starts open");
  assert.ok(isMarkedOpen(before.get("beta")), "beta starts open");

  // The editor closed beta's tab. Nothing re-built the provider — only the
  // open-space source changed.
  open = ["alpha"];

  const after = spaceRows();
  assert.ok(
    isMarkedOpen(after.get("alpha")),
    "alpha's tab is still open and must still be marked",
  );
  assert.ok(
    !isMarkedOpen(after.get("beta")),
    "beta's tab was closed, so the very next render must stop marking it open — a dot outliving its tab is the defect this forbids",
  );
});
