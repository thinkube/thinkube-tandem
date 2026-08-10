/**
 * Reachability: every session action has a registered human door or a
 * declared machine-only reason — and the session round-trips a space
 * through capture, cut, sign, and acceptance with an injected round.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { AFFORDANCES, gestureFor } from "./affordances";
import { SESSION_ACTIONS, TandemSession } from "./session";
import { asksOfText } from "../derive/asks";

/** The three steps a person takes: write the draft, read it, keep it —
 *  then going on to the work is what grounds every subject. */
export async function captureAndAccept(session: TandemSession, texts: string[]): Promise<void> {
  await write(session, texts);
  await session.think();
}

/** Write a draft, read it, keep it — the three steps before any thinking. */
async function write(
  session: TandemSession,
  texts: string[],
): Promise<{ ok: boolean; reason?: string }> {
  session.saveDraft(texts.join("\n"));
  const read = await session.readDraft();
  if (!read.ok) return read;
  return session.keepDraft();
}

test("no capability without a door: every session action is registered", () => {
  assert.ok(SESSION_ACTIONS.length >= 14, "the gate must never go vacuous — the registry drives it");
  for (const action of SESSION_ACTIONS) {
    const entry = AFFORDANCES[action];
    assert.ok(entry, `action '${action}' has no affordance entry`);
    if (entry.kind === "human") {
      assert.ok(entry.affordance.surface.trim());
      assert.ok(entry.affordance.gesture.trim());
    } else {
      assert.ok(entry.reason.trim(), `machine-only '${action}' must state why`);
    }
  }
  assert.ok(gestureFor("build")!.includes("press Build"));
  assert.ok(gestureFor("reground")!.includes("out-of-date badge"), "re-grounding has a human door");
});

test("session round-trip: capture grounds and clusters; sign; accept only on green; persistence keeps both", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-"));
  const deps = {
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: dir,
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    name: async () => [],
    now: () => "2026-08-05T19:00:00Z",
    readCurrentStamp: async () => [],
    classify: async () => "ask" as const,
    solveModel: async (_d: unknown, texts: string[]) => ({
      subjects: texts.map((t, i) => ({ name: t, from: [i + 1], claims: [{ text: t, from: i + 1 }] })),
      rules: [],
    }),
    ground: async (_d: unknown, ask: { id: string }, opts: { nextIndex: number; decisions?: string[] }) => ({
      changes: [
        {
          id: `node-${opts.nextIndex}`,
          sentence: opts.decisions?.length
            ? `the toolbar gains a capture box (${opts.decisions[0]})`
            : "the toolbar gains a capture box",
          serves: [ask.id],
          needs: [],
          acceptance: [{ id: "c1", text: "box visible" }],
          grounding: { touchpoints: [{ path: "src/toolbar.ts" }], stamp: [] },
        },
      ],
      questions:
        opts.decisions?.length ? [] : [{ askId: ask.id, text: "top or side toolbar?", recommendation: "top" }],
    }),
  };
  const session = new TandemSession(deps as never);
  const captured = await write(session, ["I want to capture asks from the toolbar"]);
  await session.think();
  assert.ok(captured.ok);
  assert.equal(session.space.asks[0].text, "I want to capture asks from the toolbar");
  assert.equal(session.space.nodes.length, 1, "the subject grounded into one promise");
  assert.equal(session.space.subjects!.length, 1, "the sentence became one subject");

  // What the round could not decide from the sentence is an assumption,
  // never a question that blocks: it is stated, and becomes a rule at the
  // moment of building.
  assert.equal(session.space.questions.length, 1, "the round raised one");

  // The question the round raised: accept with an edited wording → a
  // decision in force, and the ask re-grounds under it immediately.
  assert.equal(session.space.questions.length, 1);
  const accepted = await session.acceptQuestion(session.space.questions[0].id, "side, collapsible");
  assert.ok(accepted.ok);
  assert.deepEqual(session.decisionsInForce(), ["side, collapsible"]);
  // TEP-22: the decision's implication is STAGED — nothing re-derives yet.
  assert.ok(
    !session.space.nodes.some((n) => n.sentence.includes("side, collapsible")),
    "definitions stay byte-identical until the human accepts the implication",
  );
  assert.equal(session.space.impacts?.length, 1, "the implication is staged");
  const applied = await session.decideImpact(session.space.impacts![0].id, true);
  assert.ok(applied.ok);
  assert.ok(
    session.space.nodes.some((n) => n.sentence.includes("side, collapsible")),
    "accepting the implication re-derives under the decision",
  );
  assert.equal((await session.acceptQuestion(session.space.questions[0].id)).ok, false, "no double decide");

  session.toggleCut(session.space.nodes.map((n) => n.id));
  assert.ok(session.cutScreen().includes("promise(s)"), "the cut screen counts the promises picked");
  assert.ok(session.signCut().ok, "signing succeeds; with no forge the run stays parked");
  assert.equal(session.space.cuts.length, 1);
  assert.ok(session.space.cuts[0].signature, "signature bound at the click");
  const tepId = session.space.cuts[0].tepId!;
  assert.match(tepId, /^TEP-user-1$/);
  assert.equal(session.tepApproval(tepId).approved, true, "the click minted a real content-bound token");
  session.space = {
    ...session.space,
    nodes: session.space.nodes.map((n) => ({ ...n, sentence: n.sentence + " (edited)" })),
  };
  const stale = session.tepApproval(tepId);
  assert.equal(stale.approved, false, "editing the signed content re-arms the gate");
  assert.equal(stale.reason, "content-mismatch");

  session.space = {
    ...session.space,
    deliveries: [
      { id: "d-1", cutId: "cut-1", branch: "tandem/cut-1", proofs: [{ kind: "suite", label: "suite", verdict: "pending" }] },
    ],
  };
  assert.equal((await session.acceptDelivery("d-1")).ok, false, "pending proof blocks");
  session.space.deliveries[0].proofs[0].verdict = "green";
  assert.ok((await session.acceptDelivery("d-1")).ok);

  const reloaded = new TandemSession(deps as never);
  assert.equal(reloaded.space.asks.length, 1, "the space survives a reload");
  assert.equal(reloaded.space.deliveries[0].acceptedAt, "2026-08-05T19:00:00Z");
});

