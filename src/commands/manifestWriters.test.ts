/**
 * Unit tests for the Product/Project manifest writers (SP-tgvl81_SL-3).
 * fs via a tmp board root; no vscode. Round-trips through the discovery cores.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  slugifyId,
  writeProductManifest,
  writeProjectManifest,
} from "./manifestWriters";
import { discoverProducts } from "../store/products";
import { discoverProjects } from "../store/projects";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tk-mwrite-"));
}

test("slugifyId lowercases + dash-joins", () => {
  assert.equal(slugifyId("The Rebrand!"), "the-rebrand");
  assert.equal(slugifyId("  Spaced  Out  "), "spaced-out");
});

test("writeProductManifest creates a product.yaml discoverable by discoverProducts", async () => {
  const root = tmpRoot();
  // a board namespace so the product has a member and surfaces.
  fs.mkdirSync(path.join(root, "thinkube", "core", "x", "specs"), {
    recursive: true,
  });
  const file = await writeProductManifest(root, {
    id: "thinkube",
    name: "Thinkube Platform",
  });
  assert.ok(file.endsWith("thinkube/product.yaml"));
  const p = discoverProducts(root).find((p) => p.id === "thinkube");
  assert.equal(p?.name, "Thinkube Platform");
});

test("writeProjectManifest creates a project.yaml discoverable by discoverProjects", async () => {
  const root = tmpRoot();
  await writeProjectManifest(root, "thinkube", {
    id: "rebrand",
    name: "The Rebrand",
  });
  const pr = discoverProjects(root).find((p) => p.id === "rebrand");
  assert.equal(pr?.product, "thinkube");
  assert.equal(pr?.name, "The Rebrand");
  assert.equal(pr?.state, "open"); // default — a code-less umbrella (no tag)
});
