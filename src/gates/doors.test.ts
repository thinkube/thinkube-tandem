/**
 * The door check: every gesture the registry promises must exist in the
 * surface that actually renders — a registry entry describing a button
 * nobody built is the failure this catches. Run against the real built
 * bundle, so it cannot pass on a description.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { declaredDoors, missingDoors, walkthroughLines } from "./doors";

/** The built webview: whatever Vite emitted into media/map/assets. */
function builtBundle(): string | undefined {
  const dir = path.join(__dirname, "..", "..", "media", "map", "assets");
  if (!fs.existsSync(dir)) return undefined;
  const js = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
  return js.length ? js.map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n") : undefined;
}

test("every door the registry declares exists in the built surface", () => {
  const bundle = builtBundle();
  assert.ok(bundle, "the webview must be built before its doors can be proved");
  const missing = missingDoors(bundle!);
  assert.deepEqual(
    missing.map((d) => `${d.action} (${d.surface}: ${d.gesture})`),
    [],
    "a promised gesture with no control that reaches it",
  );
});

test("a missing control is caught, not assumed", () => {
  const doors = [
    { action: "build", surface: "the work page", gesture: "press Build", handle: "data-build" },
    { action: "ghost-act", surface: "nowhere", gesture: "press a button nobody built", handle: "data-ghost-act" },
  ];
  const bundle = 'someHtml("data-build") post({ action: "build" })';
  assert.deepEqual(
    missingDoors(bundle, doors).map((d) => d.action),
    ["ghost-act"],
    "the door with no control is the one reported",
  );
});

test("the walkthrough names only doors that were verified", () => {
  const present = new Set(["build"]);
  const lines = walkthroughLines(
    [
      { id: "p1", sentence: "building starts the work", action: "build" },
      { id: "p2", sentence: "a promise with no door", action: "ghost-act" },
      { id: "p3", sentence: "a promise naming no action at all" },
    ],
    present,
  );
  assert.equal(lines.length, 1, "only the verified door yields a line");
  assert.equal(lines[0].id, "p1");
  assert.match(lines[0].line, /^see it: /);
  assert.ok(declaredDoors().some((d) => d.action === "build"), "the registry still declares it");
});
