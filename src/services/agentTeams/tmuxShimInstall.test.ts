/**
 * Unit tests for the fake-`tmux` PATH install + takeover policy (SP-tgnb5o_SL-2,
 * AC#5). Pure decision logic — no PATH mutation, no filesystem (existence is
 * injected). Run via `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decideTmuxTakeover,
  findExistingTmuxDir,
  prependToPath,
  splitPath,
} from "./tmuxShimInstall";

const SHIM = "/ext/dist/wrapper";

test("install when no tmux exists anywhere on PATH", () => {
  assert.equal(
    decideTmuxTakeover({
      pathEntries: ["/usr/bin", "/bin"],
      shimDir: SHIM,
      existingTmuxDir: null,
    }),
    "install",
  );
});

test("install when the only tmux found is our own shim", () => {
  assert.equal(
    decideTmuxTakeover({
      pathEntries: ["/usr/bin", SHIM],
      shimDir: SHIM,
      existingTmuxDir: SHIM,
    }),
    "install",
  );
});

test("already-installed when our shim dir is at the front of PATH", () => {
  assert.equal(
    decideTmuxTakeover({
      pathEntries: [SHIM, "/usr/bin"],
      shimDir: SHIM,
      existingTmuxDir: SHIM,
    }),
    "already-installed",
  );
});

test("needs-confirmation when a third-party tmux is on PATH", () => {
  assert.equal(
    decideTmuxTakeover({
      pathEntries: ["/usr/local/bin", "/usr/bin"],
      shimDir: SHIM,
      existingTmuxDir: "/usr/local/bin",
    }),
    "needs-confirmation",
  );
});

test("findExistingTmuxDir skips our shim dir and finds the real one", () => {
  const present = new Set([`/usr/local/bin/tmux`, `${SHIM}/tmux`]);
  const dir = findExistingTmuxDir(
    [SHIM, "/usr/local/bin", "/usr/bin"],
    SHIM,
    (p) => present.has(p),
    ["tmux"],
  );
  assert.equal(dir, "/usr/local/bin");
});

test("findExistingTmuxDir returns null when only our shim has tmux", () => {
  const present = new Set([`${SHIM}/tmux`]);
  const dir = findExistingTmuxDir(
    [SHIM, "/usr/bin"],
    SHIM,
    (p) => present.has(p),
    ["tmux"],
  );
  assert.equal(dir, null);
});

test("prependToPath puts the shim dir first and de-dupes it", () => {
  assert.equal(
    prependToPath(["/usr/bin", SHIM].join(":"), SHIM, ":"),
    [SHIM, "/usr/bin"].join(":"),
  );
  assert.equal(
    prependToPath("/usr/bin:/bin", SHIM, ":"),
    [SHIM, "/usr/bin", "/bin"].join(":"),
  );
  // Idempotent when already at the front.
  assert.equal(
    prependToPath([SHIM, "/usr/bin"].join(":"), SHIM, ":"),
    [SHIM, "/usr/bin"].join(":"),
  );
});

test("splitPath drops empty entries", () => {
  assert.deepEqual(splitPath("/a::/b:", ":"), ["/a", "/b"]);
  assert.deepEqual(splitPath(undefined, ":"), []);
});
