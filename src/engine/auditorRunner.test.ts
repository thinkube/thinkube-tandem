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
  buildAuditPrompt,
  parseAuditVerdicts,
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

// ── rubric parity: the SIGNED audit asks all four questions (drift guard) ─────
// The skill-level /spec-prepare step-7 auditor and this server-side prompt are duplicated
// definitions of one rubric, and they drifted once already: controllability was added to the
// skill after a real run lost 4/4 of an AC's tests to an undefined arming seam, while this —
// the AUTHORITATIVE copy, the only one whose verdicts get signed — kept asking only the first
// two questions. Pin the four questions here so a future edit to one copy breaks loudly.

test("buildAuditPrompt asks all four questions — human actor, deploy-circular, controllability, assessment-vs-verifiable", () => {
  const prompt = buildAuditPrompt(
    [
      {
        ordinal: 1,
        text: "The gate refuses without a valid approval (with a secret configured).",
      },
    ],
    "## Design\n\nSome design.",
  );
  // Q1 — human-executed actor.
  assert.match(prompt, /actor is a human/i);
  // Q2 — deploy/merge-circular.
  assert.match(prompt, /deploy\/merge-circular/i);
  // Q3 — controllability: preconditions reachable through seams the Design NAMES;
  // an unnamed seam is a Design defect the auditor must name in `why`.
  assert.match(prompt, /CONTROLLABILITY/);
  assert.match(prompt, /preconditions/i);
  assert.match(prompt, /seams the Spec'?s Design\s+names/i);
  assert.match(prompt, /Design defect/i);
  // Q4 — the assessment-vs-verifiable classification.
  assert.match(prompt, /`assessment`/);
  assert.match(prompt, /`verifiable`/);
  // And the spec body context travels so controllability is judgeable against the Design.
  assert.match(prompt, /<spec>/);
});

// ── verdict parsing: bracket-bearing run commands must not shatter extraction ─
// The SP-1/1 rebrand certification failed twice with "no parseable verdicts" even though the
// auditor replied with a perfectly valid JSON array: the extractor scanned from the LAST `[`
// and returned the first slice parsing as ANY array — and a verdict's own `run` command
// contained bracket-indexing that is itself valid JSON (the live false winner was `[0]`), whose
// lone non-object entry the validator then dropped. Any spec whose ACs demand `node -e`-style
// JSON-inspection commands hit this 100% of the time.

test("REGRESSION: verdicts whose run commands contain [0] / [\"key\"] / packages[''] parse intact", () => {
  // Structurally the real failing reply: valid JSON array, bracket-indexing inside run strings.
  const reply = JSON.stringify([
    {
      ordinal: 1,
      verdict: "verifiable",
      run: `node -e "const p=require('./package.json'),l=require('./package-lock.json');if(!(l.packages['']&&l.packages[''].name==='thinkube-tandem'))process.exit(1)"`,
      env: "local",
    },
    {
      ordinal: 2,
      verdict: "verifiable",
      run: `node -e "const m=require('./package.json').contributes.viewsContainers['activitybar'][0];if(m.title!=='Thinkube Tandem')process.exit(1)"`,
      env: "local",
    },
    { ordinal: 3, verdict: "assessment", rationale: "prose quality" },
    {
      ordinal: 4,
      verdict: "verifiable",
      run: `node -e "const s=require('fs').readFileSync('dist/extension.js','utf8');if(!/exports[.\\s]/.test(s))process.exit(1)"`,
      env: "local",
    },
  ]);
  const v = parseAuditVerdicts(reply);
  assert.equal(v.length, 4, "all four verdicts must survive extraction");
  assert.equal(v[0].verdict, "verifiable");
  assert.match(v[0].run ?? "", /packages\[''\]/);
  assert.equal(v[2].verdict, "assessment");
});

test("parse: a fenced reply and a prose-wrapped reply still extract (tolerance preserved)", () => {
  const arr =
    '[{"ordinal":1,"verdict":"verifiable","run":"npm test","env":"local"}]';
  // fenced
  const fenced = "Here are my verdicts:\n```json\n" + arr + "\n```\nDone.";
  assert.equal(parseAuditVerdicts(fenced).length, 1);
  // prose-wrapped, with a bracket-indexing decoy AFTER the real array — the object-bearing
  // requirement keeps the decoy from winning.
  const prose = `My verdicts follow.\n${arr}\nNote argv[0] is the binary.`;
  const v = parseAuditVerdicts(prose);
  assert.equal(v.length, 1);
  assert.equal(v[0].run, "npm test");
});

test("parse failure now carries evidence: session id + a reply snippet (no more transcript archaeology)", async () => {
  const runner = createSdkAuditRunner({
    // SP-17/1: SdkAuditDeps now REQUIRES `model` (spread into options.model at the auditor query).
    model: "sonnet",
    loadQuery: async () => fakeQuery("I could not decide on verdicts, sorry."),
  });
  const res = await runner({ acs: ACS, cwd: "/repo" });
  assert.ok(res.error, "unparseable reply → error result");
  assert.match(res.error!, /sess-1/);
  assert.match(res.error!, /could not decide on verdicts/);
});

// ── the auditor JUDGES only — verdict + env, run verbatim, no command authoring ──

test("createSdkAuditRunner returns the model's verdicts verbatim — it does not author commands", async () => {
  const modelVerdicts = JSON.stringify([
    {
      ordinal: 1,
      verdict: "verifiable",
      run: "whatever the model said",
      env: "local",
    },
    {
      ordinal: 2,
      verdict: "verifiable",
      run: "kubectl apply -f x",
      env: "cluster",
    },
  ]);
  const runner = createSdkAuditRunner({
    model: "sonnet", // SP-17/1: model now required on SdkAuditDeps
    loadQuery: async () => fakeQuery(modelVerdicts),
  });
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
    {
      ordinal: 2,
      verdict: "assessment",
      rationale: "a prose/UX quality an assessor judges",
    },
  ]);
  const runner = createSdkAuditRunner({
    model: "sonnet", // SP-17/1: model now required on SdkAuditDeps
    loadQuery: async () => fakeQuery(modelVerdicts),
  });
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
  const runner = createSdkAuditRunner({
    model: "sonnet", // SP-17/1: model now required on SdkAuditDeps
    loadQuery: async () => fakeQuery(modelVerdicts),
  });
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
  const verdicts = [
    V(1, "npx vitest run src/a.test.ts", "local"),
    V(2, undefined, "local"),
  ];
  await deriveVerificationCommands(verdicts, {
    cwd: "/repo",
    specId: "6/3",
    resolveAcceptanceRecipe: async () => ({
      sourcePath: "src/acceptance/SP-{spec}_AC-{ac}.test.ts",
      run: "node --test out-test/acceptance/SP-{spec}_AC-{ac}.test.js",
    }),
  });
  // Composite spec id 6/3 sanitized to 6_3; per-AC probe path; env normalized to local.
  assert.equal(
    verdicts[0].run,
    "node --test out-test/acceptance/SP-6_3_AC-1.test.js",
  );
  assert.equal(verdicts[0].env, "local");
  assert.equal(
    verdicts[1].run,
    "node --test out-test/acceptance/SP-6_3_AC-2.test.js",
  );
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
    resolveAcceptanceRecipe: async () => ({
      sourcePath: "a/{spec}_{ac}",
      run: "run {spec} {ac}",
    }),
    resolveLocalRun: async () => "npm test",
  });
  assert.equal(verdicts[0].run, "kubectl apply -f x && check");
  assert.equal(verdicts[1].run, undefined);
  assert.equal(verdicts[2].run, undefined);
});