test("accept runs the engine's canonical order: merge → stamp → retire, and a retire failure never fails the accept", async () => {
  const order: string[] = [];
  const deps = {
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    name: async () => [],
    now: () => "2026-08-06T08:00:00Z",
    readCurrentStamp: async () => [],
    classify: async () => "ask" as const,
    solveModel: async (_d: unknown, texts: string[]) => ({
      subjects: texts.map((t, i) => ({ name: t, from: [i + 1], claims: [{ text: t, from: i + 1 }] })),
      rules: [],
    }),
    forge: {
      openDelivery: async () => "https://forge/pr/1",
      merge: async () => {
        order.push("merge");
      },
    },
    retire: async () => {
      order.push("retire");
      throw new Error("worktree already gone");
    },
    ground: async () => ({ changes: [], questions: [] }),
  };
  const session = new TandemSession(deps as never);
  session.space = {
    ...session.space,
    cuts: [{ id: "cut-1", changeIds: [], tepId: "TEP-user-9" }],
    deliveries: [
      {
        id: "d-1",
        cutId: "cut-1",
        branch: "tandem/TEP-user-9",
        url: "https://forge/pr/1",
        proofs: [{ kind: "suite", label: "suite", verdict: "green" }],
      },
    ],
  };
  const r = await session.acceptDelivery("d-1");
  assert.ok(r.ok, "retire's failure is captured, not surfaced");
  order.push("end");
  assert.deepEqual(order, ["merge", "retire", "end"], "merge ran before retire");
  assert.equal(session.space.deliveries[0].acceptedAt, "2026-08-06T08:00:00Z", "stamped after merge");
});

test("a refused merge aborts the accept before any stamp", async () => {
  const deps = {
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    name: async () => [],
    now: () => "2026-08-06T08:00:00Z",
    readCurrentStamp: async () => [],
    classify: async () => "ask" as const,
    solveModel: async (_d: unknown, texts: string[]) => ({
      subjects: texts.map((t, i) => ({ name: t, from: [i + 1], claims: [{ text: t, from: i + 1 }] })),
      rules: [],
    }),
    forge: {
      openDelivery: async () => "https://forge/pr/1",
      merge: async () => {
        throw new Error("branch conflicts");
      },
    },
    ground: async () => ({ changes: [], questions: [] }),
  };
  const session = new TandemSession(deps as never);
  session.space = {
    ...session.space,
    cuts: [{ id: "cut-1", changeIds: [], tepId: "TEP-user-9" }],
    deliveries: [
      {
        id: "d-1",
        cutId: "cut-1",
        branch: "tandem/TEP-user-9",
        url: "https://forge/pr/1",
        proofs: [{ kind: "suite", label: "suite", verdict: "green" }],
      },
    ],
  };
  const r = await session.acceptDelivery("d-1");
  assert.equal(r.ok, false);
  assert.ok(r.reason!.includes("branch conflicts"));
  assert.equal(session.space.deliveries[0].acceptedAt, undefined, "never stamped");
});

