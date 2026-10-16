/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The plugin registers the server; the entry the extension used to write
 * by hand is removed, and nothing else in the file is touched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { registrationFor, retireHandRegistration, STABLE_SERVER } from "./mcpRegister";

function tmp(): { config: string; storage: string } {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "reg-"));
  return { config: path.join(d, ".claude.json"), storage: path.join(d, "globalStorage") };
}

test("the entry the extension used to write named the version-independent path", () => {
  const { storage } = tmp();
  const r = registrationFor(storage);
  assert.equal(r.command, "node");
  assert.ok(r.args[0].endsWith(STABLE_SERVER), r.args[0]);
  assert.equal(/\d+\.\d+\.\d+/.test(r.args[0]), false);
});

test("the extension's own entry is removed, once; a config without it is left as it is", () => {
  const { config, storage } = tmp();
  fs.writeFileSync(
    config,
    JSON.stringify({ theirs: 1, mcpServers: { "thinkube-tandem": registrationFor(storage), other: { command: "python", args: ["x.py"] } } }),
  );
  assert.equal(retireHandRegistration(config, storage), "removed");
  const doc = JSON.parse(fs.readFileSync(config, "utf8")) as { theirs: number; mcpServers: Record<string, unknown> };
  assert.equal(doc.theirs, 1, "unrelated keys survive");
  assert.deepEqual(doc.mcpServers, { other: { command: "python", args: ["x.py"] } });
  assert.equal(retireHandRegistration(config, storage), "unchanged");
});

test("an entry under the same name that points elsewhere is somebody's own, and stays", () => {
  const { config, storage } = tmp();
  const theirs = { command: "node", args: ["/home/someone/own-build/out/mcp/server.js"] };
  fs.writeFileSync(config, JSON.stringify({ mcpServers: { "thinkube-tandem": theirs } }));
  assert.equal(retireHandRegistration(config, storage), "unchanged");
  const doc = JSON.parse(fs.readFileSync(config, "utf8")) as { mcpServers: Record<string, unknown> };
  assert.deepEqual(doc.mcpServers["thinkube-tandem"], theirs);
});

test("no config is nothing to retire", () => {
  const { config, storage } = tmp();
  assert.equal(retireHandRegistration(config, storage), "unchanged");
  assert.equal(fs.existsSync(config), false, "and none is created");
});

test("a config that cannot be written costs a second registration, never the editor", () => {
  const { storage } = tmp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reg-ro-"));
  const config = path.join(dir, ".claude.json");
  fs.writeFileSync(config, JSON.stringify({ mcpServers: { "thinkube-tandem": registrationFor(storage) } }));
  fs.chmodSync(config, 0o444);
  const outcome = retireHandRegistration(config, storage);
  fs.chmodSync(config, 0o644);
  // Root ignores the mode and writes anyway; either answer is the honest one.
  assert.ok(outcome === "unwritable" || outcome === "removed");
});
