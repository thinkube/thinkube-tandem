/**
 * Unit tests for Project discovery from the sidecar tree.
 * fs via a tmp thinking space root; no vscode.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { discoverProjects } from "./projects";

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-projects-"));
  const project = (rel: string, yaml: string) => {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
    fs.writeFileSync(path.join(root, rel, "project.yaml"), yaml);
  };
  // Full manifest.
  project(
    "ProdA/projects/rebrand",
    "name: The Rebrand\nstate: open\ntag: rebrand\ntep: TEP-tgkx1k\n",
  );
  // Partial: only state — name/tag default to the id, tep absent.
  project("ProdA/projects/search", "state: done\n");
  // Malformed YAML → all defaults.
  project("ProdB/projects/bad", "name: [unterminated\n");
  // A product with no projects/ contributes none.
  fs.mkdirSync(path.join(root, "ProdC", "core", "x", "specs"), {
    recursive: true,
  });
  return root;
}

test("discovers projects across products, sorted by (product, id)", () => {
  const ps = discoverProjects(fixture());
  assert.deepEqual(
    ps.map((p) => `${p.product}/${p.id}`),
    ["ProdA/rebrand", "ProdA/search", "ProdB/bad"], // ProdC excluded
  );
});

test("full manifest is read", () => {
  const p = discoverProjects(fixture()).find((p) => p.id === "rebrand")!;
  assert.equal(p.name, "The Rebrand");
  assert.equal(p.state, "open");
  assert.equal(p.tag, "rebrand");
  assert.equal(p.tep, "TEP-tgkx1k");
  assert.equal(p.manifestPath, "ProdA/projects/rebrand/project.yaml");
});

test("partial manifest defaults: name→id, tag→id, tep absent; state honored", () => {
  const p = discoverProjects(fixture()).find((p) => p.id === "search")!;
  assert.equal(p.name, "search");
  assert.equal(p.tag, "search");
  assert.equal(p.state, "done");
  assert.equal(p.tep, undefined);
});

test("malformed manifest falls back to all defaults (never throws)", () => {
  const p = discoverProjects(fixture()).find((p) => p.id === "bad")!;
  assert.equal(p.name, "bad");
  assert.equal(p.state, "open");
  assert.equal(p.tag, "bad");
});

test("a missing thinking space root yields an empty list", () => {
  assert.deepEqual(discoverProjects("/no/such/root/xyz"), []);
});
