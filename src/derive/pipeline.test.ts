/**
 * The derivation pipeline over a scripted round runner: contextualize
 * establishes and persists a digest that grounding builds on; gap-close and
 * impact add real changes; intent coverage and the challenger raise
 * questions with recommendations; the assessment round sharpens vague
 * criteria in place. Fail-soft is pinned: a dead round skips its
 * enrichment, never the pipeline.
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

function memStore(): DigestStore & { saved: Record<string, string> } {
  const saved: Record<string, string> = {};
  return {
    saved,
    load: (id) => saved[id],
    save: (id, text) => {
      saved[id] = text;
    },
  };
}

const NODE = (sentence: string, file: string) =>
  `{"sentence":"${sentence}","touchpoints":[{"path":"${file}"}],"needs":[],"acceptance":[{"text":"${sentence} is visible"}]}`;

function scriptedRounds(script: { match: RegExp; reply: string | null }[], calls: string[]) {
  return async (_deps: RoundDeps, prompt: string): Promise<string | null> => {
    calls.push(prompt);
    const hit = script.find((s) => s.match.test(prompt));
    assert.ok(hit, `no scripted reply for prompt starting: ${prompt.slice(0, 60)}`);
    return hit!.reply;
  };
}

test("the pipeline runs all rounds in order: digest → ground → gap-close → impact → coverage → assessment → challenger", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-pipe-"));
  const deps: RoundDeps = { model: "opus", repoRoot };
  const store = memStore();
  const calls: string[] = [];
  const round = scriptedRounds(
    [
      { match: /CONTEXT DIGEST/, reply: "WHAT EXISTS: the toolbar renders in src/toolbar.ts" },
      { match: /grounding ONE ask/, reply: `{"nodes":[${NODE("the capture box", "src/toolbar.ts")}],"questions":[]}` },
      { match: /GAP-CLOSE judge/, reply: `{"complete":false,"nodes":[${NODE("the clear button", "src/toolbar.ts")}]}` },
      { match: /IMPACT pass/, reply: `{"nodes":[${NODE("the toolbar test updates", "src/toolbar.test.ts")}]}` },
      {
        match: /INTENT-COVERAGE/,
        reply: `{"uncovered":[{"clause":"a clear button","question":{"text":"should clear also reset history?","recommendation":"no — clear empties the box only"}}]}`,
      },
      {
        match: /ACCEPTANCE ASSESSMENT/,
        reply: `{"rewrites":[{"node":0,"criterion":0,"verdict":"vague","text":"typing in the box and pressing Enter adds an ask"}]}`,
      },
      {
        match: /CHALLENGER/,
        reply: `{"questions":[{"text":"the capture box contradicts the decision to keep the toolbar read-only","recommendation":"drop the read-only decision"}]}`,
      },
    ],
    calls,
  );

  const r = await runDerivationPipeline(deps, ask, {
    nextIndex: 1,
    decisions: ["the toolbar stays read-only"],
    digestStore: store,
    round,
  });

  assert.equal(calls.length, 7, "all seven rounds ran");
  assert.ok(calls[1].includes("the toolbar renders in src/toolbar.ts"), "grounding builds on the digest");
  assert.equal(store.saved["ask-1"], "WHAT EXISTS: the toolbar renders in src/toolbar.ts", "digest persisted per ask");

  assert.equal(r.changes.length, 3, "ground + gap-close + impact changes all landed");
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

test("a stored digest is reused — contextualize does not run again", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-pipe-"));
  const deps: RoundDeps = { model: "opus", repoRoot };
  const store = memStore();
  store.saved["ask-1"] = "WHAT EXISTS: established reading";
  const calls: string[] = [];
  const round = scriptedRounds(
    [
      { match: /grounding ONE ask/, reply: `{"nodes":[${NODE("the capture box", "src/toolbar.ts")}],"questions":[]}` },
      { match: /GAP-CLOSE judge/, reply: `{"complete":true,"nodes":[]}` },
      { match: /IMPACT pass/, reply: `{"nodes":[]}` },
      { match: /INTENT-COVERAGE/, reply: `{"uncovered":[]}` },
      { match: /ACCEPTANCE ASSESSMENT/, reply: `{"rewrites":[]}` },
    ],
    calls,
  );
  const r = await runDerivationPipeline(deps, ask, { nextIndex: 1, digestStore: store, round });
  assert.ok(!calls.some((c) => c.includes("CONTEXT DIGEST")), "no contextualize round");
  assert.ok(calls[0].includes("established reading"), "the stored digest rides grounding");
  assert.equal(r.changes.length, 1);
  assert.equal(r.questions.length, 0);
  assert.ok(!calls.some((c) => c.includes("CHALLENGER")), "no decisions → no challenger round");
});

test("fail-soft: dead rounds after grounding skip their enrichment, never the pipeline", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-pipe-"));
  const deps: RoundDeps = { model: "opus", repoRoot };
  const calls: string[] = [];
  const round = scriptedRounds(
    [
      { match: /CONTEXT DIGEST/, reply: null },
      { match: /grounding ONE ask/, reply: `{"nodes":[${NODE("the capture box", "src/toolbar.ts")}],"questions":[]}` },
      { match: /GAP-CLOSE judge/, reply: null },
      { match: /IMPACT pass/, reply: null },
      { match: /INTENT-COVERAGE/, reply: null },
      { match: /ACCEPTANCE ASSESSMENT/, reply: null },
    ],
    calls,
  );
  const r = await runDerivationPipeline(deps, ask, { nextIndex: 1, round });
  assert.equal(r.changes.length, 1, "grounding's result survives every dead round");
  assert.equal(r.questions.length, 0);
});

test("contextualize bounds the digest and refuses emptiness", async () => {
  const repoRoot = "/repo";
  const long = "x".repeat(DIGEST_CHAR_BUDGET + 500);
  const digest = await runContextualize({ model: "opus", repoRoot }, ask, async () => long);
  assert.equal(digest!.length, DIGEST_CHAR_BUDGET, "over-budget digests are clipped");
  const empty = await runContextualize({ model: "opus", repoRoot }, ask, async () => "   ");
  assert.equal(empty, null, "an empty reading is no reading");
  const prompt = buildContextualizePrompt(ask, repoRoot);
  assert.ok(prompt.includes(ask.text), "the ask rides the prompt verbatim");
  assert.ok(prompt.includes("citing its source path"), "citations are demanded");
});
