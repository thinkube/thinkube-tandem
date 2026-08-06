/**
 * The append-only store over real files: appends never edit, the fold is
 * deterministic and total across authors, another author's decision
 * carries, contradictory decisions surface as a question instead of
 * resolving by merge order, colliding legacy ids qualify with references
 * rewritten, and a pre-records space.json imports once.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  appendRecord,
  foldSpaces,
  latestPerAuthor,
  loadFolded,
  SnapshotRecord,
} from "./records";
import { emptySpace, Space } from "./schema";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tandem-rec-"));
}

function spaceWith(partial: Partial<Space>): Space {
  return { ...emptySpace(), ...partial };
}

const rec = (author: string, at: string, space: Space, cut: string[] = []): SnapshotRecord => ({
  at,
  author,
  kind: "snapshot",
  space,
  cut,
});

test("appending is creating a file — a same-instant append gets a tiebreaker, nothing is edited", () => {
  const dir = tmp();
  const r = rec("alex", "2026-08-06T10:00:00.000Z", emptySpace());
  const f1 = appendRecord(dir, r);
  const f2 = appendRecord(dir, r);
  assert.notEqual(f1, f2, "second append created a NEW file");
  assert.ok(fs.existsSync(f1) && fs.existsSync(f2));
});

test("single-user round-trip: the latest record is the state; own cut selection rides along", () => {
  const dir = tmp();
  const s1 = spaceWith({ asks: [{ id: "ask-u-1", text: "first", at: "t1" }] });
  appendRecord(dir, rec("u", "2026-08-06T10:00:00.000Z", s1));
  const s2 = spaceWith({
    asks: [
      { id: "ask-u-1", text: "first", at: "t1" },
      { id: "ask-u-2", text: "second", at: "t2" },
    ],
  });
  appendRecord(dir, rec("u", "2026-08-06T10:01:00.000Z", s2, ["node-u-1"]));
  const folded = loadFolded(dir, dir, "u", () => "t");
  assert.equal(folded.space.asks.length, 2);
  assert.deepEqual(folded.cut, ["node-u-1"]);
});

test("legacy space.json imports ONCE as a record — nothing edited, state preserved", () => {
  const dir = tmp();
  fs.writeFileSync(
    path.join(dir, "space.json"),
    JSON.stringify({ space: spaceWith({ asks: [{ id: "ask-1", text: "legacy", at: "t" }] }), cut: ["node-1"] }),
  );
  const folded = loadFolded(dir, dir, "u", () => "2026-08-06T09:00:00.000Z");
  assert.equal(folded.space.asks[0].text, "legacy");
  assert.deepEqual(folded.cut, ["node-1"]);
  const files = fs.readdirSync(path.join(dir, "records"));
  assert.equal(files.length, 1);
  assert.ok(files[0].includes("space-imported"));
  assert.ok(fs.existsSync(path.join(dir, "space.json")), "the legacy file is left untouched");
});

test("two authors fold: asks union; another author's decision on my question carries with its signer's answer", () => {
  const mine = spaceWith({
    asks: [{ id: "ask-alex-1", text: "the toolbar", at: "t1" }],
    questions: [{ id: "q-alex-1", askId: "ask-alex-1", text: "top or side?", recommendation: "top" }],
  });
  const theirs = spaceWith({
    asks: [{ id: "ask-maria-1", text: "the exporter", at: "t2" }],
    questions: [
      { id: "q-alex-1", askId: "ask-alex-1", text: "top or side?", recommendation: "top", decided: { text: "side", at: "t3" } },
    ],
  });
  const folded = foldSpaces(latestPerAuthor([
    rec("alex", "2026-08-06T10:00:00.000Z", mine),
    rec("maria", "2026-08-06T10:05:00.000Z", theirs),
  ]));
  assert.equal(folded.asks.length, 2, "asks union by author");
  const q = folded.questions.find((x) => x.id === "q-alex-1")!;
  assert.equal(q.decided?.text, "side", "maria's decision on alex's question stands");
});

test("contradictory decisions NEVER resolve by merge order — the question re-opens and the conflict is a question", () => {
  const base = spaceWith({
    asks: [{ id: "ask-alex-1", text: "x", at: "t" }],
  });
  const alex = {
    ...base,
    questions: [{ id: "q-alex-1", askId: "ask-alex-1", text: "which db?", decided: { text: "postgres", at: "t1" } }],
  };
  const maria = {
    ...base,
    questions: [{ id: "q-alex-1", askId: "ask-alex-1", text: "which db?", decided: { text: "sqlite", at: "t2" } }],
  };
  const a = foldSpaces(latestPerAuthor([
    rec("alex", "2026-08-06T10:00:00.000Z", alex),
    rec("maria", "2026-08-06T10:05:00.000Z", maria),
  ]));
  const b = foldSpaces(latestPerAuthor([
    rec("maria", "2026-08-06T10:05:00.000Z", maria),
    rec("alex", "2026-08-06T10:00:00.000Z", alex),
  ]));
  for (const folded of [a, b]) {
    const q = folded.questions.find((x) => x.id === "q-alex-1")!;
    assert.equal(q.decided, undefined, "no silent winner");
    const conflict = folded.questions.find((x) => x.id === "conflict-q-alex-1")!;
    assert.ok(conflict.text.includes("postgres") && conflict.text.includes("sqlite"));
    assert.ok(conflict.recommendation, "the conflict question carries a recommendation");
  }
  assert.deepEqual(a, b, "identical record sets produce identical state regardless of input order");
});

test("colliding legacy ids qualify by author with references rewritten — never silently merged", () => {
  const alex = spaceWith({
    asks: [{ id: "ask-1", text: "alex's ask", at: "t1" }],
    nodes: [
      { id: "node-1", sentence: "alex's change", serves: ["ask-1"], needs: [], acceptance: [{ id: "c", text: "x" }] },
    ],
  });
  const maria = spaceWith({
    asks: [{ id: "ask-1", text: "maria's DIFFERENT ask", at: "t2" }],
    nodes: [
      { id: "node-1", sentence: "maria's change", serves: ["ask-1"], needs: [], acceptance: [{ id: "c", text: "y" }] },
    ],
  });
  const folded = foldSpaces(latestPerAuthor([
    rec("alex", "2026-08-06T10:00:00.000Z", alex),
    rec("maria", "2026-08-06T10:05:00.000Z", maria),
  ]));
  assert.equal(folded.asks.length, 2, "both asks survive");
  const mariasNode = folded.nodes.find((n) => n.sentence === "maria's change")!;
  assert.equal(mariasNode.id, "node-1~maria", "the later author's colliding id is qualified");
  assert.deepEqual(mariasNode.serves, ["ask-1~maria"], "references follow the qualification");
  const alexNode = folded.nodes.find((n) => n.sentence === "alex's change")!;
  assert.equal(alexNode.id, "node-1", "the first writer keeps the id");
});
