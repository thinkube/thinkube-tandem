/**
 * The fold carries the reading. Two authors' latest records fold into one
 * space; the subjects, claims and sets in them must arrive, the way asks
 * and promises do. A fold that rebuilt the space from a fixed list of
 * fields left them behind, and a space two people had read showed nothing
 * derived while both readings sat in the store.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { appendRecord, loadFolded } from "./records";
import { emptySpace, Space } from "./schema";

function reading(author: string, n: number): Space {
  return {
    ...emptySpace(),
    asks: [{ id: `ask-${author}-1`, text: `sentence ${n}` } as Space["asks"][number]],
    subjects: [{ id: `subject-${author}-${n}`, name: `thing ${n}`, from: [`ask-${author}-1`] }],
    claims: [
      { id: `claim-${author}-${n}`, subjectId: `subject-${author}-${n}`, text: `claim ${n}`, fromAsk: `ask-${author}-1` },
    ],
    specs: [{ id: `spec-${author}-${n}`, name: `set ${n}`, subjectIds: [`subject-${author}-${n}`] }],
  };
}

test("subjects, claims and sets survive a fold across two authors", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fold-"));
  const dirOf = (author: string): string => path.join(root, author);
  appendRecord(dirOf("ana"), { at: "2026-01-01T00:00:00.000Z", author: "ana", kind: "snapshot", space: reading("ana", 1), cut: [] });
  appendRecord(dirOf("ben"), { at: "2026-01-01T00:00:01.000Z", author: "ben", kind: "snapshot", space: reading("ben", 2), cut: [] });

  const { space } = loadFolded(root, dirOf("ana"), "ana", () => "2026-01-01T00:00:02.000Z");
  assert.deepEqual(
    (space.subjects ?? []).map((s) => s.id).sort(),
    ["subject-ana-1", "subject-ben-2"],
    "both readings are in the fold",
  );
  assert.equal((space.claims ?? []).length, 2, "every claim arrives");
  assert.deepEqual((space.specs ?? []).map((s) => s.id).sort(), ["spec-ana-1", "spec-ben-2"], "the sets arrive");
});

test("a fold of one author is that author's space, untouched", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fold-"));
  const dir = path.join(root, "ana");
  appendRecord(dir, { at: "2026-01-01T00:00:00.000Z", author: "ana", kind: "snapshot", space: reading("ana", 1), cut: [] });
  const { space } = loadFolded(root, dir, "ana", () => "2026-01-01T00:00:02.000Z");
  assert.equal(space.subjects?.length, 1);
  assert.equal(space.specs?.length, 1);
});
