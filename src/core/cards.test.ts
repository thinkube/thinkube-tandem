/**
 * Where a project's identity is kept, and what survives losing the machine.
 *
 * The card is the one link between a working tree and the spaces filed
 * under it. It used to sit untracked in the repository, which meant a
 * reinstall restored the store — every space, every delivery — with no way
 * left on earth to say which repository each belonged to.
 *
 * These drives hold the store to that: a card is found from what the
 * repository itself says about itself, an older install's card is imported
 * once and then gone from the working tree, and two clones of one
 * repository are one project, not two.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { allCards, matchCard, putCard, sameRemote } from "./cards";
import { discoverProjects, mintCard } from "./identity";

/** A git repository on disk, with the remote it names for itself. */
function repoAt(remote?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-repo-"));
  execFileSync("git", ["-C", dir, "init", "-q"], { stdio: "ignore" });
  if (remote) execFileSync("git", ["-C", dir, "remote", "add", "origin", remote], { stdio: "ignore" });
  return dir;
}

function storeAt(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tandem-store-"));
}

test("a minted card lands in the store, not in the repository", () => {
  const store = storeAt();
  const repo = repoAt("git@github.com:someone/thing.git");

  const minted = mintCard(repo, { label: "Thing" }, store, () => "aa11");
  assert.equal(minted.ok, true);

  assert.equal(fs.existsSync(path.join(repo, ".tandem", "space.yaml")), false);
  const held = allCards(store);
  assert.equal(held.length, 1);
  assert.equal(held[0].label, "Thing");
  assert.equal(held[0].remote, "git@github.com:someone/thing.git");
});

test("a fresh clone of the same repository is the same project", () => {
  const store = storeAt();
  const remote = "git@github.com:someone/thing.git";
  const first = repoAt(remote);
  const minted = mintCard(first, { label: "Thing" }, store, () => "aa11");
  assert.equal(minted.ok, true);

  // The machine is reinstalled: the store comes back, the repository is
  // cloned again somewhere else entirely, and nothing was carried across.
  const clone = repoAt(remote);
  const found = discoverProjects(clone, store);
  assert.equal(found.length, 1);
  assert.equal(found[0].card.id, minted.ok ? minted.card.id : "");
  assert.equal(found[0].anchorDir, path.resolve(clone));
});

test("a card an older install left behind is imported once, then gone", () => {
  const store = storeAt();
  const repo = repoAt("https://github.com/someone/thing.git");
  fs.mkdirSync(path.join(repo, ".tandem"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, ".tandem", "space.yaml"),
    "id: thing-old99\nlabel: Thing\nproduct: Platform\n",
  );

  const found = discoverProjects(repo, store);
  assert.equal(found.length, 1);
  assert.equal(found[0].card.id, "thing-old99");
  assert.equal(found[0].card.product, "Platform");

  assert.equal(fs.existsSync(path.join(repo, ".tandem", "space.yaml")), false);
  assert.equal(fs.existsSync(path.join(repo, ".tandem")), true);

  const held = allCards(store);
  assert.equal(held.length, 1);
  assert.equal(held[0].id, "thing-old99");

  // Read again with the working-tree file gone: still the same project.
  const again = discoverProjects(repo, store);
  assert.equal(again.length, 1);
  assert.equal(again[0].card.id, "thing-old99");
});

test("a repository that names no remote is found by where it sits", () => {
  const store = storeAt();
  const repo = repoAt();
  const minted = mintCard(repo, { label: "Local only" }, store, () => "bb22");
  assert.equal(minted.ok, true);
  assert.equal(allCards(store)[0].at, path.resolve(repo));

  const found = discoverProjects(repo, store);
  assert.equal(found.length, 1);
  assert.equal(found[0].card.label, "Local only");
});

test("a sub-project is told apart from its repository by its prefix", () => {
  const store = storeAt();
  const remote = "git@github.com:someone/mono.git";
  const repo = repoAt(remote);
  const sub = path.join(repo, "packages", "inner");
  fs.mkdirSync(sub, { recursive: true });

  assert.equal(mintCard(repo, { label: "Mono" }, store, () => "cc33").ok, true);
  assert.equal(mintCard(sub, { label: "Inner" }, store, () => "dd44").ok, true);

  const found = discoverProjects(repo, store).sort((a, b) => a.prefix.localeCompare(b.prefix));
  assert.deepEqual(found.map((p) => [p.prefix, p.card.label]), [
    ["", "Mono"],
    ["packages/inner", "Inner"],
  ]);
});

test("a worktree of an enabled repository is not a second project", () => {
  const store = storeAt();
  const repo = repoAt("git@github.com:someone/thing.git");
  fs.writeFileSync(path.join(repo, "seed.txt"), "seed\n");
  execFileSync("git", ["-C", repo, "add", "seed.txt"], { stdio: "ignore" });
  execFileSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "seed"], {
    stdio: "ignore",
  });
  assert.equal(mintCard(repo, { label: "Thing" }, store, () => "aa11").ok, true);

  const tree = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tandem-wt-")), "branch");
  execFileSync("git", ["-C", repo, "worktree", "add", "-q", "-b", "side", tree], { stdio: "ignore" });

  assert.deepEqual(discoverProjects(tree, store), []);
  const refused = mintCard(tree, { label: "Side" }, store, () => "ff66");
  assert.equal(refused.ok, false);
  assert.equal(allCards(store).length, 1);

  // The repository itself is still one project.
  assert.equal(discoverProjects(repo, store).length, 1);
});

test("minting twice on one repository is refused — identity is immutable", () => {
  const store = storeAt();
  const repo = repoAt("git@github.com:someone/thing.git");
  assert.equal(mintCard(repo, { label: "Thing" }, store, () => "aa11").ok, true);
  const twice = mintCard(repo, { label: "Thing again" }, store, () => "ee55");
  assert.equal(twice.ok, false);
  assert.equal(allCards(store).length, 1);
});

test("the same repository named two ways is one repository", () => {
  assert.equal(sameRemote("git@github.com:a/b.git", "https://github.com/a/b"), true);
  assert.equal(sameRemote("https://tok@github.com/a/b.git", "git@github.com:A/B"), true);
  assert.equal(sameRemote("git@github.com:a/b.git", "git@github.com:a/c.git"), false);
  assert.equal(sameRemote("", "git@github.com:a/b.git"), false);
});

test("a card whose prefix differs is not this directory's card", () => {
  const cards = [
    { id: "x-1", label: "X", remote: "git@github.com:a/b.git", prefix: "packages/one" },
  ];
  assert.equal(matchCard(cards, "git@github.com:a/b.git", "packages/one", "/tmp/anywhere")?.id, "x-1");
  assert.equal(matchCard(cards, "git@github.com:a/b.git", "", "/tmp/anywhere"), undefined);
  assert.equal(matchCard(cards, "git@github.com:a/other.git", "packages/one", "/tmp/anywhere"), undefined);
});

test("a card the store cannot read costs one project, never the editor", () => {
  const store = storeAt();
  fs.mkdirSync(path.join(store, "cards"), { recursive: true });
  fs.writeFileSync(path.join(store, "cards", "broken.yaml"), "id: [unclosed\n");
  putCard(store, { id: "good-1", label: "Good", remote: "git@github.com:a/b.git", prefix: "" });

  const held = allCards(store);
  assert.equal(held.length, 1);
  assert.equal(held[0].id, "good-1");
});
