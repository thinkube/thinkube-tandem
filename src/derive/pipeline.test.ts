/**
 * The consolidated pipeline over a scripted round runner: ONE repository
 * digest (stamp-cached, shared across asks and single-flighted across
 * parallel pipelines) feeds grounding; the completeness round adds gaps
 * and affected code in one pass; the tail answers coverage, criteria and
 * challenger in one tool-less volume call. Fail-soft is pinned: a dead
 * round skips its enrichment, never the pipeline.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { runDerivationPipeline, DigestStore } from "./pipeline";
import { buildContextualizePrompt, DIGEST_CHAR_BUDGET, runContextualize } from "./contextualize";
import { RoundDeps } from "./round";
import { Ask } from "../core/schema";

const ask: Ask = { id: "ask-1", text: "the toolbar gains a capture box and a clear button", at: "t" };

/** Non-git temp dirs stamp to an empty head — the shared digest key. */
const REPO_KEY = "repo@no-git";

function memStore(): DigestStore & { saved: Record<string, string> } {
  const saved: Record<string, string> = {};
  return {
    saved,
    load: (key) => saved[key],
    save: (key, text) => {
      saved[key] = text;
    },
  };
}

const NODE = (sentence: string, file: string) =>
  `{"sentence":"${sentence}","touchpoints":[{"path":"${file}"}],"needs":[],"acceptance":[{"text":"${sentence} is visible"}]}`;

function scriptedRounds(
  script: { match: RegExp; reply: string | null }[],
  calls: string[],
  seenDeps?: RoundDeps[],
) {
  return async (deps: RoundDeps, prompt: string): Promise<string | null> => {
    calls.push(prompt);
    seenDeps?.push(deps);
    const hit = script.find((s) => s.match.test(prompt));
    assert.ok(hit, `no scripted reply for prompt starting: ${prompt.slice(0, 60)}`);
    return hit!.reply;
  };
}

test("the pipeline runs its four rounds in order: repo digest → ground → completeness → tail", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-pipe-"));
  const deps: RoundDeps = { model: "opus", volumeModel: "sonnet", repoRoot };
  const store = memStore();
  const calls: string[] = [];
  const seenDeps: RoundDeps[] = [];
  const round = scriptedRounds(
    [
      { match: /producing a REPOSITORY DIGEST/, reply: "LAYOUT: the toolbar renders in src/toolbar.ts" },
      { match: /grounding ONE ask/, reply: `{"nodes":[${NODE("the capture box", "src/toolbar.ts")}],"questions":[]}` },
      {
        match: /COMPLETENESS round/,
        reply: `{"nodes":[${NODE("the clear button", "src/toolbar.ts")},${NODE("the toolbar test updates", "src/toolbar.test.ts")}]}`,
      },
      {
        match: /THREE checks/,
        reply:
          `{"uncovered":[{"clause":"a clear button","question":{"text":"should clear also reset history?","recommendation":"no — clear empties the box only"}}],` +
          `"rewrites":[{"node":0,"criterion":0,"verdict":"vague","text":"typing in the box and pressing Enter adds an ask"}],` +
          `"questions":[{"text":"the capture box contradicts the decision to keep the toolbar read-only","recommendation":"drop the read-only decision"}]}`,
      },
    ],
    calls,
    seenDeps,
  );

  const r = await runDerivationPipeline(deps, ask, {
    nextIndex: 1,
    decisions: ["the toolbar stays read-only"],
    digestStore: store,
    round,
  });

  assert.equal(calls.length, 4, "four rounds — never seven");
  assert.ok(calls[0].includes("REUSED by many later derivations"), "the digest reads the repo, not one ask");
  assert.ok(!calls[0].includes(ask.text), "no ask leaks into the shared digest");
  assert.ok(calls[1].includes("the toolbar renders in src/toolbar.ts"), "grounding builds on the digest");
  assert.ok(calls[2].includes("the toolbar renders in src/toolbar.ts"), "completeness starts warm on the digest");
  assert.equal(store.saved[REPO_KEY], "LAYOUT: the toolbar renders in src/toolbar.ts", "digest cached under the repo stamp");

  assert.equal(seenDeps[3].tools, "none", "the tail runs without tools");
  assert.equal(seenDeps[3].maxTurns, 1, "the tail is a single completion");
  assert.equal(seenDeps[3].model, "sonnet", "the tail rides the volume model");
  assert.equal(seenDeps[1].model, "opus", "grounding keeps the judgment model");

  assert.equal(r.changes.length, 3, "ground + completeness changes all landed");
  assert.deepEqual(
    r.changes.map((c) => c.id),
    ["node-1", "node-2", "node-3"],
    "ids stay sequential across rounds",
  );
  assert.equal(
    r.changes[0].acceptance[0].text,
    "typing in the box and pressing Enter adds an ask",
    "the vague criterion came back observable",
  );
  assert.equal(r.questions.length, 2, "coverage + challenger questions");
  assert.ok(r.questions[0].text.startsWith('Uncovered: "a clear button"'));
  assert.ok(r.questions.every((q) => q.recommendation), "every question carries a recommendation");
});

test("a cached repository digest is shared: the second ask never re-reads the repo", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-pipe-"));
  const deps: RoundDeps = { model: "opus", repoRoot };
  const store = memStore();
  store.saved[REPO_KEY] = "LAYOUT: established reading";
  const calls: string[] = [];
  const round = scriptedRounds(
    [
      { match: /grounding ONE ask/, reply: `{"nodes":[${NODE("the capture box", "src/toolbar.ts")}],"questions":[]}` },
      { match: /COMPLETENESS round/, reply: `{"nodes":[]}` },
      { match: /THREE checks/, reply: `{"uncovered":[],"rewrites":[],"questions":[]}` },
    ],
    calls,
  );
  const other: Ask = { id: "ask-2", text: "a persisted retrievable log", at: "t" };
  const r = await runDerivationPipeline(deps, other, { nextIndex: 1, digestStore: store, round });
  assert.ok(!calls.some((c) => c.includes("producing a REPOSITORY DIGEST")), "no contextualize round");
  assert.ok(calls[0].includes("established reading"), "the shared digest rides grounding");
  assert.equal(r.changes.length, 1);
  assert.equal(r.questions.length, 0);
});

