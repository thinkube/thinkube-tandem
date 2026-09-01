/**
 * A refused press says why, on whatever page you pressed it.
 *
 * Everything for this already worked. `post` computed the sentence,
 * `watchRefusals` delivered it, `App` stored it in state and rendered it —
 * inside the writing region, which is `display: none` on three of the four
 * pages. So the answer to "why did nothing happen" was produced correctly
 * and painted where nobody could see it.
 *
 * Nothing about that is visible to a type checker or to a check that calls
 * a function, which is why this one reads the surface's own source: the
 * element must not sit inside a region that a page can hide.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { ACTIONS, liveIn, machineMay } from "./actions";

const APP = fs.readFileSync(
  path.join(__dirname, "..", "..", "webview", "map", "src", "App.tsx"),
  "utf8",
);

test("the refusal is drawn where every page can show it", () => {
  const at = APP.indexOf("data-refusal");
  assert.ok(at > 0, "the surface must have somewhere to say why a press was refused");

  // The writing region hides itself on every page but one. The refusal must
  // not be inside it — that is exactly the bug this pins.
  const hidden = APP.indexOf('display: tab === "write" ? "flex" : "none"');
  assert.ok(hidden > 0, "the writing region still hides itself; this check is still about something");
  const regionEnds = APP.indexOf('if (region === "asks")', hidden);
  assert.ok(
    at < hidden || at > regionEnds,
    "the refusal sentence is inside the region that only the writing page shows",
  );
});

/**
 * Every control the surface can press is an action that exists, and every
 * action that shapes work says when it is live. A control with no row is a
 * control with no refusal sentence, which is the silent click again.
 */
test("every action that shapes work declares when it is live", () => {
  for (const [name, a] of Object.entries(ACTIONS)) {
    assert.ok(a.label.trim().length > 0, `${name} has no label`);
    if (a.when) assert.ok(a.when.length > 0, `${name} declares no phase it is live in`);
  }
});

test("what a machine may not do, it is refused with a sentence", () => {
  for (const [name, a] of Object.entries(ACTIONS)) {
    const v = machineMay(name);
    assert.equal(v.ok, !a.mine, `${name} disagrees with its own declaration`);
    if (!v.ok) assert.ok((v as { reason: string }).reason.length > 20, `${name} refuses without saying why`);
  }
});

test("every phase leaves something to do", () => {
  // A phase in which nothing is live is a dead end: the person is looking at
  // a page where every control is off and none of them says why to press.
  for (const phase of ["drafting", "read", "understood", "signed", "running", "delivered"] as const)
    assert.ok(liveIn(phase).length > 0, `nothing at all can be done in "${phase}"`);
});
