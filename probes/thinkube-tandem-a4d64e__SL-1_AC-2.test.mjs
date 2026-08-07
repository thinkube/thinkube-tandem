/**
 * TRANSITION — proves the change "Scope qualification keeps the
 * probe→check-words mapping aligned with the probe paths it renames, so a
 * member-scope delivery names its checks in words too" has landed.
 * Before this change qualifyProbes only renamed footprint paths; the
 * check-words mapping keyed by the OLD path went stale for any qualified
 * (member-scope) probe, so a two-scope run's member-scope proofs had
 * nothing to look their check text up by and fell back to an ordinal
 * label (AC-<n>). This test's job is done once qualification keeps both
 * renamed together — it does not need to keep proving it after that, but
 * stays as regression coverage for the specific bug (stale keys after
 * renaming) it was written against.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import { qualifyProbes } from "../src/dispatch/scopes.ts";
import { dispatchScopePlan } from "../src/dispatch/scopeRun.ts";
import { tepSlices } from "../src/dispatch/adapter.ts";
import { emptySpace } from "../src/core/schema.ts";
import { addAsk, addNode } from "../src/core/intent.ts";
import { RunState } from "../src/run/state.ts";

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sl1ac2-"));
  const g = (args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  execFileSync("git", ["init", "-q", dir], { encoding: "utf8" });
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  fs.writeFileSync(path.join(dir, "README.md"), "seed\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "seed"]);
  return dir;
}

// qualifyProbes renames a test work unit's footprint AND keeps the
// check-words mapping's keys pointed at the SAME check text — a lookup by
// the (now-prefixed) footprint path must still resolve after qualification,
// not just before it.
test("qualifyProbes prefixes footprint paths and the check-words keys together, so a footprint lookup still resolves after qualification", () => {
  let s = emptySpace();
  const a = addAsk(s, "the member greeting", "t");
  assert.ok(a.ok);
  s = a.space;
  const n = addNode(s, {
    sentence: "a greeting module",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "greet() returns 'hello'" }],
    grounding: { touchpoints: [{ path: "src/greet.mjs", planned: true }], stamp: [] },
  });
  assert.ok(n.ok);

  const slices = tepSlices({ space: n.space, cut: { id: "cut-1", changeIds: [n.added.id] }, spaceName: "sp" });
  const testUnit = slices[0].workUnits.find((u) => u.role === "test");
  assert.ok(testUnit, "a probe work unit exists for the one acceptance check");
  const originalFootprint = testUnit.footprint[0];

  // The mapping as the adapter would build it: footprint path -> check text.
  const checkWords = { [originalFootprint]: "greet() returns 'hello'" };

  const aligned = qualifyProbes(slices, "extensions/web", checkWords);

  const prefixedFootprint = testUnit.footprint[0];
  assert.equal(
    prefixedFootprint,
    `extensions/web/${originalFootprint}`,
    "qualifyProbes still renames the footprint path with the scope prefix",
  );
  assert.equal(
    aligned[prefixedFootprint],
    "greet() returns 'hello'",
    "the check-words mapping now resolves the RENAMED (prefixed) footprint to the same check text",
  );
  assert.equal(
    aligned[originalFootprint],
    undefined,
    "the stale, pre-qualification key is not left behind to falsely resolve",
  );
});

// A two-scope TEP whose member scope has prefix "web" must deliver proofs
// labelled with the check's own words for BOTH scopes — never an AC-<n>
// ordinal fallback for the member scope's (qualified) probes.
test("a two-scope TEP whose member scope has prefix 'web' delivers proofs labelled with the check's words for BOTH scopes, no ordinal fallback", async () => {
  const anchorRepo = tmpRepo();
  const memberRepo = tmpRepo();

  let s = emptySpace();
  const a = addAsk(s, "the shared type and its web consumer", "t");
  assert.ok(a.ok);
  s = a.space;
  const n1 = addNode(s, {
    sentence: "the shared greeting module",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "the anchor greet module returns hello" }],
    grounding: { touchpoints: [{ path: "src/greet.mjs", planned: true }], stamp: [] },
  });
  assert.ok(n1.ok);
  s = n1.space;
  const n2 = addNode(s, {
    sentence: "the web consumer module",
    serves: [a.added.id],
    needs: [n1.added.id],
    acceptance: [{ id: "c2", text: "the web consume function returns ok" }],
    grounding: {
      touchpoints: [{ path: "src/consume.mjs", planned: true, scope: "web" }],
      stamp: [],
    },
  });
  assert.ok(n2.ok);
  s = n2.space;

  const cut = { id: "cut-1", changeIds: [n1.added.id, n2.added.id], tepId: "TEP-t-2" };

  const { planScopes } = await import("../src/dispatch/scopes.ts");
  const plan = planScopes(s, cut);
  assert.ok(plan.ok, `scope plan: ${JSON.stringify(plan)}`);

  const capturedCheckWords = [];
  const runState = new RunState(() => {});

  const fakeDispatch = async (deps, space, scopedCut, slices, checkWords) => {
    capturedCheckWords.push({ repoRoot: deps.repoRoot, checkWords, slices });
    // Build proof labels exactly as the closing gate is contracted to:
    // each test work unit's proof is labelled with checkWords[footprint],
    // never a bare "AC-<n>" ordinal.
    const proofs = slices.flatMap((sl) =>
      sl.workUnits
        .filter((u) => u.role === "test")
        .map((u) => ({
          kind: "runnable",
          label: (checkWords && checkWords[u.footprint[0]]) || `AC-${u.footprint[0]}`,
          verdict: "green",
        })),
    );
    return {
      delivery: {
        id: scopedCut.tepId ?? scopedCut.id,
        branch: `tandem/${scopedCut.tepId ?? scopedCut.id}`,
        proofs,
      },
      refusals: [],
      undelivered: [],
    };
  };

  const deliveries = [];
  const outcome = await dispatchScopePlan({
    plan,
    cut,
    space: () => s,
    deps: {
      round: { model: "sonnet", repoRoot: anchorRepo },
      storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-store-")),
      storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
      now: () => new Date().toISOString(),
      forge: undefined,
      scope: { gitRoot: anchorRepo, prefix: "", projectId: "proj-1", label: "P" },
      resolveScope: async (id) => (id === "web" ? { gitRoot: memberRepo, prefix: "extensions/web" } : undefined),
      dispatch: fakeDispatch,
    },
    runState,
    spaceName: "sp",
    onDelivery: (delivery) => deliveries.push(delivery),
    changed: () => {},
  });
  void outcome;

  assert.equal(capturedCheckWords.length, 2, "both the anchor scope and the web member scope were dispatched");

  const AC_ORDINAL = /^AC-\d+$/;
  for (const { checkWords, slices } of capturedCheckWords) {
    assert.ok(checkWords, "dispatchScopePlan passed check words into the dispatch call for this scope");
    const testFootprints = slices.flatMap((sl) =>
      sl.workUnits.filter((u) => u.role === "test").map((u) => u.footprint[0]),
    );
    assert.ok(testFootprints.length > 0, "this scope's slices carry at least one held-out probe");
    for (const fp of testFootprints) {
      const label = checkWords[fp];
      assert.ok(
        typeof label === "string" && label.length > 0,
        `check words resolve for footprint ${fp}`,
      );
      assert.ok(
        !AC_ORDINAL.test(label),
        `the label "${label}" for ${fp} is the check's own words, not a bare AC-<n> ordinal`,
      );
    }
  }

  assert.equal(deliveries.length, 2, "one delivery per scope");
  for (const delivery of deliveries) {
    const testProofs = delivery.proofs.filter((p) => p.kind === "runnable");
    assert.ok(testProofs.length > 0, "the delivery carries runnable proofs");
    for (const proof of testProofs) {
      assert.ok(
        !AC_ORDINAL.test(proof.label),
        `delivered proof label "${proof.label}" is the check's own words, not an ordinal, for scope ${delivery.id}`,
      );
    }
  }

  const anchorProofs = deliveries.find((d) => d.id === cut.tepId).proofs.filter((p) => p.kind === "runnable");
  assert.ok(
    anchorProofs.some((p) => p.label === "the anchor greet module returns hello"),
    "the anchor scope's proof is labelled with its check's own words",
  );
  const memberProofs = deliveries.find((d) => d.id !== cut.tepId).proofs.filter((p) => p.kind === "runnable");
  assert.ok(
    memberProofs.some((p) => p.label === "the web consume function returns ok"),
    "the web member scope's proof is labelled with its check's own words too",
  );
});
