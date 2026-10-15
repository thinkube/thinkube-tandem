/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The run's log, on disk, as it happens.
 *
 * Until now a run's log lived in the panel and in memory, capped at two
 * hundred lines. When a run stalled, the only way to learn what it was
 * doing was to read file timestamps in its worktrees and infer — three
 * times in one evening. A log that exists only in a window cannot be read
 * by anyone who is not looking at that window, cannot be read after the
 * window closes, and cannot be read at all while the thing it describes is
 * still going.
 *
 * So every line goes to `<store>/runs/<tep>.log` the moment it is written,
 * stamped with the time and the step it belongs to. Fail-soft: a log that
 * cannot be written must never affect the run it is describing.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** Where a space's working-out log lives: the work a server does in the
 *  space outside any run — reading a draft, thinking, choosing a set. */
function workingOutLogPath(storeDir: string): string {
  return path.join(storeDir, "runs", "working-out.log");
}

/**
 * Append one line of working out, stamped like a run's lines. A line that
 * cannot be written throws, for the caller to say so.
 */
export function appendWorkingOut(storeDir: string, line: string): void {
  const file = workingOutLogPath(storeDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${new Date().toISOString()} [working-out] ${line}\n`);
}

/** Where a run's own log lives. */
function runLogPath(storeDir: string, tep: string): string {
  return path.join(storeDir, "runs", `${tep}.log`);
}

/**
 * A sink that appends every line to the run's log. `at` is injectable so a
 * test reads a stable file; the run passes the clock.
 */
export function runLogSink(
  storeDir: string,
  tep: string,
  runId: string,
  at: () => string = () => new Date().toISOString(),
): (line: string, step: string) => void {
  const file = runLogPath(storeDir, tep);
  let ready = false;
  return (line, step) => {
    try {
      if (!ready) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, `\n──── ${runId} ────\n`);
        ready = true;
      }
      fs.appendFileSync(file, `${at()} [${step}] ${line}\n`);
    } catch {
      /* a log that cannot be written never affects the run */
    }
  };
}
