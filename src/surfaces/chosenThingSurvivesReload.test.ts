/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The thing in hand survives a window reload.
 *
 * Working a thing out writes its promises on the record and the cut in
 * hand beside them, but the choice itself lived only in the session: a
 * reload between working out and signing offered "Build the first" again
 * and opened your sentences instead of the work page. The choice is read
 * back from the cut.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "./session";
import { emptySpace } from "../core/schema";

function fresh(dir: string): TandemSession {
  return new TandemSession({
    author: "tester",
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
  });
}

const space = () => ({
  ...emptySpace(),
  asks: [
    { id: "ask-1", text: "one", at: "t" },
    { id: "ask-2", text: "two", at: "t" },
  ],
  subjects: [
    { id: "s1", name: "the list", from: ["ask-1"] },
    { id: "s2", name: "the count", from: ["ask-2"] },
  ],
  nodes: [
    { id: "n1", sentence: "the list is ordered", serves: ["s1"], needs: [], acceptance: [] },
    { id: "n2", sentence: "the count is one phrase", serves: ["s2"], needs: [], acceptance: [] },
  ],
  specs: [
    { id: "spec-t-1", name: "I find a task in the same place", subjectIds: ["s1"] },
    { id: "spec-t-2", name: "The count says it one way", subjectIds: ["s2"] },
  ],
});

test("a thing chosen and worked out is still in hand after the window reloads", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-reload-"));
  const a = fresh(dir);
  a.space = space() as never;
  a.cutNodeIds = new Set(["n1"]);
  a.cutSpecId = "spec-t-1";
  a.persist();

  const b = fresh(dir);
  b.load();
  assert.equal(b.chosenSpec()?.id, "spec-t-1", "the choice is read back from the cut");
  assert.deepEqual([...b.cutNodeIds], ["n1"]);
});

test("a set already signed is not in hand again, and an empty cut names nothing", () => {
  const signedDir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-reload-signed-"));
  const a = fresh(signedDir);
  a.space = { ...space(), cuts: [{ id: "cut-1", changeIds: ["n1"], specId: "spec-t-1" }] } as never;
  a.cutNodeIds = new Set(["n1"]);
  a.persist();
  const b = fresh(signedDir);
  b.load();
  assert.equal(b.chosenSpec(), undefined, "signed work is not in hand");

  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-reload-empty-"));
  const c = fresh(emptyDir);
  c.space = space() as never;
  c.persist();
  const d = fresh(emptyDir);
  d.load();
  assert.equal(d.chosenSpec(), undefined, "nothing in hand names no set");
});
