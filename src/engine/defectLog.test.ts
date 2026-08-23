/**
 * The ledger is about the machine, not about any one piece of work: it
 * lives at the store's root, one file per month across every space, and
 * each row names the space it came from. A space's lifetime never touches
 * it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { appendDefect, defectLogPath, ledgerRoot } from "./defectLog";

test("a run in a space writes the store's ledger, naming the space", () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ledger-"));
  const space = path.join(store, "spaces", "repo-1", "rebrand", "alice");
  fs.mkdirSync(space, { recursive: true });
  assert.deepEqual(ledgerRoot(space), { root: store, space: "repo-1/rebrand/alice" });
  assert.ok(appendDefect(space, { spec: "TEP-1", activity: "run", trigger: "watchdog", impact: "x", detail: "y" }));
  const file = defectLogPath(space, new Date());
  assert.ok(file.startsWith(path.join(store, "defects")), `the ledger is at the root, not in the space: ${file}`);
  const row = JSON.parse(fs.readFileSync(file, "utf8").trim().split("\n").pop()!) as { space?: string };
  assert.equal(row.space, "repo-1/rebrand/alice");
  fs.rmSync(space, { recursive: true, force: true });
  assert.ok(fs.existsSync(file), "deleting the space leaves the ledger untouched");
});

test("a directory that is not a space is the root itself", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-plain-"));
  assert.deepEqual(ledgerRoot(dir), { root: dir });
});
