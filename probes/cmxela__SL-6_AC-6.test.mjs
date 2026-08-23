// WHY (TRANSITION): the tree used to mark only the ONE remembered active
// slug per owner as open; now that a person can have several tabs open on
// one owner at once, the tree must mark every open space, not just the
// remembered one.
//
// This check EXECUTES the real ProjectsTreeProvider. The module reaches the
// editor host only through a lazy `require("vscode")` accessor — a seam this
// repository defines — so filling that seam with a stand-in lets the real
// getChildren run and be observed. Reading the source text instead would
// prove nothing about what the tree actually renders.
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

/** Drives the provider down to one repository's thinking-space rows. */
function spaceRowsFor(openSlugs, spaces) {
  const provider = new ProjectsTreeProvider(
    () => ["Tandem"],
    () => [repository()],
    () => OWNER_ID,
    () => spaces,
    (ownerKey) => {
      assert.equal(ownerKey, OWNER_ID, "the tree must ask for open spaces by owner key");
      return openSlugs;
    },
    () => [],
  );

  const roots = provider.getChildren();
  const product = roots.find((r) => r instanceof ProductItem);
  assert.ok(product, "the tree must render a product row to drill into");

  const underProduct = provider.getChildren(product);
  const repoRow = underProduct.find((r) => r.project?.card?.id === OWNER_ID);
  assert.ok(repoRow, "the tree must render the repository row");

  return provider.getChildren(repoRow);
}

/** A rendered space row is marked open when it carries the open dot. */
function isMarkedOpen(row) {
  return row.description === "●";
}

test("with two spaces of one owner open, the tree marks both as open rather than only the remembered one", () => {
  const spaces = [
    { slug: "alpha", label: "Alpha" },
    { slug: "beta", label: "Beta" },
    { slug: "gamma", label: "Gamma" },
  ];

  // TWO spaces of the SAME owner are open at once — the case a single
  // remembered active slug structurally cannot represent.
  const rows = spaceRowsFor(["alpha", "beta"], spaces);

  const bySlug = new Map();
  for (const row of rows) {
    const id = String(row.id ?? "");
    const slug = id.slice(id.indexOf("/") + 1);
    bySlug.set(slug, row);
  }

  assert.ok(bySlug.has("alpha") && bySlug.has("beta") && bySlug.has("gamma"),
    `the tree must render a row per space, got ids: ${[...bySlug.keys()].join(", ")}`);

  assert.ok(
    isMarkedOpen(bySlug.get("alpha")),
    "the first of the two open spaces must be marked open",
  );
  assert.ok(
    isMarkedOpen(bySlug.get("beta")),
    "the SECOND open space of the same owner must ALSO be marked open — marking only one is the defect this replaces",
  );
  assert.ok(
    !isMarkedOpen(bySlug.get("gamma")),
    "a space with no open tab must not be marked open",
  );
});
