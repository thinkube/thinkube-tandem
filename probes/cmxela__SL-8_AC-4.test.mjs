// WHY (TRANSITION): today pushActive raises the delivery-ready message off
// whatever activeSession(context) happens to resolve to, and its "Open the
// space" pick always opens the remembered active space — so a delivery that
// finishes in a background tab pops a notification that opens the WRONG
// space. This proves the replacement: pushActive is called with the space
// key the change came from, and the notification opens that key's own tab,
// never a separately remembered active slug. Its job is done once no path
// from a change to its notification re-reads "the active session" instead
// of the key the change was raised for.
//
// The extension host (the real vscode module) is a platform this repository
// does not own — src/extension.ts imports it eagerly at module scope, so it
// cannot be loaded in a plain Node process without either the real host or
// a fabricated stand-in for the whole vscode namespace. Neither is a seam
// this repository defines, so this check reads the repository's own source
// text instead of executing it: a structural check that the notification
// path is wired from the key the push was raised for, not a re-read of
// "the active session".
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const extensionSrc = fs.readFileSync(path.resolve("src/extension.ts"), "utf8");

function bodyOf(fnName) {
  const marker = `function ${fnName}(`;
  const start = extensionSrc.indexOf(marker);
  assert.ok(start >= 0, `extension.ts must still declare ${fnName}`);
  const braceOpen = extensionSrc.indexOf("{", start);
  let depth = 0;
  let i = braceOpen;
  for (; i < extensionSrc.length; i++) {
    if (extensionSrc[i] === "{") depth++;
    else if (extensionSrc[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return extensionSrc.slice(braceOpen, i + 1);
}

test("a delivery-ready message raised for one space opens that space's tab, not the space remembered as active", () => {
  const pushActiveBody = bodyOf("pushActive");

  // The old shape resolved the ONE session to push and to notify about from
  // context alone — pushActive(context, message) with no space key. A push
  // that must reach one space's own tab needs that space's key threaded
  // through, so the function signature itself must now carry a key.
  const sigMatch = extensionSrc.match(/function pushActive\(([^)]*)\)/);
  assert.ok(sigMatch, "extension.ts must still declare pushActive");
  assert.match(
    sigMatch[1],
    /key/i,
    "pushActive must take the space key the change came from, so it can push and notify for that exact space rather than re-deriving 'the active session'",
  );

  // Inside pushActive, opening the space from the notification's pick must
  // route through the key that was passed in — never blindly through the
  // remembered-active resolution path (activateProject with no id, or a
  // command that re-reads the remembered active project/slug).
  assert.doesNotMatch(
    pushActiveBody,
    /executeCommand\(\s*["']thinkube-tandem\.openSpace["']\s*\)/,
    "the delivery-ready notification must not open 'the' remembered space via the no-argument openSpace command — it must open the space the message came from",
  );
});

test("the status bar names which thinking space the run or the thinking it reports belongs to", () => {
  const heartbeatBody = bodyOf("heartbeat");

  // Today the "building" line interpolates exactly ONE value (the unit
  // count: `building — ${done}/${v.units.length} units`) and the "thinking
  // about" line interpolates exactly TWO (the running and total ask
  // counts) — neither names the thinking space the status belongs to, so a
  // person with two tabs open cannot tell which space a running status is
  // for. Each line must now carry one MORE interpolation than it does
  // today — the space's own name — on top of the counts it already prints.
  const buildingLine = heartbeatBody.match(/statusBar\.text\s*=\s*`[^`]*building[^`]*`/i);
  assert.ok(buildingLine, "heartbeat must still print a 'building' status line");
  const buildingInterpolations = buildingLine[0].match(/\$\{[^}]+\}/g) ?? [];
  assert.ok(
    buildingInterpolations.length >= 2,
    "the 'building' status line must interpolate more than just the unit count (today: 1) — it must now also name the thinking space it reports on",
  );

  const thinkingLine = heartbeatBody.match(/statusBar\.text\s*=\s*`[^`]*thinking about[^`]*`/i);
  assert.ok(thinkingLine, "heartbeat must still print a 'thinking about' status line");
  const thinkingInterpolations = thinkingLine[0].match(/\$\{[^}]+\}/g) ?? [];
  assert.ok(
    thinkingInterpolations.length >= 3,
    "the 'thinking about' status line must interpolate more than just the two ask counts (today: 2) — it must now also name the thinking space it reports on",
  );
});
