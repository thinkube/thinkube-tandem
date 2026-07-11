/**
 * Doc referential integrity (2026-07-11): documents get gates too. Tool
 * descriptions are model-facing every session — a stale path shape or an id
 * example the resolver rejects is drift that reads as truth. These tests make
 * that drift fail CI like a broken build.
 */
import "./installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { TOOL_DEFS } from "./kanbanMcpServer";
import { normalizeSpecRef, resolveSliceRef } from "./refResolver";

type ToolDef = {
  name: string;
  description: string;
  inputSchema: { properties?: Record<string, { description?: string }> };
};
const defs = TOOL_DEFS as unknown as ToolDef[];

function allDescriptionText(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  for (const d of defs) {
    out.push({ where: d.name, text: d.description ?? "" });
    for (const [prop, spec] of Object.entries(
      d.inputSchema?.properties ?? {},
    ))
      if (spec?.description)
        out.push({ where: `${d.name}.${prop}`, text: spec.description });
  }
  return out;
}

test("no tool description advertises the unreachable legacy path shape", () => {
  for (const { where, text } of allDescriptionText()) {
    assert.doesNotMatch(
      text,
      /specs\/SP-\{?\w*\}?[./]/,
      `${where} still describes the legacy specs/SP-… layout (the store speaks teps/TEP-{t}/SP-{n}/…)`,
    );
  }
});

test("every spec-id example quoted in a description parses through the ref grammar", () => {
  // Backtick-quoted tokens that LOOK like spec refs must actually resolve —
  // a documented example the parser rejects is a lie the model will follow.
  const SPEC_EXAMPLE = /`((?:TEP-\d+_SP-\d+|SP-\d+\/\d+|TEP-\d+\/SP-\d+|\d+\/\d+))`/g;
  let checked = 0;
  for (const { where, text } of allDescriptionText()) {
    for (const m of text.matchAll(SPEC_EXAMPLE)) {
      assert.doesNotThrow(
        () => normalizeSpecRef(m[1]),
        `${where}: documented example \`${m[1]}\` does not parse`,
      );
      checked++;
    }
  }
  assert.ok(checked >= 5, `expected several documented examples (got ${checked})`);
});

test("every slice-handle example quoted in a description parses through the ref grammar", async () => {
  const SLICE_EXAMPLE = /`((?:TEP-\d+_SP-\d+_SL-\d+|SP-\d+_SL-\d+|\d+\/\d+\/\d+))`/g;
  const list = () => Promise.resolve(["1/4"]);
  let checked = 0;
  for (const { where, text } of allDescriptionText()) {
    for (const m of text.matchAll(SLICE_EXAMPLE)) {
      await assert.doesNotReject(
        () => resolveSliceRef(list, m[1]),
        `${where}: documented example \`${m[1]}\` does not parse`,
      );
      checked++;
    }
  }
  assert.ok(checked >= 3, `expected several documented examples (got ${checked})`);
});

test("no source file names the retired pairing skills", () => {
  // /pair-next and /board were retired; a doc that still points there sends
  // the reader to a skill that does not exist.
  const roots = ["src"];
  const offenders: string[] = [];
  for (const root of roots) {
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (/\.(ts|md)$/.test(e.name) && !p.endsWith("docCoherence.test.ts")) {
          const text = fs.readFileSync(p, "utf8");
          if (/\/pair-next|\/pair-start/.test(text)) offenders.push(p);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `retired-skill references in: ${offenders.join(", ")}`);
});
