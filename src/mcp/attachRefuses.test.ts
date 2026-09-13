/**
 * Attaching to a space that is not on disk is refused by name, never
 * answered with an empty space; and a space another identity wrote in
 * says whose it is.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { putCard } from "../core/cards";
import { attach, authorsOf } from "./attach";

function world(): { repo: string; store: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "attach-repo-"));
  execFileSync("git", ["-C", repo, "init", "-q"], { stdio: "ignore" });
  execFileSync("git", ["-C", repo, "remote", "add", "origin", "git@github.com:t/thing.git"], { stdio: "ignore" });
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "attach-store-"));
  putCard(store, { id: "thing-1", label: "Thing", remote: "git@github.com:t/thing.git", prefix: "" });
  fs.mkdirSync(path.join(store, "spaces", "thing-1", "a-space", "someone-else", "records"), { recursive: true });
  return { repo, store };
}

test("a space that does not exist is refused, naming the ones that do", async () => {
  process.env.GITHUB_USERNAME = "tester";
  const w = world();
  const r = await attach({ repo: w.repo, space: "nope", storeRoot: w.store, storageDir: path.join(w.store, ".storage") });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /no thinking space "nope" under Thing — it has: a-space/);
});

test("a space another identity wrote in attaches, and says whose records it holds", async () => {
  process.env.GITHUB_USERNAME = "tester";
  const w = world();
  const said: string[] = [];
  const r = await attach({
    repo: w.repo, space: "a-space", storeRoot: w.store, storageDir: path.join(w.store, ".storage"), onChanged: (m) => m && said.push(m),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(authorsOf(path.join(w.store, "spaces", "thing-1", "a-space")), ["someone-else"]);
  assert.ok(said.some((m) => /records by someone-else; attached as tester/.test(m)), said.join(" | "));
});
