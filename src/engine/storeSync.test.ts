/**
 * The store autosync over a REAL git repo with a bare remote: dirty →
 * committed and pushed; clean-but-ahead → pushed; offline remote → failed,
 * quietly, and the next tick retries.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { StoreSyncService } from "./StoreSyncService";

function repoWithRemote(): { store: string; remote: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sync-"));
  const remote = path.join(base, "remote.git");
  const store = path.join(base, "store");
  execFileSync("git", ["init", "-q", "--bare", remote]);
  execFileSync("git", ["init", "-q", store]);
  const g = (args: string[]) => execFileSync("git", ["-C", store, ...args], { encoding: "utf8" });
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  fs.writeFileSync(path.join(store, "space.json"), "{}\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "seed"]);
  g(["remote", "add", "origin", remote]);
  g(["push", "-qu", "origin", "HEAD"]);
  return { store, remote };
}

test("a dirty store commits and pushes; a clean synced store reports clean", async () => {
  const { store, remote } = repoWithRemote();
  const svc = new StoreSyncService(store, () => {});
  fs.writeFileSync(path.join(store, "space.json"), `{"changed":true}\n`);
  assert.equal(await svc.sync(), "synced");
  const remoteLog = execFileSync("git", ["-C", remote, "log", "--oneline"], { encoding: "utf8" });
  assert.ok(remoteLog.includes("space: autosync"), "the autosync commit reached the remote");
  assert.equal(await svc.sync(), "clean");
});

test("an unpushed commit from a failed prior tick is pushed even when the tree is clean", async () => {
  const { store, remote } = repoWithRemote();
  const g = (args: string[]) => execFileSync("git", ["-C", store, ...args], { encoding: "utf8" });
  fs.writeFileSync(path.join(store, "extra.md"), "x\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "stranded"]);
  const svc = new StoreSyncService(store, () => {});
  assert.equal(await svc.sync(), "synced");
  const remoteLog = execFileSync("git", ["-C", remote, "log", "--oneline"], { encoding: "utf8" });
  assert.ok(remoteLog.includes("stranded"), "the stranded commit was pushed");
});

test("a dead remote fails quietly and the state stays committed locally", async () => {
  const { store, remote } = repoWithRemote();
  fs.rmSync(remote, { recursive: true, force: true });
  fs.writeFileSync(path.join(store, "space.json"), `{"offline":true}\n`);
  const lines: string[] = [];
  const svc = new StoreSyncService(store, (l) => lines.push(l));
  assert.equal(await svc.sync(), "failed");
  const log = execFileSync("git", ["-C", store, "log", "--oneline"], { encoding: "utf8" });
  assert.ok(log.includes("space: autosync"), "committed locally despite the dead remote");
  assert.ok(lines.some((l) => l.includes("FAILED")), "the failure was logged once");
});
