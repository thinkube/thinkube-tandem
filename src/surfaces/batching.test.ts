/**
 * Batch economics of the session: N implications on one ask cost one
 * re-derivation, and apply-all lands every staged implication with one
 * re-derivation per affected ask.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TandemSession } from "./session";

/** The new capture: the round proposes a model, the human accepts it, and
 *  every subject grounds. Tests drive the same two steps a person does. */
async function captureAndAccept(session: TandemSession, texts: string[]): Promise<void> {
  await session.captureMany(texts);
  await session.think();
}

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
    solveModel: async (_d: unknown, texts: string[]) => ({
      subjects: texts.map((t, i) => ({ name: t, from: [i + 1], claims: [{ text: t, from: i + 1 }] })),
      rules: [],
    }),
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
  await session.think();
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
    solveModel: async (_d: unknown, texts: string[]) => ({
      subjects: texts.map((t, i) => ({ name: t, from: [i + 1], claims: [{ text: t, from: i + 1 }] })),
      rules: [],
    }),
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
  await captureAndAccept(session, ["first thing", "second thing"]);
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

test("a batch reads the repository ONCE before it fans out — no worker re-reads", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-"));
  const order: string[] = [];
  let contextRounds = 0;
  const deps = {
    round: { model: "opus", volumeModel: "sonnet", repoRoot: "/repo" },
    storeDir: dir,
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    name: async () => [],
    now: () => "2026-08-07T13:00:00Z",
    readCurrentStamp: async () => [],
    classify: async () => "ask" as const,
    solveModel: async (_d: unknown, texts: string[]) => ({
      subjects: texts.map((t, i) => ({ name: t, from: [i + 1], claims: [{ text: t, from: i + 1 }] })),
      rules: [],
    }),
    contextRound: async () => {
      contextRounds++;
      order.push("read the repository");
      await new Promise((r) => setTimeout(r, 10));
      return "LAYOUT: one shared reading of src/";
    },
    ground: async (_d: unknown, ask: { id: string }, opts: { nextIndex: number; digestStore?: { load: (k: string) => string | undefined } }) => {
      order.push(`ground ${ask.id}`);
      // Every worker finds the reading already established.
      assert.ok(
        opts.digestStore?.load("repo@no-git"),
        "the shared reading is on disk before any ask grounds",
      );
      return {
        changes: [
          {
            id: `node-${ask.id}-${opts.nextIndex}`,
            sentence: `serves ${ask.id}`,
            serves: [ask.id],
            needs: [],
            acceptance: [],
            grounding: { touchpoints: [{ path: "src/a.ts" }], stamp: [] },
          },
        ],
        questions: [],
      };
    },
  };
  const session = new TandemSession(deps as never);
  await captureAndAccept(session, ["one", "two", "three", "four", "five", "six"]);
  assert.equal(contextRounds, 1, "six asks, one reading of the repository");
  assert.equal(order[0], "read the repository", "the reading comes first");
  assert.ok(
    order.slice(1).every((o) => o.startsWith("ground ")),
    "nothing reads the repository again once the fan-out starts",
  );
  assert.equal(order.length, 7, "one reading + six groundings");
});

test("capture proposes a model and waits; accepting it grounds every subject once", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-"));
  const grounded: { subject: string; claims: number }[] = [];
  const deps = {
    round: { model: "opus", volumeModel: "sonnet", repoRoot: "/repo" },
    storeDir: dir,
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-k-")),
    now: () => "2026-08-08T12:00:00Z",
    readCurrentStamp: async () => [],
    classify: async () => "ask" as const,
    contextRound: async () => "LAYOUT: one reading",
    // Two sentences about one thing, and one rule — the shape the round is for.
    solveModel: async () => ({
      subjects: [
        {
          name: "the delivery page",
          from: [1, 2],
          claims: [
            { text: "shows a see-it line for every promise", why: "so I accept by experiencing it", from: 1 },
            { text: "proof labels name their check", from: 2 },
          ],
        },
      ],
      rules: [{ text: "labels are in my words", scope: "every page", from: 2 }],
    }),
    ground: async (
      _d: unknown,
      ask: { id: string },
      opts: { claims?: { id: string }[]; mintNodeId?: (n: number) => string },
    ) => {
      grounded.push({ subject: ask.id, claims: opts.claims?.length ?? 0 });
      const mint = opts.mintNodeId ?? ((n: number) => `node-${n}`);
      return {
        changes: (opts.claims ?? []).map((c, i) => ({
          id: mint(i + 1),
          sentence: `promise for ${c.id}`,
          serves: [ask.id],
          servesClaim: c.id,
          needs: [],
          acceptance: [],
          grounding: { touchpoints: [{ path: "src/a.ts" }], stamp: [] },
        })),
        questions: [],
      };
    },
  };
  const session = new TandemSession(deps as never);

  await session.captureMany(["the delivery page shows how to experience it", "labels in my words"]);
  assert.equal(grounded.length, 0, "nothing is ground until the human accepts the reading");
  assert.equal(session.space.asks.length, 2, "the sentences are recorded verbatim first");
  assert.ok(session.pendingModel, "the proposal waits");

  await session.think();
  assert.equal(session.space.subjects!.length, 1, "two sentences, one subject");
  assert.equal(session.space.claims!.length, 2, "each sentence became a claim on it");
  assert.equal(session.space.rules!.length, 1, "what governs everything became a rule");
  assert.equal(grounded.length, 1, "ONE grounding for the subject, not one per sentence");
  assert.equal(grounded[0].claims, 2, "the round saw both claims at once");

  const claims = session.space.claims!;
  assert.equal(claims[0].why, "so I accept by experiencing it", "the purpose rides the claim");
  assert.equal(
    session.space.asks.find((a) => a.id === claims[0].fromAsk)!.text,
    "the delivery page shows how to experience it",
    "every claim cites the sentence it came from, kept whole",
  );
  assert.ok(
    session.space.nodes.every((n) => n.servesClaim),
    "every promise names the claim it makes true — nothing is scope creep",
  );
});

