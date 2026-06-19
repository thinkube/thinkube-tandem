/**
 * Unit tests for resolveServerConfig (SP-tgw52t_SL-1). Pure — no fs/vscode.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveServerConfig } from "./serverConfig";

test("env wins over the machine-level file", () => {
  const cfg = resolveServerConfig(
    { THINKUBE_BOARD_ROOT: "/env/board", THINKUBE_ROOTS: "/a:/b" },
    { boardRoot: "/file/board", roots: ["/c"] },
    ":",
  );
  assert.equal(cfg.boardRoot, "/env/board");
  assert.deepEqual(cfg.roots, ["/a", "/b"]);
});

test("falls back to the file when env is absent", () => {
  const cfg = resolveServerConfig(
    {},
    {
      boardRoot: "/file/board",
      roots: ["/c", "/d"],
      folders: [{ name: "Platform", path: "/home/u/thinkube-platform" }],
    },
    ":",
  );
  assert.equal(cfg.boardRoot, "/file/board");
  assert.deepEqual(cfg.roots, ["/c", "/d"]);
  assert.deepEqual(cfg.folders, [{ name: "Platform", path: "/home/u/thinkube-platform" }]);
});

test("no env, no file → safe defaults (writes on, advisory, empty)", () => {
  const cfg = resolveServerConfig({}, null, ":");
  assert.equal(cfg.boardRoot, undefined);
  assert.deepEqual(cfg.roots, []);
  assert.deepEqual(cfg.folders, []);
  assert.equal(cfg.allowAIWrites, true);
  assert.equal(cfg.docsGateMode, "advisory");
});

test("THINKUBE_FOLDERS env parses and overrides the file", () => {
  const cfg = resolveServerConfig(
    { THINKUBE_FOLDERS: '[{"name":"X","path":"/x"}]' },
    { folders: [{ name: "Y", path: "/y" }] },
    ":",
  );
  assert.deepEqual(cfg.folders, [{ name: "X", path: "/x" }]);
});

test("allowAIWrites: env 'false' wins; else file; else true", () => {
  assert.equal(resolveServerConfig({ THINKUBE_ALLOW_AI_WRITES: "false" }, { allowAIWrites: true }).allowAIWrites, false);
  assert.equal(resolveServerConfig({}, { allowAIWrites: false }).allowAIWrites, false);
  assert.equal(resolveServerConfig({}, {}).allowAIWrites, true);
});

test("docsGateMode blocking only when env says so", () => {
  assert.equal(resolveServerConfig({ THINKUBE_DOCS_GATE_MODE: "blocking" }, null).docsGateMode, "blocking");
  assert.equal(resolveServerConfig({}, null).docsGateMode, "advisory");
});

test("malformed file folders are ignored (not thrown)", () => {
  const cfg = resolveServerConfig({}, { folders: [{ name: "ok", path: "/ok" }, { name: 1 } as never] }, ":");
  assert.deepEqual(cfg.folders, [{ name: "ok", path: "/ok" }]);
});
