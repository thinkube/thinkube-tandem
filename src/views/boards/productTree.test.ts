/**
 * Unit tests for the navigator Product-tree view-model (SP-tgvl81_SL-1).
 * Pure — literals only, no vscode/fs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildProductTree,
  projectMembers,
  projectTepGroups,
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

test("projectTepGroups groups implementing specs under each umbrella TEP (SP-tgvpbm)", () => {
  const PROJ = "Platform/projects/rebrand";
  const specs = [
    { board: "thinkube", namespace: "Platform/core/thinkube", handle: "SP-a", implements: `${PROJ}:TEP-reb` },
    { board: "control", namespace: "Platform/core/control", handle: "SP-b", implements: `${PROJ}:TEP-reb` },
    { board: "control", namespace: "Platform/core/control", handle: "SP-c", implements: "TEP-other" }, // non-member
    { board: "thinkube", namespace: "Platform/core/thinkube", handle: "SP-d", implements: `${PROJ}:TEP-two` },
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
    { board: "A", handle: "SP-1", kind: "spec", tags: ["rebrand", "x"] },
    { board: "B", handle: "SP-2_SL-1", kind: "slice", tags: ["rebrand"] },
    { board: "A", handle: "TEP-z", kind: "tep", tags: ["other"] },
    { board: "B", handle: "SP-9", kind: "spec", tags: [] },
  ];
  const members = projectMembers("rebrand", items);
  assert.deepEqual(
    members.map((m) => m.handle),
    ["SP-1", "SP-2_SL-1"],
  );
  // descriptor carries board + kind, drops tags
  assert.deepEqual(members[0], { board: "A", handle: "SP-1", kind: "spec" });
});
