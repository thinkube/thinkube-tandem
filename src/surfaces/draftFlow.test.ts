import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "./session";

function session(rounds: { n: number }): TandemSession {
  const deps = {
    round: { model: "opus", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-draft-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-k-")),
    now: () => "2026-08-10T12:00:00Z",
    readCurrentStamp: async () => [],
    solveModel: async (_d: unknown, texts: string[]) => {
      rounds.n++;
      return {
        subjects: [
          {
            name: "the delivery page",
            from: texts.map((_, i) => i + 1),
            claims: texts.map((t, i) => ({ text: t, from: i + 1, quote: t })),
          },
        ],
      };
    },
    ground: async () => ({ changes: [], questions: [] }),
  };
  return new TandemSession(deps as never);
}

test("what you write is kept without being read, and survives the window closing", () => {
  const rounds = { n: 0 };
  const s = session(rounds);
  s.saveDraft("the delivery page shows how to see it\nand the report reads as sections");
  assert.equal(rounds.n, 0, "writing spends nothing");
  assert.equal(s.space.asks.length, 0, "and records no ask");

  const reopened = new TandemSession(s.deps);
  assert.equal(
    reopened.space.draft,
    "the delivery page shows how to see it\nand the report reads as sections",
    "the words are where they were left",
  );
});

test("reading costs one round; keeping costs none", async () => {
  const rounds = { n: 0 };
  const s = session(rounds);
  s.saveDraft("the delivery page shows how to see it\nand it reads as sections");
  assert.ok((await s.readDraft()).ok);
  assert.equal(rounds.n, 1);
  assert.equal(s.space.asks.length, 0, "reading records nothing");
  assert.equal(s.pendingModel!.subjects[0].claims.length, 2);

  assert.ok(s.keepDraft().ok);
  assert.equal(rounds.n, 1, "keeping re-reads nothing — the cards are already worked out");
  assert.deepEqual(
    s.space.asks.map((a) => a.text),
    ["the delivery page shows how to see it", "and it reads as sections"],
    "recorded in order, word for word",
  );
  assert.equal(s.space.draft, "", "and the draft is emptied — those words live as asks now");
  assert.deepEqual(
    s.pendingModel!.askIds,
    s.space.asks.map((a) => a.id),
    "every sentence of the reading is bound to the ask it became",
  );
});

test("a reading behind the words refuses to be kept, and says to read again", async () => {
  const s = session({ n: 0 });
  s.saveDraft("the delivery page shows how to see it");
  await s.readDraft();
  s.saveDraft("the delivery page shows how to see it, with a reason");

  const r = s.keepDraft();
  assert.equal(r.ok, false);
  assert.match(r.reason!, /read it again/);
  assert.equal(s.space.asks.length, 0, "nothing is recorded under a model built from other words");
});

test("a second draft is read WITH what is already recorded, never alone", async () => {
  const rounds = { n: 0 };
  const seen: number[] = [];
  const s = session(rounds);
  (s.deps as { solveModel: unknown }).solveModel = async (_d: unknown, texts: string[]) => {
    seen.push(texts.length);
    return {
      subjects: [
        {
          name: "the delivery page",
          from: texts.map((_, i) => i + 1),
          claims: texts.map((t, i) => ({ text: t, from: i + 1, quote: t })),
        },
      ],
    };
  };
  s.saveDraft("the delivery page shows how to see it");
  await s.readDraft();
  s.keepDraft();

  s.saveDraft("and it names the check in my words");
  await s.readDraft();
  assert.deepEqual(seen, [1, 2], "the second reading saw the recorded sentence too");
  assert.deepEqual(s.draftRead(), ["and it names the check in my words"], "only the new line is draft");

  assert.ok(s.keepDraft().ok);
  assert.equal(s.space.asks.length, 2, "each sentence is recorded exactly once");
});

test("nothing written is nothing to read", async () => {
  const s = session({ n: 0 });
  const r = await s.readDraft();
  assert.equal(r.ok, false);
  assert.match(r.reason!, /nothing written/);
});
