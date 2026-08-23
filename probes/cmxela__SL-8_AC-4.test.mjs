// WHY (TRANSITION): pushActive used to raise the delivery-ready message off
// whatever activeSession(context) resolved to, and its "Open the space" pick
// always opened the remembered active space — so a delivery finishing in a
// background tab popped a notification that opened the WRONG space. This
// proves the replacement: the push is raised for the space key the change
// came from, and the notification opens THAT key's own tab.
//
// Two halves, because the promise has two parts:
//  1. Behaviour, EXECUTED: with two spaces open, a push delivered for one
//     key reaches that key's own tab, and opening by that key reveals that
//     tab and never the other — driven through the real SpaceTabs register,
//     which is what pushActive delegates both acts to.
//  2. Wiring, read from the extension's own source: that pushActive takes a
//     key at all, and that the notification's pick does not fall back to the
//     zero-argument "open the remembered space" command. This half is
//     structural because `pushActive` is module-private with no seam, and
//     production must not grow an export that exists only for a check.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { installVscodeStub } from "./_vscodeStub.mjs";

// The extension reaches the editor host through `require("vscode")`; filling
// that seam lets the real module load, so this check runs against the
// extension itself rather than against a copy of its text alone.
installVscodeStub();

const { SpaceTabs } = await import("../out-test/surfaces/spaceTabs.js");
const extension = await import("../out-test/extension.js");

// The source under check is resolved against THIS file's own location, never
// against the process working directory: the runner starts probes from a
// directory of its choosing, and a cwd-relative read would examine nothing.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION_REL = "src/extension.ts";
const EXTENSION_FULL = path.join(REPO_ROOT, EXTENSION_REL);
assert.ok(
  fs.statSync(EXTENSION_FULL, { throwIfNoEntry: false }),
  `${EXTENSION_REL} is not in the tree this check runs against (root: ${REPO_ROOT})`,
);
const extensionSrc = fs.readFileSync(EXTENSION_FULL, "utf8");

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

function fakeTab(key) {
  const tab = {
    key,
    closed: false,
    revealed: 0,
    pushed: [],
    isClosed: () => tab.closed,
    reveal: () => {
      tab.revealed += 1;
    },
    push: (p) => tab.pushed.push(p),
    dispose: () => {
      tab.closed = true;
    },
  };
  return tab;
}

test("a delivery-ready message raised for one space opens that space's tab, not the space remembered as active (two spaces, fake window)", () => {
  // The real extension module is what this promise lands in — it must load,
  // and must still expose the shutdown entry point, for the rest to mean
  // anything about the shipped code.
  assert.equal(
    typeof extension.deactivate,
    "function",
    "the real extension module must load and still export deactivate",
  );

  // TWO spaces of one owner are open. "beta" is where the delivery finished;
  // "alpha" stands for the space a remembered-active read would have picked.
  const made = new Map();
  const register = new SpaceTabs((key) => {
    const tab = fakeTab(key);
    made.set(key, tab);
    return tab;
  });
  register.open("owner-a/alpha");
  register.open("owner-a/beta");

  const alpha = made.get("owner-a/alpha");
  const beta = made.get("owner-a/beta");
  const revealedBefore = { alpha: alpha.revealed, beta: beta.revealed };

  // The push is delivered for the key the change came from…
  register.push("owner-a/beta", "Delivery ready — cut-1");
  assert.deepEqual(
    beta.pushed,
    ["Delivery ready — cut-1"],
    "the push must reach the tab of the space the change came from",
  );
  assert.deepEqual(
    alpha.pushed,
    [],
    "no other space's tab may receive that space's push",
  );

  // …and the notification's "Open the space" opens THAT key's own tab.
  // Opening a key that already holds a live tab reveals that same tab, so
  // beta is brought forward and alpha is left exactly where it was.
  const opened = register.open("owner-a/beta");
  assert.equal(opened, beta, "opening the pushed key must return that space's own tab");
  assert.ok(
    beta.revealed > revealedBefore.beta,
    "opening by the pushed key must reveal that space's own tab",
  );
  assert.equal(
    alpha.revealed,
    revealedBefore.alpha,
    "the space merely remembered as active must NOT be revealed — opening it is the defect this replaces",
  );
});

test("the delivery-ready path is wired from the key the push carries, never a remembered active slug", () => {
  const sigMatch = extensionSrc.match(/function pushActive\(([^)]*)\)/);
  assert.ok(sigMatch, "extension.ts must still declare pushActive");
  assert.match(
    sigMatch[1],
    /key/i,
    "pushActive must take the space key the change came from, so it can push and notify for that exact space rather than re-deriving 'the active session'",
  );

  const pushActiveBody = bodyOf("pushActive");
  assert.doesNotMatch(
    pushActiveBody,
    /executeCommand\(\s*["']thinkube-tandem\.openSpace["']\s*\)/,
    "the delivery-ready notification must not open 'the' remembered space via the no-argument openSpace command — it must open the space the message came from",
  );
});

test("the status bar names which thinking space the run or the thinking it reports belongs to", () => {
  const heartbeatBody = bodyOf("heartbeat");

  // Today the "building" line interpolates exactly ONE value (the unit
  // count) and the "thinking about" line exactly TWO (the ask counts) —
  // neither names the thinking space the status belongs to, so a person with
  // two tabs open cannot tell which space a running status is for. Each line
  // must carry one MORE interpolation than it did: the space's own name.
  const buildingLine = heartbeatBody.match(/statusBar\.text\s*=\s*`[^`]*building[^`]*`/i);
  assert.ok(buildingLine, "heartbeat must still print a 'building' status line");
  const buildingInterpolations = buildingLine[0].match(/\$\{[^}]+\}/g) ?? [];
  assert.ok(
    buildingInterpolations.length >= 2,
    "the 'building' status line must interpolate more than just the unit count — it must also name the thinking space it reports on",
  );

  const thinkingLine = heartbeatBody.match(/statusBar\.text\s*=\s*`[^`]*thinking about[^`]*`/i);
  assert.ok(thinkingLine, "heartbeat must still print a 'thinking about' status line");
  const thinkingInterpolations = thinkingLine[0].match(/\$\{[^}]+\}/g) ?? [];
  assert.ok(
    thinkingInterpolations.length >= 3,
    "the 'thinking about' status line must interpolate more than just the two ask counts — it must also name the thinking space it reports on",
  );
});