test("two subjects' claims never share an id, so a promise cannot land on another subject's claim", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-"));
  const deps = {
    round: { model: "opus", repoRoot: "/repo" },
    storeDir: dir,
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-i-")),
    now: () => "2026-08-09T10:00:00Z",
    readCurrentStamp: async () => [],
    classify: async () => "ask" as const,
    contextRound: async () => "LAYOUT: one reading",
    // Two subjects, two claims each — the shape that minted duplicates.
    solveModel: async () => ({
      subjects: [
        {
          name: "the delivery page",
          from: [1],
          claims: [{ text: "prints the reason", from: 1 }, { text: "names the check", from: 1 }],
        },
        {
          name: "the TEP",
          from: [2],
          claims: [{ text: "records the reason", from: 2 }, { text: "states the docs", from: 2 }],
        },
      ],
      rules: [],
    }),
    ground: async () => ({ changes: [], questions: [] }),
  };
  const session = new TandemSession(deps as never);
  await session.captureMany(["the delivery page prints it", "the TEP records it"]);
  await session.think();

  const ids = session.space.claims!.map((c) => c.id);
  assert.equal(new Set(ids).size, 4, `four claims, four ids: ${ids.join(", ")}`);
});

test("a rule in force reaches a subject captured later, and a no is remembered", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-"));
  let round = 0;
  const asked: string[][] = [];
  const deps = {
    round: { model: "opus", repoRoot: "/repo" },
    storeDir: dir,
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-k-")),
    now: () => "2026-08-08T13:00:00Z",
    readCurrentStamp: async () => [],
    classify: async () => "ask" as const,
    contextRound: async () => "LAYOUT: one reading",
    solveModel: async () => {
      round++;
      const named = ["the delivery page", "the cut review", "the reading list"][round - 1] ?? "another thing";
      return {
        subjects: [{ name: named, from: [1], claims: [{ text: `something about ${named}`, from: 1 }] }],
        rules:
          round === 1
            ? [{ text: "labels are in my words", scope: "every page you read", from: 1 }]
            : [],
      };
    },
    // The scope round is asked only about pairs not yet judged, and says yes
    // to pages only.
    judgeScope: async (_d: unknown, pairs: { subjectName: string }[]) => {
      asked.push(pairs.map((p) => p.subjectName));
      return pairs.filter((p) => p.subjectName.includes("page"));
    },
    ground: async (_d: unknown, ask: { id: string }, opts: { claims?: { id: string }[]; mintNodeId?: (n: number) => string }) => ({
      changes: (opts.claims ?? []).map((c, i) => ({
        id: (opts.mintNodeId ?? ((n: number) => `node-${n}`))(i + 1),
        sentence: `promise for ${c.id}`,
        serves: [ask.id],
        servesClaim: c.id,
        needs: [],
        acceptance: [],
        grounding: { touchpoints: [{ path: "src/a.ts" }], stamp: [] },
      })),
      questions: [],
    }),
  };
  const session = new TandemSession(deps as never);

  await session.captureMany(["the delivery page shows a walkthrough"]);
  await session.think();
  const rule = session.space.rules![0];
  assert.equal(rule.governs.length, 1, "the rule governs the subject it was born with");

  // A later round brings a subject the rule was never asked about.
  await session.captureMany(["the cut review lists the promises"]);
  await session.think();
  assert.deepEqual(asked.at(-1), ["the cut review"], "only the unjudged pair is asked about");
  assert.equal(
    session.space.rules![0].governs.includes(session.space.subjects![1].id),
    false,
    "a subject the scope does not cover does not inherit",
  );
  assert.ok(
    session.space.judgedScope!.some((k) => k.endsWith(session.space.subjects![1].id)),
    "the no is remembered, so the question is not asked again",
  );

  // Nothing new to judge → the round is not called a third time.
  const before = asked.length;
  await session.captureMany(["the reading list shows every repository"]);
  await session.think();
  assert.ok(asked.length > before, "a fresh subject is judged");
  assert.deepEqual(
    asked.at(-1),
    ["the reading list"],
    "only the new subject is asked about — every judged pair stays judged",
  );
});

