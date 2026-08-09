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

test("building commits whole components: assumptions become decisions and the asks lock", async () => {
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

  const decided = session.space.questions.find((q) => /no way in yet/.test(q.decided?.text ?? ""));
  assert.ok(decided, "what nobody objected to is a decision on the record now");
  assert.equal(decided!.clause, "shows how to see it", "it keeps the clause that was silent");
  assert.ok(
    session.decisionsInForce().some((d) => /no way in yet/.test(d)),
    "and every later derivation in this space runs under it",
  );

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
  assert.equal(mid.subjects, 0, "so nothing is offered to build — not even the finished subject");
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
  assert.equal(done.subjects, 2, "both subjects, once every one has been thought through");
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

test("the one line above the subjects never borrows a single subject's stage", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-"));
  const seen: { label: string; current: number; total: number }[] = [];
  let session!: TandemSession;
  const deps = {
    round: { model: "opus", repoRoot: "/repo" },
    storeDir: dir,
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-a-")),
    now: () => "2026-08-09T16:00:00Z",
    readCurrentStamp: async () => [],
    classify: async () => "ask" as const,
    contextRound: async () => "LAYOUT: one reading",
    onChanged: () => {
      if (session?.activity) seen.push({ ...session.activity });
    },
    solveModel: async () => ({
      subjects: [1, 2, 3].map((n) => ({
        name: `thing ${n}`,
        from: [n],
        claims: [{ text: `it works ${n}`, from: n }],
      })),
      rules: [],
    }),
    // Each subject reports its own stages, as the real pipeline does.
    ground: async (
      _d: unknown,
      ask: { id: string },
      opts: { claims?: { id: string }[]; onStage?: (l: string, c: number, t: number) => void },
    ) => {
      opts.onStage?.("reading your code", 1, 4);
      opts.onStage?.("weighing coverage, criteria and decisions", 4, 4);
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
  session = new TandemSession(deps as never);
  await session.captureMany(["one", "two", "three"]);
  await session.think();

  // The per-subject stages the pipeline reports — never the shared
  // reading of the code, which really is one step for everything.
  const stages = seen.filter(
    (a) => a.label === "weighing coverage, criteria and decisions" || a.total === 4,
  );
  assert.deepEqual(
    stages,
    [],
    `the aggregate quoted a single subject's stage: ${JSON.stringify(stages.slice(0, 2))}`,
  );
  assert.ok(
    seen.some((a) => /3 subjects, each at its own stage/.test(a.label)),
    `it says what is really true: ${JSON.stringify(seen.slice(0, 3))}`,
  );
  const counts = seen.filter((a) => a.total === 3).map((a) => a.current);
  assert.ok(
    counts.includes(0) && counts.includes(3),
    `and counts subjects finished, from none to all: ${JSON.stringify(counts)}`,
  );
  assert.equal(session.activity, undefined, "and it stops when the thinking stops");
});

test("nine subjects mean nine groundings and ONE search for what is missing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-"));
  const grounded: string[] = [];
  let completeness = 0;
  const deps = {
    round: { model: "opus", repoRoot: "/repo" },
    storeDir: dir,
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-c-")),
    now: () => "2026-08-09T18:00:00Z",
    readCurrentStamp: async () => [],
    classify: async () => "ask" as const,
    contextRound: async () => "LAYOUT: one reading",
    solveModel: async () => ({
      subjects: [1, 2, 3].map((n) => ({
        name: `thing ${n}`,
        from: [n],
        claims: [{ text: `it works ${n}`, from: n }],
      })),
      rules: [],
    }),
    ground: async (
      _d: unknown,
      ask: { id: string },
      opts: { claims?: { id: string }[]; skipCompleteness?: boolean },
    ) => {
      grounded.push(ask.id);
      assert.equal(
        opts.skipCompleteness,
        true,
        "a subject's own round no longer hunts for ripples",
      );
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
    completeCut: async () => {
      completeness++;
      return [];
    },
  };
  const session = new TandemSession(deps as never);
  await session.captureMany(["one", "two", "three"]);
  await session.think();

  assert.equal(grounded.length, 3, "one grounding per subject");
  assert.equal(completeness, 1, "and ONE search over the whole cut, not three");
});
