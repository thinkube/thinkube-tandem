/**
 * Grouping after sets exist adds things to build for the sentences no set
 * carries, and keeps the sets that exist — built, delivered or accepted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "./session";
import { emptySpace } from "../core/schema";
import { ungroupedAsks } from "./push";

function spaceWithOneSet() {
  return {
    ...emptySpace(),
    asks: [
      { id: "ask-1", text: "one", at: "t" },
      { id: "ask-2", text: "two", at: "t" },
      { id: "ask-3", text: "three", at: "t" },
      { id: "ask-4", text: "four", at: "t" },
    ],
    subjects: [
      { id: "s1", name: "my tasks", from: ["ask-1", "ask-2"] },
      // A re-read minted this one for sentences the set already covers.
      { id: "s2", name: "my tasks", from: ["ask-1", "ask-2"] },
      { id: "s3", name: "the new-task box", from: ["ask-3"] },
      { id: "s4", name: "deleting a task", from: ["ask-4"] },
    ],
    claims: [
      { id: "c1", subjectId: "s1", text: "a", fromAsk: "ask-1" },
      { id: "c3", subjectId: "s3", text: "c", fromAsk: "ask-3" },
      { id: "c4", subjectId: "s4", text: "d", fromAsk: "ask-4" },
    ],
    specs: [{ id: "spec-x-1", name: "I can see at a glance", subjectIds: ["s1"] }],
  } as never;
}

test("the push names the sentences no set carries, and not those a re-read repeated", () => {
  assert.deepEqual(ungroupedAsks(spaceWithOneSet()), [3, 4]);
  assert.deepEqual(ungroupedAsks({ ...(spaceWithOneSet() as object), specs: [] } as never), [], "with no sets yet, grouping is offered by another rule");
});

test("grouping again proposes sets for the loose subjects only and keeps the existing set", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "group-rest-"));
  const asked: string[][] = [];
  const s = new TandemSession({
    author: "tester",
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
    proposeSpecs: async (_deps: unknown, space: { subjects: { id: string }[] }) => {
      asked.push(space.subjects.map((x) => x.id));
      return { specs: [{ name: "adding and deleting", subjectIds: ["s3", "s4"] }], loose: [] };
    },
  } as never);
  s.space = spaceWithOneSet();
  const r = await s.groupIntoSpecs();
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(asked, [["s3", "s4"]], "the accepted set's subject and its re-read twin are not grouped again");
  const specs = s.space.specs!;
  assert.equal(specs.length, 2);
  assert.equal(specs[0].id, "spec-x-1", "the existing set stays");
  assert.match(specs[1].id, /-2$/);
  assert.deepEqual(specs[1].subjectIds, ["s3", "s4"]);
});

test("one loose subject becomes one thing to build without a round", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "group-one-"));
  const s = new TandemSession({
    author: "tester",
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
    proposeSpecs: async () => {
      throw new Error("no round for one subject");
    },
  } as never);
  const space = spaceWithOneSet() as { subjects: unknown[]; claims: unknown[] };
  space.subjects = space.subjects.slice(0, 3);
  s.space = space as never;
  assert.deepEqual(await s.groupIntoSpecs(), { ok: true });
  assert.deepEqual(s.space.specs![1].subjectIds, ["s3"]);
  assert.equal(s.space.specs![1].name, "the new-task box");
});

test("nothing loose: grouping again says so", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "group-none-"));
  const s = new TandemSession({
    author: "tester", round: { model: "sonnet", repoRoot: dir }, storeDir: dir, storageDir: path.join(dir, ".local"), now: () => new Date().toISOString(),
  } as never);
  const space = spaceWithOneSet() as { subjects: unknown[] };
  space.subjects = space.subjects.slice(0, 2);
  s.space = space as never;
  const r = await s.groupIntoSpecs();
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /already belongs/);
});
