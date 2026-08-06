/**
 * The thinking-space level: names slug deterministically, creation refuses
 * duplicates and empty names, listing reads labels, and deletion refuses
 * the moment anything signed exists inside — any user's signature.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  createThinkingSpace,
  deleteThinkingSpace,
  listThinkingSpaces,
  slugifySpaceName,
  thinkingSpaceDirs,
} from "./spaces";
import { appendRecord } from "./records";
import { emptySpace } from "./schema";

const now = () => "2026-08-06T12:00:00Z";

test("space names slug like directories and refuse emptiness", () => {
  assert.equal(slugifySpaceName("Tandem UI enhancements"), "tandem-ui-enhancements");
  assert.equal(slugifySpaceName("  !!  "), "");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-spaces-"));
  assert.equal(createThinkingSpace(root, "repo-1", "   ").ok, false);
});

test("create, list, and address a thinking space; duplicates refuse", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-spaces-"));
  const made = createThinkingSpace(root, "repo-1", "Plugin delivery");
  assert.ok(made.ok && made.slug === "plugin-delivery");
  assert.equal(createThinkingSpace(root, "repo-1", "plugin delivery").ok, false, "same slug refuses");
  assert.ok(createThinkingSpace(root, "repo-1", "rebrand").ok);
  assert.deepEqual(
    listThinkingSpaces(root, "repo-1").map((s) => [s.slug, s.label]),
    [
      ["plugin-delivery", "Plugin delivery"],
      ["rebrand", "rebrand"],
    ],
    "labels read back; slug is the fallback label",
  );
  const dirs = thinkingSpaceDirs(root, "repo-1", "plugin-delivery", "alice");
  assert.equal(dirs.storeDir, path.join(root, "spaces", "repo-1", "plugin-delivery", "alice"));
  assert.equal(dirs.foldDir, path.join(root, "spaces", "repo-1", "plugin-delivery"));
  assert.deepEqual(listThinkingSpaces(root, "other-repo"), [], "owners are isolated");
});

test("deletion: fine while nothing is signed; refused forever after a signature", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-spaces-"));
  const made = createThinkingSpace(root, "repo-1", "scratch");
  assert.ok(made.ok);
  assert.ok(deleteThinkingSpace(root, "repo-1", "scratch", now).ok, "unsigned space deletes");
  assert.deepEqual(listThinkingSpaces(root, "repo-1"), []);

  const again = createThinkingSpace(root, "repo-1", "kept");
  assert.ok(again.ok);
  const dirs = thinkingSpaceDirs(root, "repo-1", "kept", "alice");
  fs.mkdirSync(dirs.storeDir, { recursive: true });
  appendRecord(dirs.storeDir, {
    at: now(),
    author: "alice",
    kind: "snapshot",
    space: {
      ...emptySpace(),
      cuts: [
        {
          id: "cut-1",
          changeIds: [],
          signature: { at: now(), renderHash: "r", groundingHash: "g" },
        },
      ],
    },
    cut: [],
  });
  const refused = deleteThinkingSpace(root, "repo-1", "kept", now);
  assert.equal(refused.ok, false);
  assert.ok(refused.reason!.includes("signed"), "the refusal says why");
  assert.equal(listThinkingSpaces(root, "repo-1").length, 1, "nothing was removed");
});
