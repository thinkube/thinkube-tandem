/**
 * Unit tests for the navigator Product-tree view-model.
 * Pure — literals only, no vscode/fs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildProductTree,
  projectMembers,
  projectTepGroups,
  specsImplementing,
  RepoRef,
} from "./productTree";
import type { Product } from "../../store/products";
import type { Project } from "../../store/projects";

const products: Product[] = [
  { id: "Platform", name: "Thinkube Platform", members: [], },
  { id: "Apps", name: "Apps", members: [] },
];
const projects: Project[] = [
  {
    product: "Platform",
    id: "rebrand",
    name: "The Rebrand",
    state: "open",
    tag: "rebrand",
    manifestPath: "Platform/projects/rebrand/project.yaml",
  },
];
const repos: RepoRef[] = [
  { path: "/r/thinkube", namespace: "Platform/core/thinkube" },
  { path: "/r/control", namespace: "Platform/core/thinkube-control" },
  { path: "/r/app1", namespace: "Apps/app1" },
  { path: "/r/loose", namespace: undefined }, // no namespace → ungrouped
  { path: "/r/other", namespace: "Unknown/x" }, // no matching product → ungrouped
];

test("groups repos under their Product by namespace first segment", () => {
  const tree = buildProductTree(products, projects, repos);
  const platform = tree.products.find((p) => p.id === "Platform")!;
  assert.deepEqual(platform.repoPaths, ["/r/thinkube", "/r/control"]);
  assert.equal(platform.name, "Thinkube Platform");
  const apps = tree.products.find((p) => p.id === "Apps")!;
  assert.deepEqual(apps.repoPaths, ["/r/app1"]);
});

test("attaches each Product's projects", () => {
  const tree = buildProductTree(products, projects, repos);
  const platform = tree.products.find((p) => p.id === "Platform")!;
  assert.deepEqual(
    platform.projects.map((p) => `${p.id}:${p.tag}`),
    ["rebrand:rebrand"],
  );
  assert.deepEqual(tree.products.find((p) => p.id === "Apps")!.projects, []);
});

test("repos under no matching product are ungrouped (nothing disappears)", () => {
  const tree = buildProductTree(products, projects, repos);
  assert.deepEqual(tree.ungroupedRepoPaths, ["/r/loose", "/r/other"]);
});

test("no products → every repo is ungrouped", () => {
  const tree = buildProductTree([], [], repos);
  assert.equal(tree.products.length, 0);
  assert.equal(tree.ungroupedRepoPaths.length, repos.length);
});

test("specsImplementing: umbrella TEP → cross-repo set; repo TEP → same-repo; excludes others", () => {
  const PROJ = "Platform/projects/rebrand";
  const REPO = "Platform/core/thinkube";
  const specs = [
    { thinkingSpace: "thinkube", namespace: REPO, handle: "SP-a", implements: `${PROJ}:TEP-reb` },
    { thinkingSpace: "control", namespace: "Platform/core/control", handle: "SP-b", implements: `${PROJ}:TEP-reb` },
    { thinkingSpace: "thinkube", namespace: REPO, handle: "SP-c", implements: "TEP-local" }, // bare, repo-local
    { thinkingSpace: "control", namespace: "Platform/core/control", handle: "SP-d", implements: "TEP-other" },
  ];
  // umbrella TEP → the two qualified implementers across repos
  assert.deepEqual(
    specsImplementing(PROJ, "reb", specs).map((s) => s.handle),
    ["SP-a", "SP-b"],
  );
  // repo TEP (owner = the repo namespace) → the bare implementer in that repo
  assert.deepEqual(
    specsImplementing(REPO, "local", specs).map((s) => s.handle),
    ["SP-c"],
  );
});

test("projectTepGroups groups implementing specs under each umbrella TEP", () => {
  const PROJ = "Platform/projects/rebrand";
  const specs = [
    { thinkingSpace: "thinkube", namespace: "Platform/core/thinkube", handle: "SP-a", implements: `${PROJ}:TEP-reb` },
    { thinkingSpace: "control", namespace: "Platform/core/control", handle: "SP-b", implements: `${PROJ}:TEP-reb` },
    { thinkingSpace: "control", namespace: "Platform/core/control", handle: "SP-c", implements: "TEP-other" }, // non-member
    { thinkingSpace: "thinkube", namespace: "Platform/core/thinkube", handle: "SP-d", implements: `${PROJ}:TEP-two` },
  ];
  const groups = projectTepGroups(PROJ, ["reb", "two"], specs);
  assert.deepEqual(
    groups.find((g) => g.tepId === "reb")?.specs.map((s) => s.handle),
    ["SP-a", "SP-b"],
  );
  assert.deepEqual(
    groups.find((g) => g.tepId === "two")?.specs.map((s) => s.handle),
    ["SP-d"],
  );
});

test("projectMembers keeps only items carrying the project tag (SL-2)", () => {
  const items = [
    { thinkingSpace: "A", handle: "SP-1", kind: "spec", tags: ["rebrand", "x"] },
    { thinkingSpace: "B", handle: "SP-2_SL-1", kind: "slice", tags: ["rebrand"] },
    { thinkingSpace: "A", handle: "TEP-z", kind: "tep", tags: ["other"] },
    { thinkingSpace: "B", handle: "SP-9", kind: "spec", tags: [] },
  ];
  const members = projectMembers("rebrand", items);
  assert.deepEqual(
    members.map((m) => m.handle),
    ["SP-1", "SP-2_SL-1"],
  );
  // descriptor carries thinking space + kind, drops tags
  assert.deepEqual(members[0], { thinkingSpace: "A", handle: "SP-1", kind: "spec" });
});
