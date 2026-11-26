/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The journal only grows, each session writes a file of its own, and it
 * reads back in the order things happened.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { appendRow, moduleHome, readRows } from "./journal";
import { tmp } from "./repo.fixture";

const say = (store: string, session: string, text: string, at: string) =>
  appendRow(
    store,
    "m-1",
    { kind: "said", by: "person", origin: "composer", text, session, author: "ana" },
    () => at,
  );

test("rows of several sessions and days read back in the order they happened", () => {
  const store = tmp("store");
  say(store, "s-2", "third", "2026-03-02T09:00:00.000Z");
  say(store, "s-1", "first", "2026-03-01T09:00:00.000Z");
  say(store, "s-2", "second", "2026-03-01T10:00:00.000Z");

  assert.deepEqual(
    readRows(store, "m-1").map((r) => (r.kind === "said" ? r.text : "")),
    ["first", "second", "third"],
  );
  assert.deepEqual(
    fs.readdirSync(path.join(moduleHome(store, "m-1"), "journal", "ana")).sort(),
    ["2026-03-01--s-1.jsonl", "2026-03-01--s-2.jsonl", "2026-03-02--s-2.jsonl"],
    "one file for each session and day",
  );
});

test("a row is added to its file and nothing before it changes", () => {
  const store = tmp("store");
  say(store, "s-1", "first", "2026-03-01T09:00:00.000Z");
  const file = path.join(moduleHome(store, "m-1"), "journal", "ana", "2026-03-01--s-1.jsonl");
  const before = fs.readFileSync(file, "utf8");
  say(store, "s-1", "second", "2026-03-01T09:05:00.000Z");
  assert.ok(fs.readFileSync(file, "utf8").startsWith(before));
});

test("reading stops at the day that gives enough, and keeps that day whole", () => {
  const store = tmp("store");
  say(store, "s-1", "old", "2026-03-01T09:00:00.000Z");
  say(store, "s-1", "morning", "2026-03-02T09:00:00.000Z");
  say(store, "s-1", "evening", "2026-03-02T19:00:00.000Z");

  const rows = readRows(store, "m-1", (r) => r.length >= 1);
  assert.deepEqual(
    rows.map((r) => (r.kind === "said" ? r.text : "")),
    ["morning", "evening"],
  );
});

test("a module nobody wrote to has an empty journal", () => {
  assert.deepEqual(readRows(tmp("store"), "m-1"), []);
});