test("a declared recipe overrides even an acceptance-pointing auditor command (fabrication guard)", async () => {
  // The auditor is a headless model that fabricates plausible acceptance paths with the WRONG
  // runner / build-dir (seen on SP-6/15: `npx mocha dist/acceptance/…` in a `node --test out-test/…`
  // repo). Because ACCEPTANCE_EVIDENCE_RE matched that string, the old ordering kept it and skipped
  // the recipe — silently defeating the per-AC independence the recipe turns on. The recipe must win.
  const verdicts = [
    V(
      1,
      "npm run compile && npx mocha dist/acceptance/SP-6_15_AC-1.test.js",
      "local",
    ),
  ];
  await deriveVerificationCommands(verdicts, {
    cwd: "/repo",
    specId: "6/15",
    resolveAcceptanceRecipe: async () => ({
      sourcePath: "src/acceptance/SP-{spec}_AC-{ac}.test.ts",
      run: "node --test out-test/acceptance/SP-{spec}_AC-{ac}.test.js",
    }),
    resolveLocalRun: async () => "npm test",
  });
  assert.equal(
    verdicts[0].run,
    "node --test out-test/acceptance/SP-6_15_AC-1.test.js",
  );
  assert.equal(verdicts[0].env, "local");
});

test("SP-6/7 AC6: with NO recipe, an acceptance-pointing command is kept (not clobbered by the whole-suite fallback)", async () => {
  const verdicts = [
    V(1, "node --test out-test/acceptance/SP-6.test.js", "local"),
  ];
  await deriveVerificationCommands(verdicts, {
    cwd: "/repo",
    specId: "9",
    resolveAcceptanceRecipe: async () => undefined,
    resolveLocalRun: async () => "npm test",
  });
  assert.equal(verdicts[0].run, "node --test out-test/acceptance/SP-6.test.js");
});

