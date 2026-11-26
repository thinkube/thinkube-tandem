/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The hooks that write the record are loaded by Claude Code, not by this
 * build, so Claude Code's own check of the plugin is part of the suite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as path from "node:path";

test("Claude Code accepts the plugin's manifest and its hooks module", () => {
  const plugin = path.resolve(__dirname, "..", "..", "claude-plugins", "tandem");
  const ran = spawnSync("claude", ["plugin", "validate", plugin], { encoding: "utf8" });
  assert.equal(
    ran.error,
    undefined,
    "the `claude` command must be on the PATH where the suite runs",
  );
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
});
