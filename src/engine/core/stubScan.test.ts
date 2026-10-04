/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The honesty scan reads confessions, not names. `TaskStatus.TODO` is an
 * enum's own member; a comment saying TODO is a deferral.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanStubMarkers } from "./stubScan";

const hits = (content: string) => scanStubMarkers("src/x.py", content).filter((h) => !h.weak).map((h) => h.line);

test("a marker that is part of a name is not a confession", () => {
  assert.deepEqual(
    hits(
      [
        'status: TaskStatus = TaskStatus.TODO',
        'TODO = "todo"',
        'if task.status == "TODO":',
        "self._TODO_count += 1",
        "Status::TODO",
        "state->TODO",
      ].join("\n"),
    ),
    [],
  );
});

test("a marker in prose is", () => {
  assert.deepEqual(
    hits(
      [
        "# TODO: wire the real store",
        "status = TaskStatus.TODO  # FIXME this is never persisted",
        'raise NotImplementedError("not implemented")',
        "// XXX",
      ].join("\n"),
    ),
    [1, 2, 3, 4],
  );
});
