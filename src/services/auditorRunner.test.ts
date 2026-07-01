// The verifiability auditor + the command-derivation split (TEP-6 / SP-6/1 + SP-6/7).
//
// The auditor (`createSdkAuditRunner`) only JUDGES: it returns the model's per-AC verdict + env
// verbatim — it no longer authors the `run` command. Authoring a local verifiable AC's command from
// the repo's CONVENTION (a held-out acceptance-probe recipe, else a whole-suite fallback) is the
// deterministic, model-free `deriveVerificationCommands` step `write_spec` runs over the verdicts.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createSdkAuditRunner,
  deriveVerificationCommands,
  fillProbeTemplate,
  type AuditVerdict,
} from "./auditorRunner";

type AnyQuery = (args: unknown) => AsyncIterable<unknown>;

/** A stubbed SDK `query`: yields one successful `result` whose text is `json` — the shape
 *  `createSdkAuditRunner` parses verdicts from. */
function fakeQuery(json: string): AnyQuery {
  return async function* () {
    yield {
      type: "result",
      subtype: "success",
      is_error: false,
      result: json,
      session_id: "sess-1",
    };
  };
}

const ACS = [
  { ordinal: 1, text: "AC one" },
  { ordinal: 2, text: "AC two" },
];

// ── the auditor JUDGES only — verdict + env, run verbatim, no command authoring ──

test("createSdkAuditRunner returns the model's verdicts verbatim — it does not author commands", async () => {
  const modelVerdicts = JSON.stringify([
    { ordinal: 1, verdict: "verifiable", run: "whatever the model said", env: "local" },
    { ordinal: 2, verdict: "verifiable", run: "kubectl apply -f x", env: "cluster" },
  ]);
  const runner = createSdkAuditRunner({ loadQuery: async () => fakeQuery(modelVerdicts) });
  const res = await runner({ acs: ACS, cwd: "/repo" });

  assert.equal(res.error, undefined);
  const byOrd = new Map(res.verdicts.map((v) => [v.ordinal, v]));
  // No override: whatever the model said stands (the builder re-authors local runs later).
  assert.equal(byOrd.get(1)?.run, "whatever the model said");
  assert.equal(byOrd.get(2)?.run, "kubectl apply -f x");
  assert.equal(res.passed, true);
});

test("SP-6/7: an assessment verdict passes the audit and carries no run", async () => {
  const modelVerdicts = JSON.stringify([
    { ordinal: 1, verdict: "verifiable", run: "x", env: "local" },
    { ordinal: 2, verdict: "assessment", rationale: "a prose/UX quality an assessor judges" },
  ]);
  const runner = createSdkAuditRunner({ loadQuery: async () => fakeQuery(modelVerdicts) });
  const res = await runner({ acs: ACS, cwd: "/repo" });
  const byOrd = new Map(res.verdicts.map((v) => [v.ordinal, v]));
  assert.equal(byOrd.get(2)?.verdict, "assessment");
  assert.equal(byOrd.get(2)?.run, undefined);
  assert.match(byOrd.get(2)?.rationale ?? "", /assessor judges/);
  assert.equal(res.passed, true);
});

test("SP-6/7: a needs-reframe verdict fails the audit (assessment did not weaken it)", async () => {
  const modelVerdicts = JSON.stringify([
    { ordinal: 1, verdict: "verifiable", run: "x", env: "local" },
    { ordinal: 2, verdict: "needs-reframe", why: "a human confirms by eye" },
  ]);
  const runner = createSdkAuditRunner({ loadQuery: async () => fakeQuery(modelVerdicts) });
  const res = await runner({ acs: ACS, cwd: "/repo" });
  assert.equal(res.passed, false);
});

// ── deriveVerificationCommands AUTHORS the local run from the repo convention ──

const V = (
  ordinal: number,
  run?: string,
  env?: "local" | "cluster",
  verdict: AuditVerdict["verdict"] = "verifiable",
): AuditVerdict => ({ ordinal, verdict, run, env });

test("held-out recipe: a local verifiable AC's run is the repo's probe template filled with (spec, ordinal)", async () => {
  const verdicts = [V(1, "npx vitest run src/a.test.ts", "local"), V(2, undefined, "local")];
  await deriveVerificationCommands(verdicts, {
    cwd: "/repo",
    specId: "6/3",
    resolveAcceptanceRecipe: async () => ({
      sourcePath: "src/acceptance/SP-{spec}_AC-{ac}.test.ts",
      run: "node --test out-test/acceptance/SP-{spec}_AC-{ac}.test.js",
    }),
  });
  // Composite spec id 6/3 sanitized to 6_3; per-AC probe path; env normalized to local.
  assert.equal(verdicts[0].run, "node --test out-test/acceptance/SP-6_3_AC-1.test.js");
  assert.equal(verdicts[0].env, "local");
  assert.equal(verdicts[1].run, "node --test out-test/acceptance/SP-6_3_AC-2.test.js");
});

test("fallback: no recipe → the repo's whole-suite command (self-graded, unchanged behavior)", async () => {
  const verdicts = [V(1, "npx vitest run src/a.test.ts", "local")];
  await deriveVerificationCommands(verdicts, {
    cwd: "/repo",
    specId: "3",
    resolveAcceptanceRecipe: async () => undefined,
    resolveLocalRun: async () => "npm test",
  });
  assert.equal(verdicts[0].run, "npm test");
  assert.equal(verdicts[0].env, "local");
});

test("no recipe AND no whole-suite recipe → the model's command stands (no invention)", async () => {
  const verdicts = [V(1, "node ./check.js", "local")];
  await deriveVerificationCommands(verdicts, {
    cwd: "/repo",
    resolveAcceptanceRecipe: async () => undefined,
    resolveLocalRun: async () => undefined,
  });
  assert.equal(verdicts[0].run, "node ./check.js");
});

test("cluster / assessment / needs-reframe verdicts are left untouched by command authoring", async () => {
  const verdicts = [
    V(1, "kubectl apply -f x && check", "cluster"),
    V(2, undefined, undefined, "assessment"),
    V(3, undefined, undefined, "needs-reframe"),
  ];
  await deriveVerificationCommands(verdicts, {
    cwd: "/repo",
    specId: "3",
    resolveAcceptanceRecipe: async () => ({ sourcePath: "a/{spec}_{ac}", run: "run {spec} {ac}" }),
    resolveLocalRun: async () => "npm test",
  });
  assert.equal(verdicts[0].run, "kubectl apply -f x && check");
  assert.equal(verdicts[1].run, undefined);
  assert.equal(verdicts[2].run, undefined);
});

test("SP-6/7 AC6: a run already pointing at an acceptance/ path is kept as-is", async () => {
  const verdicts = [V(1, "node --test out-test/acceptance/SP-6.test.js", "local")];
  await deriveVerificationCommands(verdicts, {
    cwd: "/repo",
    specId: "9",
    resolveAcceptanceRecipe: async () => ({ sourcePath: "x", run: "SHOULD-NOT-APPLY" }),
    resolveLocalRun: async () => "npm test",
  });
  assert.equal(verdicts[0].run, "node --test out-test/acceptance/SP-6.test.js");
});

test("fillProbeTemplate sanitizes a composite spec id and substitutes both slots", () => {
  assert.equal(
    fillProbeTemplate("node --test out-test/acceptance/SP-{spec}_AC-{ac}.test.js", "6/3", 2),
    "node --test out-test/acceptance/SP-6_3_AC-2.test.js",
  );
});
