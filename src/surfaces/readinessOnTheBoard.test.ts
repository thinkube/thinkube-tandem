/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/** The board carries the readiness the store keeps, whichever process gave
 *  it, and says why it could not be read when a HEAD cannot be named. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "./session";
import { spacePush } from "./push";
import type { SpacePush } from "./surfaceContract";
import type { Readiness } from "../run/readiness";

function sessionWith(readinessKept?: () => Readiness[]): TandemSession {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-board-ready-"));
  return new TandemSession({
    author: "cmxela",
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
    ...(readinessKept ? { readinessKept } : {}),
  });
}

const ANSWER: Readiness = {
  repoRoot: "/repo/svc",
  head: "a".repeat(40),
  at: "2026-10-15T12:00:00.000Z",
  items: [{ name: "setup", ready: true, say: "the setup holds" }],
};

test("the board carries the readiness kept in the store", () => {
  const push = spacePush(sessionWith(() => [ANSWER])) as SpacePush;
  assert.deepEqual(push.readiness, { kept: [ANSWER] });
});

test("the board says why the kept readiness could not be read", () => {
  const push = spacePush(
    sessionWith(() => {
      throw new Error("fatal: not a git repository");
    }),
  ) as SpacePush;
  assert.deepEqual(push.readiness, { unread: "fatal: not a git repository" });
});

test("a session that checks no readiness carries none", () => {
  assert.equal((spacePush(sessionWith()) as SpacePush).readiness, undefined);
});
