/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/** A prompt names only tools the server offers, and stops at the person's acts. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROMPTS, toolsNamedIn, unknownToolsIn } from "./prompts";
import { toolTable } from "./tools";
import { ACTIONS } from "../surfaces/actions";

test("every tool a prompt names is one the server offers", () => {
  assert.deepEqual(unknownToolsIn(PROMPTS, toolTable()), []);
});

test("every prompt that names a person's act says it is the person's", () => {
  const table = toolTable();
  for (const p of PROMPTS) {
    const text = p.text({ space: "s" });
    const mine = toolsNamedIn(text).filter((t) => {
      const tool = table.find((x) => x.name === t);
      return tool && ACTIONS[tool.action]?.mine;
    });
    if (mine.length) assert.match(text, /person's act/, `${p.name} names ${mine.join(", ")} and must say whose they are`);
  }
});

test("a prompt takes the space it works in", () => {
  for (const p of PROMPTS) {
    assert.ok(p.arguments.some((a) => a.name === "space" && a.required));
    assert.match(p.text({ space: "the-space" }), /"the-space"/);
  }
});
