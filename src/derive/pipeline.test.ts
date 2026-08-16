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

import { completeCut, runDerivationPipeline, DigestStore } from "./pipeline";
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

test("the pipeline runs its four rounds in order: the reading → ground → completeness → tail", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-pipe-"));
  const deps: RoundDeps = { model: "opus", volumeModel: "sonnet", repoRoot };
  const store = memStore();
  const calls: string[] = [];
  const seenDeps: RoundDeps[] = [];
  const round = scriptedRounds(
    [
      { match: /STRUCTURAL MAP/, reply: "CONVENTIONS: tests sit beside the code" },
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
  assert.ok(
    calls[0].includes("STRUCTURAL MAP") && calls[0].includes("Do not re-derive it"),
    "the reading builds on the map instead of searching for structure",
  );
  assert.ok(!calls[0].includes(ask.text), "no ask leaks into the shared digest");
  assert.ok(
    calls[1].includes("CONVENTIONS: tests sit beside the code"),
    "grounding builds on the reading",
  );
  assert.ok(calls[2].includes("CONVENTIONS: tests sit beside the code"), "completeness starts warm on the reading");
  assert.equal(
    store.saved[REPO_KEY],
    "CONVENTIONS: tests sit beside the code",
    "the reading is cached under the repo stamp",
  );

  assert.equal(seenDeps[3].tools, "none", "the tail runs without tools");
  assert.equal(
    seenDeps[3].maxTurns,
    undefined,
    "the tail carries no turn cap — with no tools there is nothing to loop on, and one turn killed rounds mid-answer",
  );
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
  assert.ok(!calls.some((c) => c.includes("STRUCTURAL MAP")), "no reading round");
  assert.ok(calls[0].includes("established reading"), "the shared digest rides grounding");
  assert.equal(r.changes.length, 1);
  assert.equal(r.questions.length, 0);
});

test("parallel pipelines that miss the cache share ONE reading round (single-flight)", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-pipe-"));
  const deps: RoundDeps = { model: "opus", repoRoot };
  const store = memStore();
  let digestRounds = 0;
  const round = async (_d: RoundDeps, prompt: string): Promise<string | null> => {
    if (/STRUCTURAL MAP/.test(prompt)) {
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
      { match: /STRUCTURAL MAP/, reply: null },
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

test("the reading on top of the map is bounded, refuses emptiness, and never re-derives structure", async () => {
  const long = "x".repeat(DIGEST_CHAR_BUDGET + 500);
  const digest = await runContextualize({ model: "opus", repoRoot: "/repo" }, async () => long);
  assert.equal(digest!.length, DIGEST_CHAR_BUDGET, "over-budget digests are clipped");
  const empty = await runContextualize({ model: "opus", repoRoot: "/repo" }, async () => "   ");
  assert.equal(empty, null, "an empty reading is no reading");
  const prompt = buildContextualizePrompt("/repo", "NODE dispatchTep() [src=src/run/dispatch.ts loc=L166]");
  assert.ok(prompt.includes("dispatchTep()"), "the map it must build on rides the prompt");
  assert.ok(prompt.includes("Do not re-derive it"), "structure is fact, not something to search for");
  assert.ok(prompt.includes("CONVENTIONS"), "it is asked for what the map cannot hold");
  assert.ok(prompt.includes("WHY"), "including the reasons only comments carry");
  assert.ok(prompt.includes("repo-relative path"), "citations are demanded");
});

test("every round attributes: the gaps and ripples name a claim, and one that does not is named", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-attr-"));
  const deps: RoundDeps = { model: "opus", volumeModel: "sonnet", repoRoot };
  const calls: string[] = [];
  const said: string[] = [];
  const round = scriptedRounds(
    [
      { match: /STRUCTURAL MAP/, reply: "CONVENTIONS: tests sit beside the code" },
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
      // The machine repairs its own attribution: it places the first
      // loose promise and admits it cannot place the second.
      { match: /Say which claim each promise makes true/, reply: `{"attach":[{"promise":1,"claim":1}]}` },
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
    "claim-x-1",
    "the machine repairs its own attribution rather than handing the human a dropdown",
  );
  assert.ok(
    said.some((l) => /attribution: 1 of 1/.test(l)),
    `the repair is stated: ${said.join(" | ")}`,
  );
});

test("a question in the machine's own words never reaches the human — it becomes a stated assumption", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-voice-"));
  const deps: RoundDeps = { model: "opus", volumeModel: "sonnet", repoRoot };
  const calls: string[] = [];
  const said: string[] = [];
  // Verbatim from the round-1 run: both questions the tail actually raised.
  const tail = JSON.stringify({
    uncovered: [
      {
        clause: "the TEP text appears once",
        question: {
          text: "Which heading carries it? Dropping specBody flips the engine's hasCtx branch in src/engine/core/preflight.ts.",
          recommendation: "Keep the intent heading and drop specBody.",
        },
      },
      {
        clause: "documentation",
        question: {
          text: "Does a cut that changes nothing a person can see still need documentation?",
          recommendation: "No, when you say so with a reason.",
        },
      },
    ],
    verdicts: [],
    rewrites: [],
  });
  const round = scriptedRounds(
    [
      { match: /STRUCTURAL MAP/, reply: "CONVENTIONS: tests sit beside the code" },
      {
        match: /grounding ONE ask/,
        reply: `{"nodes":[{"sentence":"the brief carries it once","claim":1,"touchpoints":[{"path":"src/a.ts"}],"needs":[],"acceptance":[{"text":"once"}]}],"questions":[]}`,
      },
      { match: /COMPLETENESS round/, reply: `{"nodes":[]}` },
      { match: /THREE checks/, reply: tail },
    ],
    calls,
  );
  const out = await runDerivationPipeline({ ...deps, log: (l) => said.push(l) }, ask, {
    nextIndex: 1,
    claims: [{ id: "claim-y-1", text: "the brief carries the TEP text exactly once" }],
    round,
  });

  assert.equal(out.questions.length, 1, "only the one written in the human's world survives");
  assert.match(out.questions[0].text, /nothing a person can see/);
  assert.ok(
    said.some((l) => /my words, not yours/.test(l) && /preflight|specBody|hasCtx/.test(l)),
    `the refusal names the machine's own words: ${said.join(" | ")}`,
  );
});

test("the gaps are looked for ONCE over the whole cut, and land under the claim they serve", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-cut-"));
  const deps: RoundDeps = { model: "opus", volumeModel: "sonnet", repoRoot };
  const calls: string[] = [];
  const said: string[] = [];
  const round = scriptedRounds(
    [
      {
        match: /COMPLETENESS round/,
        // Two ripples: one for each subject, plus one it cannot place.
        reply: `{"nodes":[
          {"sentence":"the documentation page stops describing the old badge","claim":2,"touchpoints":[{"path":"docs/the-space.adoc"}],"needs":[],"acceptance":[{"text":"reworded"}]},
          {"sentence":"the callers of the delivery renderer move","claim":1,"touchpoints":[{"path":"src/panel.ts"}],"needs":[],"acceptance":[{"text":"moved"}]},
          {"sentence":"something nobody asked for","touchpoints":[{"path":"src/x.ts"}],"needs":[],"acceptance":[{"text":"?"}]}]}`,
      },
    ],
    calls,
  );

  const gaps = await completeCut(
    { ...deps, log: (l) => said.push(l) },
    {
      claims: [
        { id: "claim-1", subjectId: "sub-1", text: "shows a see-it line" },
        { id: "claim-2", subjectId: "sub-2", text: "re-reads only that card" },
      ],
      subjects: [
        { id: "sub-1", name: "the delivery page" },
        { id: "sub-2", name: "the out-of-date badge" },
      ],
      changes: [
        {
          id: "n1",
          sentence: "the page renders a walkthrough",
          serves: ["sub-1"],
          needs: [],
          servesClaim: "claim-1",
          acceptance: [],
        },
      ],
      mintNodeId: (n) => `node-gap-${n}`,
      nextIndex: 1,
    },
    round,
  );

  assert.equal(calls.length, 1, "ONE round for the whole cut, not one per subject");
  const prompt = calls[0];
  assert.match(prompt, /the delivery page — shows a see-it line/);
  assert.match(prompt, /the out-of-date badge — re-reads only that card/);

  assert.equal(gaps.length, 2, "what it could place");
  const doc = gaps.find((g) => g.sentence.startsWith("the documentation"))!;
  assert.equal(doc.servesClaim, "claim-2");
  assert.deepEqual(
    doc.serves,
    ["sub-2"],
    "a ripple lands under the subject whose claim it serves — not under whoever happened to derive it",
  );
  const caller = gaps.find((g) => g.sentence.startsWith("the callers"))!;
  assert.deepEqual(caller.serves, ["sub-1"]);
  assert.ok(
    said.some((l) => /dropped .* it named no claim/.test(l)),
    `what it could not place is dropped and said: ${said.join(" | ")}`,
  );
});

test("completeness receives what earlier steps learned, consumably: evidence, quoted anchors, decisions", async () => {
  // The fixture repo is Python on purpose: quoting is line slicing and
  // literal symbol match, never an idea of what a declaration looks like.
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-consume-"));
  fs.mkdirSync(path.join(repoRoot, "app"));
  fs.writeFileSync(
    path.join(repoRoot, "app", "billing.py"),
    "def charge(order):\n    return order.total\n",
  );
  const deps: RoundDeps = { model: "opus", volumeModel: "sonnet", repoRoot };
  const calls: string[] = [];
  const round = scriptedRounds([{ match: /COMPLETENESS round/, reply: `{"nodes":[]}` }], calls);

  await completeCut(
    deps,
    {
      claims: [{ id: "claim-1", subjectId: "sub-1", text: "refunds are possible" }],
      subjects: [{ id: "sub-1", name: "billing" }],
      changes: [
        {
          id: "n1",
          sentence: "charge learns to refund",
          serves: ["sub-1"],
          needs: [],
          servesClaim: "claim-1",
          grounding: {
            touchpoints: [
              { path: "app/billing.py", symbol: "charge" },
              { path: "app/refunds.py", symbol: "refund", planned: true, evidence: "new module; the ask names refunds as their own surface" },
            ],
            stamp: [],
          },
          acceptance: [{ id: "a1", text: "a refund lands" }],
        },
      ],
      decisions: ["refunds never touch the ledger directly"],
      affected: "- checkout() [calls] app/billing.py:L1\n    > def charge(order):",
      mintNodeId: (n) => `node-gap-${n}`,
      nextIndex: 1,
    },
    round,
  );

  const prompt = calls[0];
  assert.ok(
    prompt.includes("app/billing.py › charge — now reads: def charge(order):"),
    "an anchor without evidence gains its literal source line, host-quoted",
  );
  assert.ok(
    prompt.includes("the ask names refunds as their own surface"),
    "the grounding round's own reading survives into the next step",
  );
  assert.ok(prompt.includes("DECISIONS IN FORCE"), "settled answers bound what counts as a gap");
  assert.ok(prompt.includes("refunds never touch the ledger directly"));
  assert.ok(
    prompt.includes("Sweep these families ONE BY ONE") &&
      prompt.includes("DOCUMENTATION") &&
      prompt.includes("EXISTING TESTS") &&
      prompt.includes("DERIVED COPIES") &&
      prompt.includes("ONE RULE, MANY READERS") &&
      prompt.includes("LIFECYCLE"),
    "the miss families are swept by name — a skipped family was the recurring failure",
  );
  assert.ok(
    prompt.includes("> def charge(order):"),
    "the affected list carries its quoted lines — judged, not re-read",
  );
  assert.ok(
    prompt.includes('"kind"') && prompt.includes('"assessment"') && prompt.includes('"probe"'),
    "and the lifetime vocabulary the parser reads is offered for every new check",
  );
});


test("the graph is asked with the ask's own words, and its answer reaches grounding", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ask-"));
  const deps: RoundDeps = { model: "opus", volumeModel: "sonnet", repoRoot };
  const calls: string[] = [];
  const asked: string[] = [];
  const round = scriptedRounds(
    [
      { match: /grounding ONE ask/, reply: `{"nodes":[],"questions":[]}` },
    ],
    calls,
  );
  await runDerivationPipeline(deps, ask, {
    nextIndex: 1,
    round,
    knowledge: {
      repoRoot,
      graph: { graphPath: "/nowhere/graph.json", stamp: { root: repoRoot, head: "h", dirty: "" } },
      map: "NODE toolbar [src=src/toolbar.ts loc=L1]",
      digest: "CONVENTIONS: none",
      provision: "", prepare: "", resetup: async () => ({ provision: "", prepare: "", resetup: async () => ({ provision: "", prepare: "" }) }),
      decisions: [],
      ask: async (q) => {
        asked.push(q);
        return "NODE captureBox() [src=src/toolbar.ts loc=L40]";
      },
      affected: async () => "",
    },
  });
  assert.deepEqual(asked, [ask.text], "the query IS the ask's words — nothing paraphrased");
  assert.ok(
    calls[0].includes("NODE captureBox() [src=src/toolbar.ts loc=L40]"),
    "the graph's answer rides the grounding prompt",
  );
});

test("a round that derived nothing still cannot speak to the human in my words", () => {
  // The early return used to hand the human whatever the round raised,
  // around the gate entirely.
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-empty-"));
  const deps: RoundDeps = { model: "opus", volumeModel: "sonnet", repoRoot };
  const calls: string[] = [];
  const round = scriptedRounds(
    [
      { match: /STRUCTURAL MAP/, reply: "CONVENTIONS: tests sit beside the code" },
      {
        match: /grounding ONE ask/,
        reply: `{"nodes":[],"questions":[
          {"text":"Should the digest be re-read on every touchpoint?","recommendation":"no"},
          {"text":"Should a page with nothing on it still be shown?","recommendation":"yes, and say so"}]}`,
      },
    ],
    calls,
  );
  return runDerivationPipeline(deps, ask, { nextIndex: 1, round }).then((out) => {
    assert.equal(out.changes.length, 0);
    assert.equal(out.questions.length, 1, "only the one in the human's world survives");
    assert.match(out.questions[0].text, /nothing on it/);
  });
});