test("fillProbeTemplate sanitizes a composite spec id and substitutes both slots", () => {
  assert.equal(
    fillProbeTemplate(
      "node --test out-test/acceptance/SP-{spec}_AC-{ac}.test.js",
      "6/3",
      2,
    ),
    "node --test out-test/acceptance/SP-6_3_AC-2.test.js",
  );
});

// ── Intent fidelity (2026-07-14): the parent TEP arms the north-star check ───
test("buildAuditPrompt: a supplied TEP body arms the INTENT FIDELITY rule and rides as context", () => {
  const acs = [{ ordinal: 1, text: "The session API accepts a seedGoal action." }];
  const withTep = buildAuditPrompt(acs, "spec body", "## Goal\nA person writes directly in the document.");
  assert.match(withTep, /INTENT FIDELITY/);
  assert.match(withTep, /<tep>/);
  assert.match(withTep, /person writes directly in the document/);
  const without = buildAuditPrompt(acs, "spec body");
  assert.doesNotMatch(without, /INTENT FIDELITY/, "no TEP → the rule is not armed (fail-open, as documented)");
});

// ── Prompt externalization (context tranche, 2026-07-14): rules as doctrine, contract in code ─
import * as fsTpl from "node:fs";
import * as osTpl from "node:os";
import * as pathTpl from "node:path";
import { configurePromptTemplates } from "./promptTemplates";

test("buildAuditPrompt (bundled fallback): carries the CONTRACT CONTROLLABILITY question + the JSON reply contract", (t) => {
  t.after(() => configurePromptTemplates({}));
  // Hermetic: no template anywhere → the bundled in-code rules serve the audit.
  configurePromptTemplates({
    repoDir: fsTpl.mkdtempSync(pathTpl.join(osTpl.tmpdir(), "tk-audit-")),
    pluginDirs: [],
  });
  const prompt = buildAuditPrompt(ACS, "spec body", "## Goal\nwhy");
  // The go-set's new design question (ITEM 4d): an obligation buildable only by INVENTING
  // an unnamed protocol is a Design defect → needs-reframe naming the missing design.
  assert.match(prompt, /CONTRACT CONTROLLABILITY/);
  assert.match(prompt, /invent a protocol/i);
  // The intent-fidelity rule still arms on a TEP, bundled path included.
  assert.match(prompt, /INTENT FIDELITY/);
  // The OUTPUT-FORMAT stanza — the parser's contract — is in code, template or not.
  assert.match(prompt, /Respond with ONLY a JSON array/);
  assert.match(prompt, /"verdict":"verifiable"/);
  // The AC placeholders interpolate.
  assert.match(prompt, /1\. AC one/);
  assert.match(prompt, /2\. AC two/);
});

test("buildAuditPrompt (template present): the PROSE is replaced, the if:tep conditional gates INTENT FIDELITY, the JSON contract survives", (t) => {
  t.after(() => configurePromptTemplates({}));
  const doctrine = fsTpl.mkdtempSync(pathTpl.join(osTpl.tmpdir(), "tk-audit-"));
  fsTpl.writeFileSync(
    pathTpl.join(doctrine, "audit-rules.md"),
    [
      "CUSTOM AUDIT DOCTRINE — judge each criterion harshly.",
      "<!-- if:tep -->",
      "CUSTOM INTENT FIDELITY — compare against the TEP.",
      "<!-- endif:tep -->",
    ].join("\n"),
    "utf8",
  );
  configurePromptTemplates({
    repoDir: fsTpl.mkdtempSync(pathTpl.join(osTpl.tmpdir(), "tk-audit-")),
    templateDir: doctrine,
    pluginDirs: [],
  });
  const withTep = buildAuditPrompt(ACS, "spec body", "## Goal\nwhy");
  assert.match(withTep, /CUSTOM AUDIT DOCTRINE/);
  assert.match(withTep, /CUSTOM INTENT FIDELITY/);
  assert.doesNotMatch(withTep, /adversarial verifiability auditor/); // bundled prose replaced
  assert.match(withTep, /Respond with ONLY a JSON array/); // …the reply contract was NOT
  assert.match(withTep, /1\. AC one/); // placeholders interpolate around the template
  const withoutTep = buildAuditPrompt(ACS, "spec body");
  assert.doesNotMatch(withoutTep, /CUSTOM INTENT FIDELITY/, "if:tep gates the block off");
  assert.match(withoutTep, /CUSTOM AUDIT DOCTRINE/);
});
