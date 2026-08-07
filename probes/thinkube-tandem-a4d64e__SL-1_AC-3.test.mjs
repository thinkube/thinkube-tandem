// SL-1 AC-3 (TEP-tkadmin-1 / SP / SL-1):
// "dispatchScopePlan passes the adapter's per-probe check words into the
//  dispatch call for every scope, including the anchor scope."
//
// TRANSITION: today dispatchScopePlan calls `dispatch(dispatchDeps, space,
// cut, slices)` — no check-words ever reach the dispatch call, so a red
// run's proof labels can only ever fall back to a bare "AC-<n>" ordinal.
// This test proves that changes once dispatchScopePlan is made to forward
// the adapter's per-probe check-words mapping into every dispatch call it
// issues, anchor scope and member scopes alike. Its job is done — and this
// test can retire — the day the closing gate itself reads labels off proofs
// instead of ordinals (a later change in this same TEP); until then it is
// the seam-level proof that the words are even reaching the call.
import { test } from "node:test";
import assert from "node:assert/strict";

import { dispatchScopePlan } from "../src/dispatch/scopeRun.js";
import { planScopes } from "../src/dispatch/scopes.js";
import { RunState } from "../src/run/state.js";
import { emptySpace } from "../src/core/schema.js";
import { addAsk, addNode } from "../src/core/intent.js";

// Two-scope space: one change anchors (no scope), one change belongs to
// member scope "member-x1" — same shape as the existing multirepo fixture
// in src/run/multiscope.test.ts, so the scope-planning half is uncontested.
function twoScopeSpace() {
  let s = emptySpace();
  const a = addAsk(s, "the shared type and its consumer", "t");
  assert.ok(a.ok);
  s = a.space;
  const n1 = addNode(s, {
    sentence: "the shared greeting module",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "greet() returns 'hello'" }],
    grounding: { touchpoints: [{ path: "src/greet.mjs", planned: true }], stamp: [] },
  });
  assert.ok(n1.ok);
  s = n1.space;
  const n2 = addNode(s, {
    sentence: "the member consumer module",
    serves: [a.added.id],
    needs: [n1.added.id],
    acceptance: [{ id: "c2", text: "consume() returns 'ok'" }],
    grounding: {
      touchpoints: [{ path: "src/consume.mjs", planned: true, scope: "member-x1" }],
      stamp: [],
    },
  });
  assert.ok(n2.ok);
  s = n2.space;
  return { space: s, cut: { id: "cut-1", changeIds: [n1.added.id, n2.added.id], tepId: "TEP-t-1" } };
}

test("dispatchScopePlan forwards per-probe check words to the dispatch call for the anchor scope", async () => {
  const { space, cut } = twoScopeSpace();
  const plan = planScopes(space, cut);
  assert.ok(plan.ok, `scope plan: ${JSON.stringify(plan)}`);

  const calls = [];
  const deps = {
    round: { model: "sonnet", repoRoot: "/anchor-repo" },
    storeDir: "/tmp/store",
    storageDir: "/tmp/keys",
    now: () => new Date().toISOString(),
    scope: { gitRoot: "/anchor-repo", prefix: "", projectId: "proj-1", label: "P" },
    resolveScope: async (id) =>
      id === "member-x1" ? { gitRoot: "/member-repo", prefix: "" } : undefined,
    forge: undefined,
    // Injected dispatch: captures every argument dispatchScopePlan hands it,
    // so this test can see whether a check-words mapping rides alongside
    // the slices without depending on dispatchTep's internals at all.
    dispatch: async (...args) => {
      calls.push(args);
      return { refusals: ["stub: not exercising the real run"], undelivered: [] };
    },
  };

  await dispatchScopePlan({
    plan,
    cut,
    space: () => space,
    deps,
    runState: new RunState(() => {}),
    spaceName: "greet space",
    onDelivery: () => {},
    changed: () => {},
  });

  assert.ok(calls.length >= 1, "the anchor scope was dispatched");
  const anchorCall = calls[0];
  // dispatchTep's parameter list carries the check words "alongside the
  // slices" (contract wording) — assert some argument beyond (deps, space,
  // cut, slices) exists and is a non-empty object keyed by probe footprint
  // paths mapping to the check's own words, not an ordinal or empty value.
  const extraArgs = anchorCall.slice(4);
  assert.ok(
    extraArgs.length >= 1,
    "dispatchScopePlan's call to dispatch carries an argument beyond (deps, space, cut, slices) for the check words",
  );
  const checkWords = extraArgs[0];
  assert.ok(
    checkWords && typeof checkWords === "object",
    "the check-words argument is an object mapping probe path to check text",
  );
  const entries = Object.entries(checkWords);
  assert.ok(entries.length > 0, "the anchor scope's check-words mapping is not empty");
  for (const [probePath, text] of entries) {
    assert.match(
      probePath,
      /^probes\/.*_AC-\d+\.test\.mjs$/,
      `check-words key "${probePath}" names a probe footprint path`,
    );
    assert.equal(typeof text, "string");
    assert.ok(text.trim().length > 0, `check-words value for "${probePath}" is non-empty check text`);
  }
  // The anchor change's own acceptance text ("greet() returns 'hello'")
  // must be findable among the words handed to dispatch — not merely
  // present as an ordinal-keyed stand-in.
  assert.ok(
    entries.some(([, text]) => text.includes("greet() returns 'hello'")),
    "the anchor scope's check words include the acceptance text authored on the change",
  );
});