test("panic clears the derived thinking, keeps the asks, and is refused after any signed TEP", async () => {
  const deps = {
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    name: async () => [],
    now: () => "t",
    readCurrentStamp: async () => [],
    classify: async () => "ask" as const,
    solveModel: async (_d: unknown, texts: string[]) => ({
      subjects: texts.map((t, i) => ({ name: t, from: [i + 1], claims: [{ text: t, from: i + 1 }] })),
      rules: [],
    }),
    ground: async (_d: unknown, ask: { id: string }, opts: { nextIndex: number }) => ({
      changes: [
        {
          id: `node-${opts.nextIndex}`,
          sentence: "a derived change",
          serves: [ask.id],
          needs: [],
          acceptance: [{ id: "c", text: "visible" }],
          grounding: { touchpoints: [{ path: "src/x.ts" }], stamp: [] },
        },
      ],
      questions: [],
    }),
  };
  const session = new TandemSession(deps as never);
  await write(session, ["something derived"]);
  await session.think();
  assert.equal(session.space.nodes.length, 1);
  const r = session.panic();
  assert.ok(r.ok);
  assert.equal(session.space.nodes.length, 0, "derived changes cleared");
  assert.equal(session.space.asks.length, 1, "the human's words survive");

  await write(session, ["again"]);
  await session.think();
  session.toggleCut(session.space.nodes.map((n) => n.id));
  assert.ok(session.signCut().ok);
  const refused = session.panic();
  assert.ok(!refused.ok && refused.reason!.includes("signed"), "a freeze makes panic refuse");
});

test("a secret-shaped ask refuses the store write and says why; the state stays live", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-"));
  const messages: string[] = [];
  const deps = {
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: dir,
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    name: async () => [],
    now: () => "t",
    readCurrentStamp: async () => [],
    classify: async () => "ask" as const,
    solveModel: async (_d: unknown, texts: string[]) => ({
      subjects: texts.map((t, i) => ({ name: t, from: [i + 1], claims: [{ text: t, from: i + 1 }] })),
      rules: [],
    }),
    onChanged: (m?: string) => {
      if (m) messages.push(m);
    },
    ground: async () => ({ changes: [], questions: [] }),
  };
  const session = new TandemSession(deps as never);
  await write(session, ["use the key AKIA" + "ABCDEFGHIJKLMNOP to talk to S3"]);
  assert.ok(
    messages.some((m) => m.includes("REFUSED to write the store") && m.includes("aws-access-key")),
    "the refusal names the leak",
  );
  assert.ok(!fs.existsSync(path.join(dir, "space.json")), "nothing secret-shaped reached disk");
  assert.equal(session.space.asks.length, 1, "the in-memory state stays live");
});

test("a list records N independent asks, each in the words as written", async () => {
  const deps = {
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    name: async () => [],
    now: () => "t",
    readCurrentStamp: async () => [],
    classify: async () => "ask" as const,
    solveModel: async (_d: unknown, texts: string[]) => ({
      subjects: texts.map((t, i) => ({ name: t, from: [i + 1], claims: [{ text: t, from: i + 1 }] })),
      rules: [],
    }),
    ground: async () => ({ changes: [], questions: [] }),
  };
  const session = new TandemSession(deps as never);
  // The surface splits what you wrote — one line, one ask — and hands the
  // host exactly the asks to record. The rule itself is covered in
  // derive/asks.test.ts; what matters here is that N in means N recorded.
  const items = asksOfText("1. add a clear button\n2. rename the toolbar\n- fix the tooltip").map(
    (a) => a.text,
  );
  assert.deepEqual(items, ["add a clear button", "rename the toolbar", "fix the tooltip"]);
  assert.equal(session.space.asks.length, 0, "nothing is recorded before it is pressed");
  await captureAndAccept(session, items);
  assert.equal(session.space.asks.length, 3, "recording keeps exactly N asks");
  assert.ok(session.space.asks.every((a, i) => a.text === items[i]));
});

test("liveness: the pipeline's stages surface as activity tied to the subject being grounded", async () => {
  const stages: string[] = [];
  const deps = {
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    name: async () => [],
    now: () => "t",
    readCurrentStamp: async () => [],
    classify: async () => "ask" as const,
    solveModel: async (_d: unknown, texts: string[]) => ({
      subjects: texts.map((t, i) => ({ name: t, from: [i + 1], claims: [{ text: t, from: i + 1 }] })),
      rules: [],
    }),
    ground: async (
      _d: unknown,
      ask: { id: string },
      opts: { onStage?: (l: string, i: number, n: number) => void },
    ) => {
      opts.onStage?.("reading your code", 1, 7);
      opts.onStage?.("deriving the changes", 2, 7);
      return { changes: [], questions: [] };
    },
    onChanged: () => {
      const s = (session as unknown as { activity?: { label: string; askId?: string } }).activity;
      if (s) stages.push(`${s.label}@${s.askId}`);
    },
  };
  const session = new TandemSession(deps as never);
  await write(session, ["build the thing"]);
  await session.think();
  assert.ok(
    stages.some((x) => x.startsWith("reading your code@subject-")),
    "stage 1 surfaced against the subject being ground",
  );
  assert.ok(stages.some((x) => x.startsWith("deriving the changes@")), "stage 2 surfaced");
  assert.equal(session.activity, undefined, "activity clears when the pipeline ends");
});
