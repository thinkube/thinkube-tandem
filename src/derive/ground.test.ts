/**
 * Grounded derivation's pure seams: the prompt carries the ask verbatim,
 * the parser refuses positions and marks planned files, and resolution
 * turns indices into ids with the round's stamp attached.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildGroundingPrompt,
  parseGroundedNodes,
  parseGroundedQuestions,
  resolveDerived,
} from "./ground";

const ASK = { id: "ask-1", text: "  make the log panel follow the running step  ", at: "t" };

test("the prompt carries the ask byte for byte and demands structural anchors", () => {
  const prompt = buildGroundingPrompt({ ask: ASK, repoRoot: "/repo" });
  assert.ok(prompt.includes(ASK.text), "ask verbatim, whitespace included");
  assert.ok(
    prompt.includes('"evidence"'),
    "each anchor is asked for the reading behind it — what is there, why the change lands here",
  );
  const withDigest = buildGroundingPrompt({ ask: ASK, repoRoot: "/repo", digest: "the reading" });
  assert.ok(withDigest.includes("the reading"));
});

test("the graph's answer to the ask's own words rides the prompt as a lead, not a verdict", () => {
  const graphed = "NODE LogPanel [src=src/panel/log.ts loc=L12]";
  const prompt = buildGroundingPrompt({ ask: ASK, repoRoot: "/repo", graphed });
  assert.ok(prompt.includes(graphed), "the graph's answer rides in when it has one");
  assert.ok(
    !buildGroundingPrompt({ ask: ASK, repoRoot: "/repo" }).includes(graphed),
    "and nothing is invented when it has none",
  );
});

test("a check carries its lifetime: transitions are assessments, standing behavior a probe", () => {
  const prompt = buildGroundingPrompt({ ask: ASK, repoRoot: "/repo" });
  assert.ok(prompt.includes('"assessment"'), "the transition kind is offered");
  assert.ok(
    /OBSERVES THE CODE AT A SEAM/.test(prompt) && /NEVER PERFORMS the effect/.test(prompt),
    "a check observes at a seam and never acts on the world",
  );
  assert.ok(
    /shutdown request .* fake API/.test(prompt) && /unverified \{"text":"the cluster shuts down/.test(prompt),
    "the world-effect example shows the split: seam probes, the effect a note with its reason",
  );
  const raw = JSON.stringify({
    nodes: [
      {
        sentence: "the old badge is gone",
        touchpoints: [{ path: "src/panel/log.ts" }],
        needs: [],
        acceptance: [
          { text: "the docs page states the new behavior", kind: "assessment" },
          { text: "opening the panel renders the live badge", kind: "probe" },
          { text: "a check with a made-up lifetime", kind: "forever" },
        ],
        unverified: [
          { text: "the cluster shuts down when pressed", why: "acts on the cluster this runs in" },
          { text: "an effect with no reason is not a note", why: "" },
        ],
      },
    ],
  });
  const [node] = parseGroundedNodes(raw, "/repo", () => true);
  assert.equal(node.acceptance[0].kind, "assessment", "judged once at delivery, never kept");
  assert.equal(node.acceptance[1].kind, undefined, "standing behavior is the default probe");
  assert.equal(node.acceptance[2].kind, undefined, "an unknown kind must not invent a lifetime");
  assert.deepEqual(
    node.unverified,
    [{ text: "the cluster shuts down when pressed", why: "acts on the cluster this runs in" }],
    "an effect the machine cannot verify is a note on the promise, with its reason — never a check; no reason, no note",
  );
  assert.ok(prompt.includes('"unverified"'), "the grounding is asked for the reason");
});

test("an anchor's evidence survives parsing, trimmed and bounded", () => {
  const raw = JSON.stringify({
    nodes: [
      {
        sentence: "follow the running step",
        touchpoints: [
          { path: "src/panel/log.ts", symbol: "LogPanel", evidence: "  renders the tail today; follow lands here  " },
          { path: "src/panel/other.ts", evidence: "x".repeat(400) },
          { path: "src/panel/none.ts", evidence: "   " },
        ],
        needs: [],
        acceptance: [{ text: "scrolls" }],
      },
    ],
  });
  const nodes = parseGroundedNodes(raw, "/repo", () => true);
  assert.equal(nodes[0].touchpoints[0].evidence, "renders the tail today; follow lands here");
  assert.equal(nodes[0].touchpoints[1].evidence!.length, 240, "evidence is a sentence, not a document");
  assert.equal(nodes[0].touchpoints[2].evidence, undefined, "blank evidence is no evidence");
});

test("parser: positions refused, planned files marked, indices bounded, empty dropped", () => {
  const raw = JSON.stringify({
    nodes: [
      {
        sentence: "follow the running step",
        touchpoints: [
          { path: "src/panel/log.ts", symbol: "LogPanel" },
          { path: "src/panel/log.ts:42" },
          { path: "src/panel/follow.ts" },
        ],
        needs: [1, 9, -1],
        acceptance: [{ text: "the panel scrolls as the step advances" }, { text: "  " }],
      },
      { sentence: "  ", touchpoints: [], needs: [], acceptance: [] },
      { sentence: "surface the follow toggle", touchpoints: [], needs: [0], acceptance: [{ text: "a toggle is visible" }] },
    ],
  });
  const exists = (abs: string) => abs.endsWith("log.ts");
  const nodes = parseGroundedNodes(raw, "/repo", exists);
  assert.equal(nodes.length, 2, "the empty sentence is dropped");
  assert.deepEqual(nodes[0].touchpoints, [
    { path: "src/panel/log.ts", symbol: "LogPanel" },
    { path: "src/panel/follow.ts", planned: true },
  ], "the position-carrying anchor is refused; the unborn file is planned");
  assert.deepEqual(nodes[0].needsIndices, [1], "out-of-range indices dropped");
  assert.equal(nodes[0].acceptance.length, 1);
  assert.deepEqual(parseGroundedNodes("no json", "/repo", exists), []);
});

test("questions parse: text+recommendation required; decisions ride the prompt", () => {
  const qs = parseGroundedQuestions(
    JSON.stringify({ nodes: [], questions: [
      { text: "top or side?", recommendation: "top" },
      { text: "missing rec" },
      { recommendation: "orphan" },
    ] }),
  );
  assert.deepEqual(qs, [{ text: "top or side?", recommendation: "top" }]);
  const prompt = buildGroundingPrompt({ ask: ASK, repoRoot: "/repo", decisions: ["side, collapsible"] });
  assert.ok(prompt.includes("DECISIONS IN FORCE"));
  assert.ok(prompt.includes("side, collapsible"));
  assert.ok(prompt.includes('"questions"'), "the round is asked for what the code cannot settle");
});

test("resolution: ids assigned, needs indices become ids, self-needs dropped, stamp attached", () => {
  const stamp = [{ root: "/repo", head: "abc", dirty: "" }];
  const resolved = resolveDerived(
    [
      { sentence: "a", touchpoints: [{ path: "src/a.ts" }], needsIndices: [1], acceptance: [{ text: "c" }] },
      { sentence: "b", touchpoints: [], needsIndices: [1], acceptance: [{ text: "c" }] },
    ],
    "ask-1",
    stamp,
    7,
  );
  assert.deepEqual(resolved.map((n) => n.id), ["node-7", "node-8"]);
  assert.deepEqual(resolved[0].needs, ["node-8"]);
  assert.deepEqual(resolved[1].needs, [], "a node never needs itself");
  assert.deepEqual(resolved[0].grounding?.stamp, stamp);
  assert.equal(resolved[1].grounding, undefined, "no touchpoints, no grounding claim");
  assert.deepEqual(resolved[0].serves, ["ask-1"]);
  assert.equal(resolved[0].acceptance[0].id, "node-7-check-1");
});
