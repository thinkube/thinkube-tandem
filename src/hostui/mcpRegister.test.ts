/**
 * The registration survives a deploy, and does not trample its neighbours.
 *
 * The failure this prevents already happened once: the previous server's
 * entry named a versioned directory, the next deploy moved it, and the
 * server pointed at a path that no longer existed — reported to the person
 * only as a connection failure with no cause.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ensureRegistered, registrationFor, STABLE_SERVER } from "./mcpRegister";

function tmp(): { config: string; storage: string } {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "reg-"));
  return { config: path.join(d, ".claude.json"), storage: path.join(d, "globalStorage") };
}

test("the entry names the version-independent path", () => {
  const { storage } = tmp();
  const r = registrationFor(storage);
  assert.equal(r.command, "node");
  assert.ok(r.args[0].endsWith(STABLE_SERVER), r.args[0]);
  assert.equal(/\d+\.\d+\.\d+/.test(r.args[0]), false, "a version in the path breaks at the next deploy");
});

test("a first run adds it; a second changes nothing", () => {
  const { config, storage } = tmp();
  assert.equal(ensureRegistered(config, storage), "added");
  assert.equal(ensureRegistered(config, storage), "unchanged");
});

test("an entry pointing somewhere stale is corrected", () => {
  const { config, storage } = tmp();
  fs.writeFileSync(
    config,
    JSON.stringify({
      mcpServers: {
        "thinkube-tandem": { command: "node", args: ["/gone/thinkube.tandem-2.0.1/out/mcp/server.js"] },
      },
    }),
  );
  assert.equal(ensureRegistered(config, storage), "corrected");
  const doc = JSON.parse(fs.readFileSync(config, "utf8")) as {
    mcpServers: Record<string, { args: string[] }>;
  };
  assert.ok(doc.mcpServers["thinkube-tandem"].args[0].endsWith(STABLE_SERVER));
});

test("other people's servers are left alone", () => {
  const { config, storage } = tmp();
  fs.writeFileSync(
    config,
    JSON.stringify({ theirs: 1, mcpServers: { other: { command: "python", args: ["x.py"] } } }),
  );
  ensureRegistered(config, storage);
  const doc = JSON.parse(fs.readFileSync(config, "utf8")) as Record<string, unknown> & {
    mcpServers: Record<string, unknown>;
  };
  assert.equal(doc.theirs, 1, "unrelated keys survive");
  assert.deepEqual(doc.mcpServers.other, { command: "python", args: ["x.py"] });
  assert.ok(doc.mcpServers["thinkube-tandem"]);
});

test("a config that cannot be written costs the server, never the editor", () => {
  const { storage } = tmp();
  // A parent that is a FILE, so the write fails at once. Never a path under
  // /proc: reading there can block, and a drive that blocks is worse than
  // the defect it was written to catch.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reg-blocked-"));
  const notADirectory = path.join(dir, "wall");
  fs.writeFileSync(notADirectory, "not a directory\n");
  assert.equal(ensureRegistered(path.join(notADirectory, ".claude.json"), storage), "unwritable");
});
