/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/** A unit's Read/Glob/Grep and Edit/Write tool uses are summed over all its rounds. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tallied } from "./unitReads";

test("the tally sums every round of the unit into one line", async () => {
  const rounds = [
    { ok: false, finalText: "", reads: 40, writes: 3 },
    { ok: true, finalText: "", reads: 7, writes: 2 },
    { ok: true, finalText: "" },
  ];
  const t = tallied(async () => rounds.shift()!);
  for (let i = 0; i < 3; i++) await t.worker({} as never, "brief");
  assert.equal(
    t.line("SL-2#eu-0", "continued SL-1#eu-0's session"),
    "📖 SL-2#eu-0: 47 Read/Glob/Grep and 5 Edit/Write tool use(s) over 3 round(s) — continued SL-1#eu-0's session",
  );
});
