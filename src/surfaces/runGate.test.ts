/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Asking the platform again about merged work never fails in silence: a
 * delivery it could not be asked about is said in the space in the
 * failure's own words, and every other delivery is still asked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { TandemSession } from "./session";
import { emptySpace } from "../core/schema";
import { catchUpOnMergedWork } from "./runGate";

test("a delivery the platform cannot be asked about is said, and the rest are still asked", async () => {
  const gitRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-catchup-"));
  execFileSync("git", ["-C", gitRoot, "init", "-q"], { stdio: "ignore" });
  execFileSync("git", ["-C", gitRoot, "remote", "add", "origin", "https://git.example.com/thinkube-deployments/todo.git"], {
    stdio: "ignore",
  });
  const said: string[] = [];
  const s = new TandemSession({
    author: "tester",
    round: { model: "sonnet", repoRoot: gitRoot },
    scope: { gitRoot },
    storeDir: gitRoot,
    storageDir: path.join(gitRoot, ".local"),
    now: () => new Date().toISOString(),
    onChanged: (m?: string) => m && said.push(m),
  } as never);
  s.space = {
    ...emptySpace(),
    deliveries: [
      { id: "delivery-TEP-1", acceptedAt: "2026-10-15T10:00:00Z", proofs: [] },
      { id: "delivery-TEP-2", acceptedAt: "2026-10-15T11:00:00Z", proofs: [] },
    ],
  } as never;

  const asked: string[] = [];
  await catchUpOnMergedWork(s, async (a) => {
    asked.push(a.delivery.id);
    if (a.delivery.id === "delivery-TEP-1") throw new Error("control answered 502 Bad Gateway");
  });

  assert.deepEqual(asked, ["delivery-TEP-1", "delivery-TEP-2"], "a failure on one delivery does not stop the others");
  assert.deepEqual(said, [
    "delivery-TEP-1: the platform could not be asked what it did with the merged work — control answered 502 Bad Gateway",
  ]);
});
