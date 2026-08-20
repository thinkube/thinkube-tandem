import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decisionsStanza,
  extractDecisions,
  isProbePath,
  isTestPath,
  testHomesOf,
  testHomesStanza,
} from "./testHomes";

test("one rule says what is test-shaped — by naming conventions across ecosystems, not one language's extension", () => {
  for (const p of [
    "src/run/dispatch.test.ts",
    "src/gates/gates.spec.mjs",
    "lib/foo.test-helper.py",
    "tests/test_signing.py",
    "pkg/sign_test.go",
    "src/__tests__/render.tsx",
    "spec/models/user_spec.rb",
    "probes/space__SL-1_AC-1.test.mjs",
    "src/acceptance/ac1.mjs",
  ])
    assert.ok(isTestPath(p), `${p} is test-shaped`);
  for (const p of ["src/run/dispatch.ts", "docs/testing.adoc", "src/testHomes.ts", "src/contest/entry.ts"])
    assert.ok(!isTestPath(p), `${p} is production`);
  // A name is not enough: a runner must be able to execute the file. A
  // compiler's config, a fixture, a document are never checks.
  for (const p of ["tsconfig.test.json", "vitest.spec.json", "docs/x.test.md", "fixtures/tests/data.json", "tests/fixtures.yaml"])
    assert.ok(!isTestPath(p), `${p} is not a test — nothing runs it`);
  assert.ok(isProbePath("probes/x.test.mjs") && !isProbePath("src/run/dispatch.test.ts"));
  assert.deepEqual(
    testHomesOf(["probes/p.test.mjs", "src/gates/gates.test.ts", "src/gates/sign.ts"]),
    ["src/gates/gates.test.ts"],
    "test homes are the test-shaped paths that are not probes",
  );
});

test("the tester's decisions are read from its final words and become the coder's contract", () => {
  const said =
    "All probes written.\n" +
    "UNDELIVERED: none\n" +
    "DECISION: the pending waiver field on Space is named exactly `pendingDocsWaiver: { reason: string }`\n" +
    "- DECISION: the wire action is \"waive-docs\" with a `text` field\n" +
    "decision: lowercase counts too\n" +
    "Something else.";
  const d = extractDecisions(said);
  assert.equal(d.length, 3);
  assert.match(d[0], /pendingDocsWaiver/);
  assert.match(d[1], /waive-docs/);
  const stanza = decisionsStanza(d);
  assert.ok(stanza.includes("TESTER'S DECISIONS") && stanza.includes("pendingDocsWaiver"));
  assert.equal(decisionsStanza([]), "", "no decisions, no stanza");
});

test("the tester's brief for existing test homes: bring under, never overwrite, work named per file", () => {
  const stanza = testHomesStanza(
    ["src/gates/gates.test.ts", "src/run/lock.test.ts"],
    [{ path: "src/gates/gates.test.ts", sentence: "signing requires a docs touchpoint", criteria: ["signCut refuses without docs"] }],
  );
  assert.ok(stanza.includes("src/gates/gates.test.ts") && stanza.includes("signing requires a docs touchpoint"));
  assert.ok(stanza.includes("signCut refuses without docs"));
  assert.ok(stanza.includes("src/run/lock.test.ts"), "a folded test with no promise of its own is still named");
  assert.ok(/NEVER overwrite/.test(stanza) && /DECISION: /.test(stanza));
  assert.equal(testHomesStanza([], []), "");
});
