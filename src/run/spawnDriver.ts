/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A run in its own process.
 *
 * A run used to live in the process that pressed the button: the editor's
 * extension host, or the MCP server. Both die with the window or the
 * session that made them, and an hour of work went with them. The run is
 * started here as a process of its own — detached, its own session, its
 * output on a file — so a window can reload and the run does not notice.
 * Whoever started it follows the record the driver writes, the same way a
 * second window already did.
 */
import { spawn as nodeSpawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface DriverArgs {
  /** The compiled driver, `out/run/driver.js` of the build that starts it. */
  driver: string;
  /** The repository the space's card names — the anchor directory. */
  repo: string;
  /** The space's directory name. */
  space: string;
  fresh: boolean;
  /** The store root, so the driver reads the same store. */
  storeRoot: string;
  /** The editor's global storage, where the approvals are. */
  storageDir: string;
  /** Where the driver's own output goes: the space's runs directory. */
  storeDir: string;
  env?: NodeJS.ProcessEnv;
  spawn?: typeof nodeSpawn;
  node?: string;
}

/** Where a driver writes what it says, beside the run records. */
export function driverLogPath(storeDir: string): string {
  return path.join(storeDir, "runs", "driver.log");
}

/** Start the driver and return at once. The run's progress is on its record. */
export function startRunElsewhere(a: DriverArgs): { ok: true; pid: number } | { ok: false; reason: string } {
  if (!fs.existsSync(a.driver)) return { ok: false, reason: `the run driver is not built: ${a.driver}` };
  let fd: number;
  try {
    fs.mkdirSync(path.dirname(driverLogPath(a.storeDir)), { recursive: true });
    fd = fs.openSync(driverLogPath(a.storeDir), "a");
  } catch (e) {
    return { ok: false, reason: `the driver's log cannot be opened: ${e instanceof Error ? e.message : String(e)}` };
  }
  const args = [
    a.driver,
    "--repo", a.repo,
    "--space", a.space,
    "--store", a.storeRoot,
    "--storage", a.storageDir,
    ...(a.fresh ? ["--fresh"] : []),
  ];
  try {
    const child = (a.spawn ?? nodeSpawn)(a.node ?? process.execPath, args, {
      detached: true,
      stdio: ["ignore", fd, fd],
      // The build's own directory: a deploy keeps every version a live
      // process is inside, and this is how it knows.
      cwd: path.resolve(path.dirname(a.driver), "..", ".."),
      env: { ...(a.env ?? process.env) },
    });
    child.unref();
    fs.closeSync(fd);
    if (child.pid === undefined) return { ok: false, reason: "the driver did not start" };
    return { ok: true, pid: child.pid };
  } catch (e) {
    try {
      fs.closeSync(fd);
    } catch {
      /* already closed */
    }
    return { ok: false, reason: `the driver could not be started: ${e instanceof Error ? e.message : String(e)}` };
  }
}