test("parallel pipelines that miss the cache share ONE contextualize round (single-flight)", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-pipe-"));
  const deps: RoundDeps = { model: "opus", repoRoot };
  const store = memStore();
  let digestRounds = 0;
  const round = async (_d: RoundDeps, prompt: string): Promise<string | null> => {
    if (/producing a REPOSITORY DIGEST/.test(prompt)) {
      digestRounds++;
      await new Promise((r) => setTimeout(r, 20));
      return "LAYOUT: one shared reading";
    }
    if (/grounding ONE ask/.test(prompt))
      return `{"nodes":[${NODE("a thing", "src/a.ts")}],"questions":[]}`;
    if (/COMPLETENESS round/.test(prompt)) return `{"nodes":[]}`;
    return `{"uncovered":[],"rewrites":[],"questions":[]}`;
  };
  const asks: Ask[] = [1, 2, 3].map((i) => ({ id: `ask-${i}`, text: `thing ${i}`, at: "t" }));
  await Promise.all(
    asks.map((a) => runDerivationPipeline(deps, a, { nextIndex: 1, digestStore: store, round })),
  );
  assert.equal(digestRounds, 1, "three parallel asks, one repository reading");
  assert.equal(store.saved[REPO_KEY], "LAYOUT: one shared reading");
});

test("fail-soft: dead rounds after grounding skip their enrichment, never the pipeline", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-pipe-"));
  const deps: RoundDeps = { model: "opus", repoRoot };
  const calls: string[] = [];
  const round = scriptedRounds(
    [
      { match: /producing a REPOSITORY DIGEST/, reply: null },
      { match: /grounding ONE ask/, reply: `{"nodes":[${NODE("the capture box", "src/toolbar.ts")}],"questions":[]}` },
      { match: /COMPLETENESS round/, reply: null },
      { match: /THREE checks/, reply: null },
    ],
    calls,
  );
  const r = await runDerivationPipeline(deps, ask, { nextIndex: 1, round });
  assert.equal(r.changes.length, 1, "grounding's result survives every dead round");
  assert.equal(r.questions.length, 0);
});

test("contextualize bounds the digest, refuses emptiness, and asks for the whole repository", async () => {
  const long = "x".repeat(DIGEST_CHAR_BUDGET + 500);
  const digest = await runContextualize({ model: "opus", repoRoot: "/repo" }, async () => long);
  assert.equal(digest!.length, DIGEST_CHAR_BUDGET, "over-budget digests are clipped");
  const empty = await runContextualize({ model: "opus", repoRoot: "/repo" }, async () => "   ");
  assert.equal(empty, null, "an empty reading is no reading");
  const prompt = buildContextualizePrompt("/repo");
  assert.ok(prompt.includes("whole repository"), "the digest reads the repository, not an ask");
  assert.ok(prompt.includes("citing its source path"), "citations are demanded");
});

test("every round attributes: the gaps and ripples name a claim, and one that does not is named", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-attr-"));
  const deps: RoundDeps = { model: "opus", volumeModel: "sonnet", repoRoot };
  const calls: string[] = [];
  const said: string[] = [];
  const round = scriptedRounds(
    [
      { match: /producing a REPOSITORY DIGEST/, reply: "LAYOUT: one reading" },
      {
        match: /grounding ONE ask/,
        reply: `{"nodes":[{"sentence":"the page prints it","claim":1,"touchpoints":[{"path":"src/a.ts"}],"needs":[],"acceptance":[{"text":"printed"}]}],"questions":[]}`,
      },
      {
        // The completeness round finds a ripple AND forgets to attribute one.
        match: /COMPLETENESS round/,
        reply: `{"nodes":[{"sentence":"the docs stop saying the old thing","claim":2,"touchpoints":[{"path":"docs/a.md"}],"needs":[],"acceptance":[{"text":"reworded"}]},{"sentence":"a probe watches the brief","touchpoints":[{"path":"src/b.ts"}],"needs":[],"acceptance":[{"text":"probed"}]}]}`,
      },
      { match: /THREE checks/, reply: `{"uncovered":[],"verdicts":[],"rewrites":[]}` },
    ],
    calls,
  );
  const claims = [
    { id: "claim-x-1", text: "prints the reason" },
    { id: "claim-x-2", text: "the docs match" },
  ];
  const out = await runDerivationPipeline({ ...deps, log: (l) => said.push(l) }, ask, {
    nextIndex: 1,
    claims,
    round,
  });

  const completeness = calls.find((c) => /COMPLETENESS round/.test(c))!;
  assert.match(completeness, /1\. prints the reason/, "the gap round is given the claims");
  assert.match(completeness, /"claim":1/, "and is told to name one on every node");

  const ripple = out.changes.find((c) => c.sentence.startsWith("the docs"))!;
  assert.equal(ripple.servesClaim, "claim-x-2", "a ripple serves the claim it names");
  const loose = out.changes.find((c) => c.sentence.startsWith("a probe"))!;
  assert.equal(
    loose.servesClaim,
    undefined,
    "a promise that named no claim is NOT attached to one — not even when there is an obvious candidate",
  );
  assert.ok(
    said.some((l) => /named no claim/.test(l)),
    "and the round says so instead of leaving it silent",
  );
});