test("a failed reading derives nothing, says why, and can be read again", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-"));
  let attempt = 0;
  const deps = {
    round: { model: "opus", repoRoot: "/repo" },
    storeDir: dir,
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-k-")),
    now: () => "2026-08-08T20:00:00Z",
    readCurrentStamp: async () => [],
    classify: async () => "ask" as const,
    contextRound: async () => "LAYOUT: one reading",
    solveModel: async (d: { log?: (l: string) => void }) => {
      attempt++;
      if (attempt === 1) {
        d.log?.("round errored: usage limit reached");
        return undefined;
      }
      return {
        subjects: [{ name: "the delivery page", from: [1], claims: [{ text: "shows a walkthrough", from: 1 }] }],
        rules: [],
      };
    },
    ground: async (_d: unknown, ask: { id: string }, opts: { claims?: { id: string }[] }) => ({
      changes: (opts.claims ?? []).map((c, i) => ({
        id: `node-${i}`,
        sentence: `promise for ${c.id}`,
        serves: [ask.id],
        servesClaim: c.id,
        needs: [],
        acceptance: [],
        grounding: { touchpoints: [{ path: "src/a.ts" }], stamp: [] },
      })),
      questions: [],
    }),
  };
  const session = new TandemSession(deps as never);

  const first = await session.captureMany(["the delivery page shows a walkthrough"]);
  assert.equal(first.ok, false, "a failed reading is a failure, not a quiet success");
  assert.equal(session.pendingModel, undefined, "nothing is proposed");
  assert.equal(session.space.subjects?.length ?? 0, 0, "NO subject is invented from a failed reading");
  assert.equal(session.space.nodes.length, 0, "and nothing is derived");
  assert.match(session.modelFailure!.reason, /usage limit reached/, "the round's own words are kept");
  assert.equal(session.space.asks.length, 1, "the human's sentence is still recorded");

  const again = await session.retryModel();
  assert.ok(again.ok, "reading again works on the sentences already recorded");
  assert.equal(session.modelFailure, undefined, "the failure clears");
  assert.equal(session.space.asks.length, 1, "and the sentence is not recorded twice");
  await session.think();
  assert.equal(session.space.subjects!.length, 1, "the second reading lands");
});

test("a second paste joins the reading that is waiting, and the reading survives a reload", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-"));
  const seen: number[] = [];
  const deps = {
    round: { model: "opus", repoRoot: "/repo" },
    storeDir: dir,
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-k-")),
    now: () => "2026-08-09T10:00:00Z",
    readCurrentStamp: async () => [],
    classify: async () => "ask" as const,
    contextRound: async () => "LAYOUT: one reading",
    solveModel: async (_d: unknown, texts: string[]) => {
      seen.push(texts.length);
      return {
        subjects: [
          { name: "the delivery page", from: texts.map((_, i) => i + 1), claims: texts.map((t, i) => ({ text: t, from: i + 1 })) },
        ],
        rules: [],
      };
    },
    ground: async () => ({ changes: [], questions: [] }),
  };
  const session = new TandemSession(deps as never);

  await session.captureMany(["first sentence", "second sentence"]);
  assert.deepEqual(seen, [2], "the first reading saw both sentences");
  assert.equal(session.pendingModel!.subjects[0].claims.length, 2);

  // A third sentence arrives while that reading is still waiting.
  await session.captureMany(["third sentence"]);
  assert.deepEqual(seen, [2, 3], "the whole set is read again — the waiting reading is not replaced");
  assert.equal(session.pendingModel!.texts.length, 3, "the reading covers every sentence");
  assert.equal(session.space.asks.length, 3, "and each sentence is recorded exactly once");

  // A fresh session over the same store still has the reading.
  const reloaded = new TandemSession(deps as never);
  assert.ok(reloaded.pendingModel, "the reading survives a reload — it is part of the record");
  assert.equal(reloaded.pendingModel!.texts.length, 3);
});

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
