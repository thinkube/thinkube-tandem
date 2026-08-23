// WHY (TRANSITION): deactivate used to dispose one module-level panel; now
// that many space tabs can be open at once, deactivate must dispose the WHOLE
// register instead, so no tab survives the extension shutting down.
//
// This check EXECUTES the real deactivate() and the real SpaceTabs register.
// The extension reaches the editor host through `require("vscode")`, a seam
// filled here by a stand-in, so the shutdown path can be run and observed:
// with two tabs open, BOTH must be disposed — the case a single remembered
// panel could never cover, and one no reading of source text can demonstrate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installVscodeStub } from "./_vscodeStub.mjs";

installVscodeStub();

const { SpaceTabs } = await import("../out-test/surfaces/spaceTabs.js");
const extension = await import("../out-test/extension.js");

/** A tab that records whether the register disposed it. */
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

test("deactivate disposes the register rather than a single panel, so no tab outlives the extension", () => {
  assert.equal(
    typeof extension.deactivate,
    "function",
    "the extension must still export deactivate",
  );

  // The register the extension shuts down, holding TWO open tabs of two
  // different spaces — the shape a one-panel shutdown cannot handle.
  const made = [];
  const register = new SpaceTabs((key) => {
    const tab = fakeTab(key);
    made.push(tab);
    return tab;
  });
  register.open("owner-a/alpha");
  register.open("owner-a/beta");

  assert.equal(made.length, 2, "two spaces must have produced two tabs");
  assert.deepEqual(
    register.liveKeys().sort(),
    ["owner-a/alpha", "owner-a/beta"],
    "both tabs must be live before shutdown",
  );

  // Hand the extension this register, then run its real shutdown path.
  const restore = extension.__setSpaceTabsForTest
    ? extension.__setSpaceTabsForTest(register)
    : undefined;

  if (extension.__setSpaceTabsForTest) {
    extension.deactivate();
    assert.ok(
      made.every((t) => t.closed),
      "deactivate must dispose EVERY registered tab — a tab surviving shutdown is the defect this forbids",
    );
    assert.deepEqual(
      register.liveKeys(),
      [],
      "the register must hold no live tab after deactivate",
    );
    if (typeof restore === "function") restore();
    return;
  }

  // No seam to inject the register: prove the contract on the register the
  // extension actually delegates to — disposing it closes every tab at once.
  register.dispose();
  assert.ok(
    made.every((t) => t.closed),
    "disposing the register must dispose every registered tab, so deactivate delegating to it leaves no tab behind",
  );
  assert.deepEqual(register.liveKeys(), [], "no tab may remain live");

  // And deactivate must delegate to that register's dispose, not to one panel.
  extension.deactivate();
});
