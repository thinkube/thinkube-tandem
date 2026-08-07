/**
 * The naming round's pure parts: the prompt carries every unit's member
 * sentences; the parse is strict — unknown units drop, overlong titles
 * clamp at the SPEC's 70, junk names nothing (fallback title always).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildNamingPrompt, parseAbstracts, TITLE_MAX } from "./name";

test("the prompt names every unit and carries every member sentence", () => {
  const p = buildNamingPrompt([
    { id: "u-1", sentences: ["a clear button in the toolbar", "the toolbar mounts the button"] },
    { id: "u-2", sentences: ["a persisted retrievable log"] },
  ]);
  for (const s of [
    "unit u-1",
    "unit u-2",
    "a clear button in the toolbar",
    "the toolbar mounts the button",
    "a persisted retrievable log",
    "JSON array",
    String(TITLE_MAX),
  ])
    assert.ok(p.includes(s), `prompt carries: ${s}`);
});

test("parse: valid entries land; unknown units and junk drop; prose around the JSON is tolerated", () => {
  const valid = new Set(["u-1", "u-2"]);
  const raw =
    'Here you go:\n[{"unitId":"u-1","title":"Toolbar clear control","text":"Adds the control and its mount."},' +
    '{"unitId":"ghost","title":"x","text":"y"},' +
    '{"unitId":"u-2","title":"","text":"empty title drops"},' +
    '{"unitId":"u-2","title":"Persisted auditor log"}]\ndone.';
  const out = parseAbstracts(raw, valid);
  assert.deepEqual(out, [
    { unitId: "u-1", title: "Toolbar clear control", text: "Adds the control and its mount." },
    { unitId: "u-2", title: "Persisted auditor log", text: "" },
  ]);
});

test("parse: an overlong title clamps at the SPEC's 70 characters", () => {
  const long = "L".repeat(120);
  const out = parseAbstracts(
    `[{"unitId":"u-1","title":"${long}","text":"t"}]`,
    new Set(["u-1"]),
  );
  assert.equal(out[0].title.length, TITLE_MAX);
  assert.ok(out[0].title.endsWith("…"));
});

test("parse: null, non-JSON and non-array name nothing", () => {
  const valid = new Set(["u-1"]);
  assert.deepEqual(parseAbstracts(null, valid), []);
  assert.deepEqual(parseAbstracts("no json here", valid), []);
  assert.deepEqual(parseAbstracts('{"unitId":"u-1"}', valid), []);
  assert.deepEqual(parseAbstracts("[not json]", valid), []);
});

test("list-paste folds wrapped bullet lines into their item", async () => {
  const { splitList } = await import("./classify");
  const pasted = [
    "- When a delivery is ready, the page must show me",
    "  how to experience it: one line per promise.",
    "- Documentation must be required by default for",
    "  every cut, with a recorded reason to skip.",
  ].join("\n");
  const items = splitList(pasted);
  assert.equal(items!.length, 2, "two asks, not four fragments");
  assert.ok(items![0].endsWith("one line per promise."));
  assert.equal(splitList("just one paragraph\nwritten across lines"), null, "no markers, one ask");
});

test("naming runs in small batches — a big space comes back fully named, none dropped", async () => {
  const { renderUnitAbstracts, NAMING_BATCH } = await import("../surfaces/naming");
  const units = Array.from({ length: NAMING_BATCH * 2 + 3 }, (_, i) => ({
    id: `u-${i}`,
    changeIds: [`n-${i}`],
  }));
  const space = {
    units,
    nodes: units.map((u) => ({ id: u.changeIds[0], sentence: `promise ${u.id}` })),
  };
  const sizes: number[] = [];
  const out = await renderUnitAbstracts({
    space: space as never,
    round: { model: "opus", repoRoot: "/repo" },
    name: async (_d: unknown, batch: { id: string }[]) => {
      sizes.push(batch.length);
      return batch.map((b) => ({ unitId: b.id, title: `T ${b.id}`, text: "" }));
    },
    readStamps: async () => [],
    onActivity: () => {},
  } as never);
  assert.ok(sizes.every((n) => n <= NAMING_BATCH), `no round carries more than ${NAMING_BATCH} units`);
  assert.equal(sizes.reduce((a, b) => a + b, 0), units.length, "every unit was asked about");
  assert.equal(out!.size, units.length, "every unit came back named");
});
