/**
 * The store's sync must not fail in silence behind a dead process's lock.
 * Four days of records once went uncommitted behind one, and a space
 * deleted that morning took them with it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { StoreSyncService } from "./StoreSyncService";

function store(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sync-"));
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  execFileSync("git", ["-C", dir, "add", "a.txt"]);
  execFileSync("git", ["-C", dir, "commit", "-qm", "seed"]);
  return dir;
}

test("a stale index.lock is removed, said, and the commit goes through", async () => {
  const dir = store();
  const lock = path.join(dir, ".git", "index.lock");
  fs.writeFileSync(lock, "");
  const old = Date.now() / 1000 - 3600;
  fs.utimesSync(lock, old, old);
  fs.writeFileSync(path.join(dir, "b.txt"), "b\n");
  const said: string[] = [];
  const svc = new StoreSyncService(dir, (l) => said.push(l), 5 * 60_000);
  // No remote: the push fails, but the commit — the loss window — must close.
  await svc.sync();
  assert.ok(!fs.existsSync(lock), "the stale lock is gone");
  assert.ok(said.some((l) => /stale index\.lock/.test(l)), "and the removal was said");
  const log = execFileSync("git", ["-C", dir, "log", "--oneline"], { encoding: "utf8" });
  assert.match(log, /autosync/, "the records were committed");
});

test("a fresh lock is left alone — it may belong to a live commit", async () => {
  const dir = store();
  const lock = path.join(dir, ".git", "index.lock");
  fs.writeFileSync(lock, "");
  const said: string[] = [];
  const svc = new StoreSyncService(dir, (l) => said.push(l), 5 * 60_000);
  await svc.sync();
  assert.ok(fs.existsSync(lock), "a lock younger than two intervals is respected");
  assert.ok(said.some((l) => /FAILED/.test(l)), "and the failure is said, not swallowed");
});