test("dispatchScopePlan forwards per-probe check words to the dispatch call for a member scope too", async () => {
  const { space, cut } = twoScopeSpace();
  const plan = planScopes(space, cut);
  assert.ok(plan.ok, `scope plan: ${JSON.stringify(plan)}`);

  const calls = [];
  const deps = {
    round: { model: "sonnet", repoRoot: "/anchor-repo" },
    storeDir: "/tmp/store",
    storageDir: "/tmp/keys",
    now: () => new Date().toISOString(),
    scope: { gitRoot: "/anchor-repo", prefix: "", projectId: "proj-1", label: "P" },
    resolveScope: async (id) =>
      id === "member-x1" ? { gitRoot: "/member-repo", prefix: "" } : undefined,
    forge: undefined,
    dispatch: async (...args) => {
      calls.push(args);
      return { delivery: { id: "d", branch: "b" }, refusals: [], undelivered: [] };
    },
  };

  await dispatchScopePlan({
    plan,
    cut,
    space: () => space,
    deps,
    runState: new RunState(() => {}),
    spaceName: "greet space",
    onDelivery: () => {},
    changed: () => {},
  });

  assert.equal(calls.length, 2, "both the anchor and the member scope were dispatched in plan order");
  const memberCall = calls[1];
  const checkWords = memberCall.slice(4)[0];
  assert.ok(
    checkWords && typeof checkWords === "object" && Object.keys(checkWords).length > 0,
    "the member scope's dispatch call also carries a non-empty check-words mapping — not only the anchor scope",
  );
  const entries = Object.entries(checkWords);
  assert.ok(
    entries.some(([, text]) => text.includes("consume() returns 'ok'")),
    "the member scope's check words include that scope's own acceptance text",
  );
  // The member scope's probes are qualified with its prefix (qualifyProbes,
  // src/dispatch/scopes.ts) — the check-words keys must have been qualified
  // in lockstep, or the mapping's keys would never resolve to the actual
  // (prefixed) footprint path the closing gate looks up.
  for (const probePath of Object.keys(checkWords)) {
    assert.match(
      probePath,
      /^probes\/.*_AC-\d+\.test\.mjs$/,
      `member scope check-words key "${probePath}" is a well-formed probe footprint path`,
    );
  }
});

test("dispatchScopePlan still passes check words when the plan has only the anchor scope (single-repo run)", async () => {
  // INVARIANT: the anchor scope must never be treated as a special case
  // that skips the check-words argument — a single-scope TEP is the
  // overwhelmingly common shape and must carry the same wiring forever.
  let s = emptySpace();
  const a = addAsk(s, "greet the user", "t");
  assert.ok(a.ok);
  s = a.space;
  const n = addNode(s, {
    sentence: "a greet module returning a greeting",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "greet() returns 'hello'" }],
    grounding: { touchpoints: [{ path: "src/greet.mjs", planned: true }], stamp: [] },
  });
  assert.ok(n.ok);
  s = n.space;
  const cut = { id: "cut-2", changeIds: [n.added.id], tepId: "TEP-t-2" };
  const plan = planScopes(s, cut);
  assert.ok(plan.ok, `scope plan: ${JSON.stringify(plan)}`);
  assert.deepEqual(plan.order, [""], "single-scope plan dispatches only the anchor");

  const calls = [];
  const deps = {
    round: { model: "sonnet", repoRoot: "/anchor-repo" },
    storeDir: "/tmp/store",
    storageDir: "/tmp/keys",
    now: () => new Date().toISOString(),
    dispatch: async (...args) => {
      calls.push(args);
      return { delivery: { id: "d", branch: "b" }, refusals: [], undelivered: [] };
    },
  };

  await dispatchScopePlan({
    plan,
    cut,
    space: () => s,
    deps,
    runState: new RunState(() => {}),
    spaceName: "greet space",
    onDelivery: () => {},
    changed: () => {},
  });

  assert.equal(calls.length, 1, "the anchor scope dispatched exactly once");
  const checkWords = calls[0].slice(4)[0];
  assert.ok(
    checkWords && typeof checkWords === "object" && Object.keys(checkWords).length > 0,
    "check words reach the dispatch call even when the anchor is the only scope in the plan",
  );
});
