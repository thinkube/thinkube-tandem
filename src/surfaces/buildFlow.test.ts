/**
 * Committing: what may be built, when, and what the press binds. Building
 * is the one act that cannot be undone, so these pin the guards around it
 * — whole components only, nothing while the machine is still deriving,
 * and every object's thinking written as it arrives.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "./session";
import { readyToBuild } from "./buildFlow";

test("building commits whole components: assumptions become marked rules and the sentences lock", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-"));
  const deps = {
    round: { model: "opus", repoRoot: "/repo" },
    storeDir: dir,
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-b-")),
    now: () => "2026-08-09T12:00:00Z",
    readCurrentStamp: async () => [],
    classify: async () => "ask" as const,
    contextRound: async () => "LAYOUT: one reading",
    // One object read from BOTH sentences — the component that must ship
    // together, so neither sentence can be left half-built.
    solveModel: async () => ({
      subjects: [
        {
          name: "the delivery page",
          from: [1, 2],
          claims: [
            { text: "shows how to see it", from: 1 },
            { text: "names the check in my words", from: 2 },
          ],
        },
      ],
      rules: [],
    }),
    ground: async (
      _d: unknown,
      ask: { id: string },
      opts: { claims?: { id: string }[]; mintNodeId?: (n: number) => string },
    ) => ({
      changes: (opts.claims ?? []).map((c, i) => ({
        id: (opts.mintNodeId ?? ((n: number) => `node-${n}`))(i + 1),
        sentence: `promise for ${c.id}`,
        serves: [ask.id],
        servesClaim: c.id,
        needs: [],
        acceptance: [{ id: `a${i}`, text: "proved" }],
        grounding: { touchpoints: [{ path: "src/a.ts" }], stamp: [] },
      })),
      questions: [
        {
          askId: ask.id,
          text: "does a page with no doors still get a walkthrough?",
          recommendation: "no — it says there is no way in yet",
          clause: "shows how to see it",
        },
      ],
    }),
  };
  const session = new TandemSession(deps as never);
  await session.captureMany(["the delivery page shows how to see it", "labels in my words"]);
  await session.think();

  assert.equal(session.priceOf(session.space.asks[0].id).state, "open");
  const r = await session.build();
  assert.ok(r.ok, r.reason);

  const rule = (session.space.rules ?? []).find((x) => /no way in yet/.test(x.text));
  assert.ok(rule, "what nobody objected to is in force now");
  assert.equal(rule!.assumed, true, "and it is marked as assumed, not as something you wrote");
  assert.match(rule!.scope, /shows how to see it/, "it carries the clause that was silent");

  for (const a of session.space.asks)
    assert.equal(
      session.priceOf(a.id).state,
      "bound",
      "both sentences of the component are read-only — neither is half-built",
    );
  const refused = await session.reframe(session.space.asks[0].id, "something else");
  assert.equal(refused.ok, false);
  assert.match(refused.reason!, /already built/);
});

test("nothing may be built while the machine is still deriving", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-"));
  let release: (() => void) | undefined;
  let firstDone: () => void;
  const first = new Promise<void>((r) => (firstDone = r));
  const deps = {
    round: { model: "opus", repoRoot: "/repo" },
    storeDir: dir,
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-r-")),
    now: () => "2026-08-09T14:00:00Z",
    readCurrentStamp: async () => [],
    classify: async () => "ask" as const,
    contextRound: async () => "LAYOUT: one reading",
    solveModel: async () => ({
      subjects: [
        { name: "the first thing", from: [1], claims: [{ text: "it works", from: 1 }] },
        { name: "the second thing", from: [2], claims: [{ text: "it also works", from: 2 }] },
      ],
      rules: [],
    }),
    // The first object grounds at once; the second is still thinking.
    ground: async (_d: unknown, ask: { id: string }, opts: { claims?: { id: string }[] }) => {
      if (ask.id.endsWith("-2")) await new Promise<void>((r) => (release = r));
      else queueMicrotask(() => setImmediate(firstDone));
      return {
        changes: (opts.claims ?? []).map((c, i) => ({
          id: `node-${ask.id}-${i}`,
          sentence: `promise for ${c.id}`,
          serves: [ask.id],
          servesClaim: c.id,
          needs: [],
          acceptance: [{ id: `a${i}`, text: "proved" }],
          grounding: { touchpoints: [{ path: "src/a.ts" }], stamp: [] },
        })),
        questions: [],
      };
    },
  };
  const session = new TandemSession(deps as never);
  await session.captureMany(["the first thing works", "the second thing works too"]);
  const thinking = session.think();

  // Mid-derivation: one object has promises, the other does not. Waiting
  // on the object itself, never on a clock — a timer makes the test lie
  // under load, which is exactly what it is here to catch.
  await first;
  const mid = readyToBuild(session.space, session.groundingView().length > 0);
  assert.equal(mid.thinking, true, "the machine is still deriving");
  assert.equal(mid.objects, 0, "so nothing is offered to build — not even the finished object");
  const refused = await session.build();
  assert.equal(refused.ok, false, "and building is refused outright");

  release!();
  await thinking;
  const done = readyToBuild(session.space, session.groundingView().length > 0);
  assert.equal(done.thinking, false);
  assert.deepEqual(
    session.groundingView(),
    [],
    "and no object is left marked as still thinking once its own round has finished",
  );
  assert.equal(done.objects, 2, "both objects, once every one has been thought through");
});

test("each object's thinking is written as it arrives, not only at the end", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-"));
  let release: (() => void) | undefined;
  let firstDone: () => void;
  const first = new Promise<void>((r) => (firstDone = r));
  const deps = {
    round: { model: "opus", repoRoot: "/repo" },
    storeDir: dir,
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-p-")),
    now: () => "2026-08-09T15:00:00Z",
    readCurrentStamp: async () => [],
    classify: async () => "ask" as const,
    contextRound: async () => "LAYOUT: one reading",
    solveModel: async () => ({
      subjects: [
        { name: "the first thing", from: [1], claims: [{ text: "it works", from: 1 }] },
        { name: "the second thing", from: [2], claims: [{ text: "it also works", from: 2 }] },
      ],
      rules: [],
    }),
    ground: async (_d: unknown, ask: { id: string }, opts: { claims?: { id: string }[] }) => {
      if (ask.id.endsWith("-2")) await new Promise<void>((r) => (release = r));
      else queueMicrotask(() => setImmediate(firstDone));
      return {
        changes: (opts.claims ?? []).map((c, i) => ({
          id: `node-${ask.id}-${i}`,
          sentence: `promise for ${c.id}`,
          serves: [ask.id],
          servesClaim: c.id,
          needs: [],
          acceptance: [{ id: `a${i}`, text: "proved" }],
          grounding: { touchpoints: [{ path: "src/a.ts" }], stamp: [] },
        })),
        questions: [],
      };
    },
  };
  const session = new TandemSession(deps as never);
  await session.captureMany(["the first thing works", "the second thing works too"]);
  const thinking = session.think();
  await first;

  // Mid-flight: a fresh session reading the same store already has the
  // object that finished — the rounds it cost are not at risk.
  const reloaded = new TandemSession(deps as never);
  assert.equal(reloaded.space.nodes.length, 1, "the finished object was written as it arrived");

  release!();
  await thinking;
  assert.equal(new TandemSession(deps as never).space.nodes.length, 2);
});
