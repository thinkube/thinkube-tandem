/**
 * Unit tests for Product discovery from the sidecar tree (SP-tgvjug_SL-1).
 * fs via a tmp board root; no vscode.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { discoverProducts } from "./products";

/** Build a tmp board-root fixture and return its path. */
function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-products-"));
  const boardShaped = (rel: string) =>
    fs.mkdirSync(path.join(root, rel, "specs"), { recursive: true });

  // Product A: two members nested 2 deep + a product.yaml display name.
  boardShaped("ProdA/core/thinkube");
  boardShaped("ProdA/docs/site");
  fs.writeFileSync(path.join(root, "ProdA", "product.yaml"), "name: Product A\n");

  // Product B: one member 1 deep, no manifest.
  boardShaped("ProdB/app");

  // Malformed manifest → still a Product, name falls back to the dir id.
  boardShaped("Mal/x");
  fs.writeFileSync(path.join(root, "Mal", "product.yaml"), "name: [unterminated\n");

  // Not a product: a top dir with no board-shaped descendant.
  fs.mkdirSync(path.join(root, "Empty", "notaboard"), { recursive: true });

  return root;
}

test("discovers products + members from the sidecar tree (board-shaped descendants)", () => {
  const products = discoverProducts(fixture());
  const byId = new Map(products.map((p) => [p.id, p]));

  assert.deepEqual(
    products.map((p) => p.id),
    ["Mal", "ProdA", "ProdB"], // sorted; Empty excluded
  );
  assert.deepEqual(byId.get("ProdA")?.members, [
    "ProdA/core/thinkube",
    "ProdA/docs/site",
  ]);
  assert.deepEqual(byId.get("ProdB")?.members, ["ProdB/app"]);
});

test("product.yaml `name` enriches; absent → dir id", () => {
  const byId = new Map(discoverProducts(fixture()).map((p) => [p.id, p]));
  assert.equal(byId.get("ProdA")?.name, "Product A"); // from product.yaml
  assert.equal(byId.get("ProdB")?.name, "ProdB"); // no manifest → id
});

test("a malformed product.yaml falls back to the id (never throws)", () => {
  const byId = new Map(discoverProducts(fixture()).map((p) => [p.id, p]));
  assert.equal(byId.get("Mal")?.name, "Mal");
  assert.deepEqual(byId.get("Mal")?.members, ["Mal/x"]);
});

test("a missing board root yields an empty list", () => {
  assert.deepEqual(discoverProducts("/no/such/board/root/xyz"), []);
});
