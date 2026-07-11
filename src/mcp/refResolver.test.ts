/**
 * refResolver — the ONE spec/slice ref grammar. The acceptance table below is
 * the contract every kanban tool now shares; the two "2026-07-11" cases are the
 * literal inputs that silently built `teps/TEP-TEP-1_SP-4/SP-undefined/…` paths
 * before this module existed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeSpecRef,
  resolveSpecRef,
  resolveSliceRef,
} from "./refResolver";

const DIRS = ["1/1", "1/3", "1/4", "3/3", "6/2", "6/8"];
const list = () => Promise.resolve(DIRS);
const boom = () => Promise.reject(new Error("listSpecDirs must not be called"));

// ── spec refs: every accepted written form → the composite ────────────────

test("composite forms normalize without a lookup", async () => {
  assert.equal(await resolveSpecRef(boom, "1/4"), "1/4");
  assert.equal(await resolveSpecRef(boom, "TEP-1/SP-4"), "1/4");
  assert.equal(await resolveSpecRef(boom, "TEP-1/4"), "1/4");
  assert.equal(await resolveSpecRef(boom, "SP-1/4"), "1/4"); // /attend's Spec-id form
  assert.equal(await resolveSpecRef(boom, " 1/4 "), "1/4"); // whitespace tolerated
});

test("the flat spec handle TEP-1_SP-4 resolves (2026-07-11 failure #1)", async () => {
  assert.equal(await resolveSpecRef(boom, "TEP-1_SP-4"), "1/4");
});

test("bare SP-4 / 4 resolve via unique lookup (2026-07-11 failure #2)", async () => {
  assert.equal(await resolveSpecRef(list, "SP-4"), "1/4");
  assert.equal(await resolveSpecRef(list, "4"), "1/4");
  assert.equal(await resolveSpecRef(list, "8"), "6/8");
});

test("ids are strictly numeric — lettered id shapes refuse loudly", async () => {
  for (const bad of ["th3i18/2", "TEP-th3i18_SP-2", "SP-z9", "tgzyfy"]) {
    await assert.rejects(
      () => resolveSpecRef(boom, bad),
      /spec (id|ref)/,
      `expected refusal for ${JSON.stringify(bad)}`,
    );
  }
});

test("an ambiguous bare id refuses, naming the candidate TEPs", async () => {
  await assert.rejects(
    () => resolveSpecRef(list, "3"),
    (e: Error) => {
      assert.match(e.message, /Ambiguous spec id "3"/);
      assert.match(e.message, /TEP-1, TEP-3/);
      assert.match(e.message, /<tep>\/3/);
      return true;
    },
  );
});

test("an unknown bare id REFUSES — never returned verbatim", async () => {
  // The old verbatim return let pathForSpecDoc("99") build `TEP-99/SP-undefined`.
  await assert.rejects(
    () => resolveSpecRef(list, "99"),
    (e: Error) => {
      assert.match(e.message, /No spec SP-99 found/);
      assert.match(e.message, /spec ref/);
      return true;
    },
  );
});

test("garbage refuses, stating the grammar", async () => {
  for (const bad of ["TEP-1_SP-", "Platform/projects/rebrand", "1/4/x", "TEP-1", "_SP-4", ""]) {
    await assert.rejects(
      () => resolveSpecRef(boom, bad),
      (e: Error) => {
        assert.match(e.message, /spec (id|ref)/);
        return true;
      },
      `expected refusal for ${JSON.stringify(bad)}`,
    );
  }
});

test("normalizeSpecRef is purely lexical (bare stays bare for write_spec's compose path)", () => {
  assert.deepEqual(normalizeSpecRef("TEP-1_SP-4"), { kind: "composite", id: "1/4" });
  assert.deepEqual(normalizeSpecRef("SP-4"), { kind: "bare", id: "4" });
  assert.deepEqual(normalizeSpecRef("4"), { kind: "bare", id: "4" });
});

// ── slice refs ─────────────────────────────────────────────────────────────

test("full slice handle resolves without a lookup", async () => {
  assert.deepEqual(await resolveSliceRef(boom, "TEP-1_SP-4_SL-1"), {
    specNumber: "1/4",
    sliceNumber: 1,
  });
});

test("TEP-less SP-4_SL-1 resolves its spec part via lookup (documented tool-example form)", async () => {
  assert.deepEqual(await resolveSliceRef(list, "SP-4_SL-1"), {
    specNumber: "1/4",
    sliceNumber: 1,
  });
});

test("composite 1/4/1 resolves", async () => {
  assert.deepEqual(await resolveSliceRef(boom, "1/4/1"), {
    specNumber: "1/4",
    sliceNumber: 1,
  });
});

test("lettered slice handles refuse loudly", async () => {
  await assert.rejects(
    () => resolveSliceRef(boom, "TEP-th3i18_SP-2_SL-7"),
    /slice (handle|ref)/,
  );
});

test("garbage slice refs refuse, stating the grammar", async () => {
  for (const bad of ["SL-1", "TEP-1_SL-1", "1/4", "SP-4_SL-x", ""]) {
    await assert.rejects(
      () => resolveSliceRef(boom, bad),
      (e: Error) => {
        assert.match(e.message, /slice (handle|ref)/);
        return true;
      },
      `expected refusal for ${JSON.stringify(bad)}`,
    );
  }
});
