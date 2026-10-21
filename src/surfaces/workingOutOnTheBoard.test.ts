/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/** Work done in a space outside the editor — through the MCP server — is
 *  written to the space's working-out log, and the board reads that log
 *  from the store like a run step's, before any run exists. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "./session";
import { spacePush } from "./push";
import type { SpacePush } from "./surfaceContract";
import { appendWorkingOut, WORKING_OUT } from "../run/runLog";

function session(): { s: TandemSession; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-board-working-out-"));
  const s = new TandemSession({
    author: "cmxela",
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
  });
  return { s, dir };
}

test("a space with no working-out log offers none", () => {
  const { s } = session();
  assert.equal((spacePush(s) as SpacePush).workingOutLog, false);
});

test("the working-out log another process wrote is offered and read on the board", () => {
  const { s, dir } = session();
  appendWorkingOut(dir, "choose_set: working out spec-dentalpin-1");
  appendWorkingOut(dir, "choose_set: 5 promises");
  assert.equal((spacePush(s) as SpacePush).workingOutLog, true);

  s.readLog(WORKING_OUT);
  const log = (spacePush(s) as SpacePush).runLog;
  assert.ok(log, "the log is open with no run in the session");
  assert.equal(log.step, WORKING_OUT);
  assert.equal(log.total, 2);
  assert.match(log.lines[0], /\[working-out\] choose_set: working out spec-dentalpin-1$/);
  assert.match(log.lines[1], /choose_set: 5 promises$/);
});
