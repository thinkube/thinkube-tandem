/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A run is started as a process of its own, so the window that pressed
 * the button can go away and the run does not.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { driverLogPath, startRunElsewhere } from "./spawnDriver";

function scratch(): { driver: string; storeDir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "driver-"));
  fs.mkdirSync(path.join(dir, "ext", "out", "run"), { recursive: true });
  const driver = path.join(dir, "ext", "out", "run", "driver.js");
  fs.writeFileSync(driver, "process.exit(0)\n");
  return { driver, storeDir: path.join(dir, "space") };
}

test("the driver is spawned detached, with its own session, named the space and store, and left running", () => {
  const { driver, storeDir } = scratch();
  const seen: { cmd: string; args: string[]; opts: Record<string, unknown>; unref: number } = { cmd: "", args: [], opts: {}, unref: 0 };
  const spawn = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
    Object.assign(seen, { cmd, args, opts });
    return { pid: 4242, unref: () => void seen.unref++ };
  }) as never;
  const r = startRunElsewhere({
    driver, repo: "/repo", space: "a-space", fresh: true, storeRoot: "/store", storageDir: "/storage", storeDir, spawn, node: "/usr/bin/node",
  });
  assert.deepEqual(r, { ok: true, pid: 4242 });
  assert.equal(seen.cmd, "/usr/bin/node");
  assert.deepEqual(seen.args, [driver, "--repo", "/repo", "--space", "a-space", "--store", "/store", "--storage", "/storage", "--fresh"]);
  assert.equal(seen.opts.detached, true, "its own session: the window's death is not its death");
  assert.equal(seen.unref, 1, "the parent does not wait on it");
  assert.equal(seen.opts.cwd, path.resolve(path.dirname(driver), "..", ".."), "inside the build it runs, so a deploy keeps that build");
  const stdio = seen.opts.stdio as unknown[];
  assert.equal(stdio[0], "ignore");
  assert.equal(typeof stdio[1], "number", "its output goes to a file, not to the parent");
  assert.ok(fs.existsSync(driverLogPath(storeDir)), "the log is beside the run records");
});

test("a driver that is not built is refused with its path", () => {
  const r = startRunElsewhere({
    driver: "/nowhere/driver.js", repo: "/repo", space: "s", fresh: false, storeRoot: "/store", storageDir: "/st", storeDir: os.tmpdir(),
    spawn: (() => { throw new Error("must not spawn"); }) as never,
  });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /not built: \/nowhere\/driver\.js/);
});

test("a real spawn of the driver script starts and is not waited on", async () => {
  const { driver, storeDir } = scratch();
  const r = startRunElsewhere({ driver, repo: "/repo", space: "s", fresh: false, storeRoot: "/store", storageDir: "/st", storeDir });
  assert.equal(r.ok, true);
  // It exits on its own; the parent never held it.
  await new Promise((res) => setTimeout(res, 300));
  assert.ok((r as { pid: number }).pid > 0);
});
