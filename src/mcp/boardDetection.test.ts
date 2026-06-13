/**
 * Unit tests for board-shaped detection (TEP-tghb9t / TEP-0008). fs only,
 * no vscode, no server boot.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { isBoardDir } from "./boardDetection";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tk-board-"));
}

test("a board dir with a specs/ subdir is a board", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "specs"));
  assert.equal(isBoardDir(dir), true);
});

test("a `.thinkube/` holding only an api-token is NOT a board", () => {
  // Reproduces the /home/thinkube/.thinkube token store that was wrongly
  // adopted as the default board.
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "api-token"), "tk_secret");
  assert.equal(isBoardDir(dir), false);
});

test("an empty dir is not a board", () => {
  assert.equal(isBoardDir(tmp()), false);
});

test("a non-existent dir is not a board (no throw)", () => {
  assert.equal(isBoardDir(path.join(tmp(), "does-not-exist")), false);
});

test("a file named specs (not a dir) does not count", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "specs"), "");
  assert.equal(isBoardDir(dir), false);
});
