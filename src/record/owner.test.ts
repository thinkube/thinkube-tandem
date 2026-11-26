/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One session owns a module, a session owns one module, and every change
 * of owner is a row of the journal.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readRows } from "./journal";
import { leave, ownedBy, ownerOf, take } from "./owner";
import { clockFrom, tmp } from "./repo.fixture";

const FORGE = { id: "forge-1", dir: "/work/control/extensions/forge" };
const MILL = { id: "mill-1", dir: "/work/control/extensions/mill" };

const changes = (store: string, moduleId: string) =>
  readRows(store, moduleId).flatMap((r) => (r.kind === "owner" ? [`${r.session} ${r.state}`] : []));

test("a session that takes a module owns it, and taking it again changes nothing", () => {
  const store = tmp("store");
  const now = clockFrom("2026-03-01T10:00:00.000Z");
  const first = take(store, "ana", "s-1", FORGE, now);
  const again = take(store, "ana", "s-1", FORGE, now);

  assert.deepEqual(again, first);
  assert.equal(ownedBy(store, "ana", "s-1")?.moduleId, "forge-1");
  assert.equal(ownerOf(store, "forge-1", "ana")?.dir, FORGE.dir);
  assert.deepEqual(changes(store, "forge-1"), ["s-1 took"]);
});

test("a module taken by another session changes owner, and the journal says who left", () => {
  const store = tmp("store");
  const now = clockFrom("2026-03-01T10:00:00.000Z");
  take(store, "ana", "s-1", FORGE, now);
  take(store, "ana", "s-2", FORGE, now);

  assert.equal(ownerOf(store, "forge-1", "ana")?.session, "s-2");
  assert.equal(ownedBy(store, "ana", "s-1"), undefined);
  assert.deepEqual(changes(store, "forge-1"), ["s-1 took", "s-1 left", "s-2 took"]);
});

test("a session that takes a second module leaves the first", () => {
  const store = tmp("store");
  const now = clockFrom("2026-03-01T10:00:00.000Z");
  take(store, "ana", "s-1", FORGE, now);
  take(store, "ana", "s-1", MILL, now);

  assert.equal(ownedBy(store, "ana", "s-1")?.moduleId, "mill-1");
  assert.equal(ownerOf(store, "forge-1", "ana"), undefined);
  assert.deepEqual(changes(store, "forge-1"), ["s-1 took", "s-1 left"]);
  assert.deepEqual(changes(store, "mill-1"), ["s-1 took"]);
});

test("a session that leaves owns nothing, and leaving twice is not an error", () => {
  const store = tmp("store");
  const now = clockFrom("2026-03-01T10:00:00.000Z");
  take(store, "ana", "s-1", FORGE, now);

  assert.equal(leave(store, "ana", "s-1", now), "forge-1");
  assert.equal(leave(store, "ana", "s-1", now), undefined);
  assert.equal(ownedBy(store, "ana", "s-1"), undefined);
  assert.deepEqual(changes(store, "forge-1"), ["s-1 took", "s-1 left"]);
});

test("the folder a module is in can change without a change of owner", () => {
  const store = tmp("store");
  const now = clockFrom("2026-03-01T10:00:00.000Z");
  take(store, "ana", "s-1", FORGE, now);
  take(store, "ana", "s-1", { ...FORGE, dir: "/moved/forge" }, now);

  assert.equal(ownerOf(store, "forge-1", "ana")?.dir, "/moved/forge");
  assert.deepEqual(changes(store, "forge-1"), ["s-1 took"]);
});
