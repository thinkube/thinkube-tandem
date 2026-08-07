/**
 * Batch economics of the session: naming coalesces instead of running once
 * per request; N implications on one ask cost one re-derivation; apply-all
 * lands every staged implication with one re-derivation per affected ask.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TandemSession } from "./session";

test("naming coalesces: many quick requests cost two passes — none dropped, never one per request", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-"));
  let namingCalls = 0;
  const deps = {
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: dir,
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    // Slow and fruitless: the unit stays due, so every PASS calls this once.
    name: async () => {
      namingCalls++;
      await new Promise((r) => setTimeout(r, 20));
      return [];
    },
    now: () => "2026-08-07T10:00:00Z",
    readCurrentStamp: async () => [],
    classify: async () => "ask" as const,
    ground: async (_d: unknown, ask: { id: string }, opts: { nextIndex: number }) => ({
      changes: [
        {
          id: `node-${opts.nextIndex}`,
          sentence: "a thing to name",
          serves: [ask.id],
          needs: [],
          acceptance: [],
          grounding: { touchpoints: [{ path: "src/a.ts" }], stamp: [] },
        },
      ],
      questions: [],
    }),
  };
  const session = new TandemSession(deps as never);
  await session.capture("something nameable");
  namingCalls = 0;
  // Five accepts land while the first pass is still running.
  await Promise.all([1, 2, 3, 4, 5].map(() => session.renderAbstracts()));
  assert.equal(namingCalls, 2, "one running pass + one trailing pass — not five, and not a silent drop to one");
});

test("N implications on one ask cost ONE re-derivation under all decisions — never N pipelines", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-"));
  let grounds = 0;
  const deps = {
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: dir,
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    name: async () => [],
    now: () => "2026-08-07T11:00:00Z",
    readCurrentStamp: async () => [],
    classify: async () => "ask" as const,
    ground: async (
      _d: unknown,
      ask: { id: string },
      opts: { nextIndex: number; decisions?: string[] },
    ) => {
      grounds++;
      return {
        changes: [
          {
            id: `node-${opts.nextIndex}`,
            sentence: `promise v${grounds} (${(opts.decisions ?? []).length} decisions)`,
            serves: [ask.id],
            needs: [],
            acceptance: [],
            grounding: { touchpoints: [{ path: "src/a.ts" }], stamp: [] },
          },
        ],
        // The first derivation raises four questions — the treadmill seed.
        questions:
          grounds === 1
            ? [1, 2, 3, 4].map((i) => ({
                askId: ask.id,
                text: `open point ${i}?`,
                recommendation: `answer ${i}`,
              }))
            : [],
      };
    },
  };
  const session = new TandemSession(deps as never);
  await session.capture("one ask, many open points");
  assert.equal(session.space.questions.length, 4);
  // Accept every recommendation: four decisions, four staged implications.
  for (const q of [...session.space.questions]) await session.acceptQuestion(q.id);
  assert.equal(session.space.impacts!.length, 4, "each decision stages its implication");
  assert.equal(grounds, 1, "deciding alone re-derives nothing");
  // Accepting ONE implication re-derives the ask once, under ALL FOUR
  // decisions, and consumes the other three implications with it.
  const r = await session.decideImpact(session.space.impacts![0].id, true);
  assert.ok(r.ok);
  assert.equal(grounds, 2, "one pass — not one per implication");
  assert.equal(session.space.impacts!.length, 0, "the sibling implications are consumed");
  const node = session.space.nodes.find((n) => n.sentence.startsWith("promise v2"));
  assert.ok(node!.sentence.includes("4 decisions"), "the pass ran under every decision in force");
});

test("apply-all: every staged implication lands in one press — one re-derivation per affected ask, in a pool", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-"));
  const grounds: string[] = [];
  const deps = {
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: dir,
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    name: async () => [],
    now: () => "2026-08-07T12:00:00Z",
    readCurrentStamp: async () => [],
    classify: async () => "ask" as const,
    ground: async (
      _d: unknown,
      ask: { id: string; text: string },
      opts: { nextIndex: number; mintNodeId?: (n: number) => string },
    ) => {
      grounds.push(ask.id);
      const mint = opts.mintNodeId ?? ((n: number) => `node-${n}`);
      return {
        changes: [
          {
            id: mint(opts.nextIndex),
            sentence: `serves ${ask.id}`,
            serves: [ask.id],
            needs: [],
            acceptance: [],
            grounding: { touchpoints: [{ path: `src/${ask.id}.ts` }], stamp: [] },
          },
        ],
        questions: grounds.length <= 2 ? [{ askId: ask.id, text: `${ask.id} open?`, recommendation: "yes" }] : [],
      };
    },
  };
  const session = new TandemSession(deps as never);
  await session.captureMany(["first thing", "second thing"]);
  assert.equal(session.space.questions.length, 2);
  for (const q of [...session.space.questions]) await session.acceptQuestion(q.id);
  assert.equal(session.space.impacts!.length, 2, "one implication per decided ask");
  grounds.length = 0;
  const r = await session.applyAllImpacts();
  assert.ok(r.ok);
  assert.equal(grounds.length, 2, "each affected ask re-derived exactly once");
  assert.equal(session.space.impacts!.length, 0, "no implication left staged");
  const ids = session.space.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, "parallel re-derives never collide on node ids");
});
