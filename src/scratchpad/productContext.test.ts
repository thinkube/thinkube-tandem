/**
 * Product-scoped context sources (2026-07-18): the context boundary is the
 * PRODUCT tier — its repositories (sidecar cards mapped through the
 * workspace spelling), never the whole workspace; projects are code-less.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  contextSourcesForSpace,
  productOf,
  productRepoSources,
} from "./productContext";

function makeTree(): {
  store: string;
  platformRepo: string;
  folders: { name: string; path: string }[];
} {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-prodctx-"));
  const store = path.join(base, "store");
  const platform = path.join(base, "thinkube-platform");
  const apps = path.join(base, "apps");
  // Product "Platform" cards: two repos + one code-less project.
  for (const card of [
    "Platform/extensions/thinkube-tandem",
    "Platform/core/thinkube-control",
    "Platform/projects/plugin-delivery",
    "Platform/extensions/ghost-repo", // card with NO repo on disk
  ]) {
    fs.mkdirSync(path.join(store, card), { recursive: true });
    fs.writeFileSync(path.join(store, card, "space.yaml"), "orgs: [x]\n");
  }
  // Real repos on disk for two of the cards.
  const tandemRepo = path.join(platform, "extensions", "thinkube-tandem");
  fs.mkdirSync(tandemRepo, { recursive: true });
  fs.mkdirSync(path.join(platform, "core", "thinkube-control"), {
    recursive: true,
  });
  fs.mkdirSync(apps, { recursive: true });
  return {
    store,
    platformRepo: platform,
    folders: [
      { name: "Apps", path: apps },
      { name: "Platform", path: platform },
      { name: "Tandem Board", path: store },
    ],
  };
}

test("productOf takes the first namespace segment", () => {
  assert.equal(productOf("Platform/projects/plugin-delivery"), "Platform");
  assert.equal(productOf("Platform/extensions/thinkube-tandem"), "Platform");
  assert.equal(productOf(""), "");
});

test("product repositories: cards mapped to existing repos; projects and ghosts excluded", () => {
  const { store, platformRepo, folders } = makeTree();
  const sources = productRepoSources(store, "Platform", folders);
  assert.deepEqual(sources, [
    path.join(platformRepo, "core", "thinkube-control"),
    path.join(platformRepo, "extensions", "thinkube-tandem"),
  ]);
  // projects/ never contributes code context; ghost card has no repo on disk.
  assert.ok(!sources.some((s) => s.includes("plugin-delivery")));
  assert.ok(!sources.some((s) => s.includes("ghost")));
});

test("a project space's context = product repos + its own sidecar (memory), never workspaceFolders[0]", () => {
  const { store, platformRepo, folders } = makeTree();
  const sources = contextSourcesForSpace(
    store,
    "Platform/projects/plugin-delivery",
    folders,
  );
  assert.deepEqual(sources, [
    path.join(platformRepo, "core", "thinkube-control"),
    path.join(platformRepo, "extensions", "thinkube-tandem"),
    path.join(store, "Platform", "projects", "plugin-delivery"),
  ]);
  // The Apps folder (workspaceFolders[0] in the field defect) is NOT a source.
  assert.ok(!sources.some((s) => s.endsWith("/apps")));
});

test("no sidecar root -> no sources (honest empty, no guessing)", () => {
  const { folders } = makeTree();
  assert.deepEqual(
    contextSourcesForSpace(undefined, "Platform/projects/x", folders),
    [],
  );
});

test("scope filters candidate repos; sidecar always included (2026-07-18)", () => {
  const { store, platformRepo, folders } = makeTree();
  const tandem = path.join(platformRepo, "extensions", "thinkube-tandem");
  const scoped = contextSourcesForSpace(
    store,
    "Platform/projects/plugin-delivery",
    folders,
    [tandem],
  );
  // only the selected repo + the space sidecar
  assert.ok(scoped.includes(tandem));
  assert.ok(scoped.some((s) => s.includes("plugin-delivery")));
  assert.ok(!scoped.some((s) => s.includes("thinkube-control")));
});

test("candidateRepoSources lists the product repos to select from", async () => {
  const { store, platformRepo, folders } = makeTree();
  const { candidateRepoSources } = await import("./productContext");
  const cands = candidateRepoSources(store, "Platform/projects/plugin-delivery", folders);
  assert.equal(cands.length, 2);
  assert.ok(cands.every((c) => c.startsWith(platformRepo)));
});
