/**
 * Identity discipline over real files: cards mint once and never twice,
 * ids are immutable and never re-derived from spellings, monorepo subtree
 * cards get their prefix mechanically from the enclosing git root, and
 * scope openness maps by identity — never by name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  discoverProjects,
  mintCard,
  mintId,
  readCard,
  scopesNotOpen,
  CARD_RELPATH,
} from "./identity";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tandem-id-"));
}

test("a card mints once with a stable id; a second mint refuses — identity is immutable", () => {
  const dir = tmp();
  const minted = mintCard(dir, { label: "KubeXlat aligner", product: "KubeXlat" }, () => "abc123");
  assert.ok(minted.ok);
  assert.equal(minted.card.id, "kubexlat-aligner-abc123");
  const again = mintCard(dir, { label: "renamed later" });
  assert.ok(!again.ok && again.reason.includes("immutable"));
  const read = readCard(dir)!;
  assert.equal(read.id, "kubexlat-aligner-abc123");
  assert.equal(read.product, "KubeXlat");
});

test("a directory without a card is not enabled", () => {
  assert.equal(readCard(tmp()), undefined);
});

test("labels are labels: editing the card's label never touches the id", () => {
  const dir = tmp();
  const m = mintCard(dir, { label: "old name" }, () => "aa11");
  assert.ok(m.ok);
  const cardPath = path.join(dir, CARD_RELPATH);
  fs.writeFileSync(cardPath, fs.readFileSync(cardPath, "utf8").replace("old name", "brand new name"));
  const read = readCard(dir)!;
  assert.equal(read.label, "brand new name");
  assert.equal(read.id, "old-name-aa11", "the minted id survives the rename untouched");
});

test("monorepo sub-projects: subtree cards discovered with a mechanical prefix", () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  const sub = path.join(root, "extensions", "alpha");
  fs.mkdirSync(sub, { recursive: true });
  assert.ok(mintCard(root, { label: "platform" }, () => "r1").ok);
  assert.ok(mintCard(sub, { label: "alpha ext" }, () => "s1").ok);
  const found = discoverProjects(root);
  assert.equal(found.length, 2);
  const anchor = found.find((p) => p.card.id === "platform-r1")!;
  assert.equal(anchor.prefix, "", "the repo-root card has no prefix");
  const subP = found.find((p) => p.card.id === "alpha-ext-s1")!;
  assert.equal(subP.prefix, "extensions/alpha", "the subtree prefix derives from the git root");
  assert.equal(subP.gitRoot, path.resolve(root));
});

test("multirepo scopes map by identity: an id that is open is open, a name never matters", () => {
  const coord = tmp();
  fs.mkdirSync(path.join(coord, ".git"), { recursive: true });
  const m = mintCard(coord, { label: "kubexlat" }, () => "c0");
  assert.ok(m.ok);
  const cardPath = path.join(coord, CARD_RELPATH);
  fs.writeFileSync(
    cardPath,
    fs.readFileSync(cardPath, "utf8") +
      `scopes:\n  - id: aligner-x1\n    label: aligner\n  - id: splitter-x2\n    label: splitter\n`,
  );
  const member = tmp();
  fs.mkdirSync(path.join(member, ".git"), { recursive: true });
  assert.ok(mintCard(member, { label: "totally different folder name" }, () => "x1").ok);
  // The member card's id must equal the declared scope id for the mapping —
  // rewrite it to the declared identity (enablement records the same id).
  const mPath = path.join(member, CARD_RELPATH);
  fs.writeFileSync(mPath, fs.readFileSync(mPath, "utf8").replace(/id: .*/, "id: aligner-x1"));

  const open = [...discoverProjects(coord), ...discoverProjects(member)];
  const project = open.find((p) => p.card.id === "kubexlat-c0")!;
  const missing = scopesNotOpen(project, open);
  assert.deepEqual(
    missing.map((s) => s.id),
    ["splitter-x2"],
    "the aligner scope is open by identity; the splitter scope is named as not open",
  );
});

test("minted ids stay human-tolerable and unique-suffixed", () => {
  assert.match(mintId("My Great Project!"), /^my-great-project-[0-9a-f]{6}$/);
  assert.match(mintId("   "), /^space-[0-9a-f]{6}$/);
});

test("products: an empty product persists as a file; the list unions files with card labels", async () => {
  const { listProducts, createProduct } = await import("./identity");
  const storeRoot = tmp();
  assert.ok(createProduct(storeRoot, "KubeXlat").ok);
  assert.ok(!createProduct(storeRoot, "KubeXlat").ok, "no duplicate product");
  const dir = tmp();
  const m = mintCard(dir, { label: "tool", product: "Platform" }, () => "p1");
  assert.ok(m.ok);
  const projects = discoverProjects(dir);
  assert.deepEqual(listProducts(storeRoot, projects), ["KubeXlat", "Platform"]);
});
