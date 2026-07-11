/**
 * Unit tests for the qualified `implements:` ref engine.
 * Pure — no vscode/fs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseImplements,
  formatImplements,
  resolvesTo,
  normalizeTepId,
  rewriteImplementsForPromote,
} from "./implementsRef";

test("parseImplements: bare ref → id only (TEP- stripped)", () => {
  assert.deepEqual(parseImplements("TEP-tgkx1k"), { id: "tgkx1k" });
  assert.deepEqual(parseImplements("tgkx1k"), { id: "tgkx1k" });
});

test("parseImplements: qualified ref → namespace + id", () => {
  assert.deepEqual(parseImplements("Platform/projects/rebrand:TEP-tgkx1k"), {
    namespace: "Platform/projects/rebrand",
    id: "tgkx1k",
  });
});

test("parseImplements: empty/undefined → undefined", () => {
  assert.equal(parseImplements(""), undefined);
  assert.equal(parseImplements(undefined), undefined);
});

// ── org-deepened namespaces ──
// The org-scoped layout adds one more namespace segment (`…/<org>`). The
// last-colon parser contract is preserved verbatim — the org is just another
// path segment, never special-cased — so a qualified `…/<org>:TEP-1` parses for
// free and a bare `TEP-1` still resolves within the spec's own (thinking space, org).

test("parseImplements: org-deepened qualified ref → {namespace (with org), id}", () => {
  assert.deepEqual(
    parseImplements("Platform/projects/plugin-delivery/cmxela:TEP-1"),
    { namespace: "Platform/projects/plugin-delivery/cmxela", id: "1" },
  );
  // A repo thinking space deepened with the org segment parses the same way.
  assert.deepEqual(parseImplements("Platform/core/thinkube/cmxela:TEP-2"), {
    namespace: "Platform/core/thinkube/cmxela",
    id: "2",
  });
});

test("resolvesTo: org-deepened qualified ref resolves to its target TEP", () => {
  const SPEC_NS = "Platform/core/thinkube/cmxela"; // the spec's own thinking space+org
  const TARGET_NS = "Platform/projects/plugin-delivery/cmxela";
  const qualified = parseImplements(`${TARGET_NS}:TEP-1`)!;
  assert.equal(resolvesTo(qualified, SPEC_NS, TARGET_NS, "1"), true);
  // Wrong owner namespace → no resolve.
  assert.equal(
    resolvesTo(qualified, SPEC_NS, "Platform/projects/other/cmxela", "1"),
    false,
  );
  // Wrong id → no resolve.
  assert.equal(resolvesTo(qualified, SPEC_NS, TARGET_NS, "2"), false);
});

test("resolvesTo: a bare TEP-1 resolves within the spec's OWN (thinking space, org)", () => {
  const SPEC_NS = "Platform/core/thinkube/cmxela";
  const TARGET_NS = "Platform/projects/plugin-delivery/cmxela";
  const bare = parseImplements("TEP-1")!;
  // bare → resolves to the spec's own thinking space+org.
  assert.equal(resolvesTo(bare, SPEC_NS, SPEC_NS, "1"), true);
  // bare never reaches a project umbrella (owner ≠ project ns).
  assert.equal(resolvesTo(bare, SPEC_NS, TARGET_NS, "1"), false);
});

test("formatImplements round-trips", () => {
  assert.equal(formatImplements(undefined, "tgkx1k"), "TEP-tgkx1k");
  assert.equal(
    formatImplements("Platform/projects/rebrand", "tgkx1k"),
    "Platform/projects/rebrand:TEP-tgkx1k",
  );
  const ns = "Platform/projects/rebrand";
  const v = formatImplements(ns, "tgkx1k");
  assert.deepEqual(parseImplements(v), { namespace: ns, id: "tgkx1k" });
});

test("normalizeTepId strips the prefix", () => {
  assert.equal(normalizeTepId("TEP-x"), "x");
  assert.equal(normalizeTepId("x"), "x");
});

const PROJ = "Platform/projects/rebrand";
const REPO = "Platform/core/thinkube";

test("resolvesTo: qualified ref matches its explicit owner namespace + id", () => {
  const ref = parseImplements(`${PROJ}:TEP-tgkx1k`)!;
  assert.equal(resolvesTo(ref, REPO, PROJ, "tgkx1k"), true);
  assert.equal(resolvesTo(ref, REPO, PROJ, "other"), false); // wrong id
  assert.equal(resolvesTo(ref, REPO, "Platform/projects/x", "tgkx1k"), false); // wrong ns
});

test("resolvesTo: bare ref resolves to the spec's OWN thinking space, never a project", () => {
  const ref = parseImplements("TEP-tgkx1k")!;
  // bare → repo-local: matches the spec's own namespace
  assert.equal(resolvesTo(ref, REPO, REPO, "tgkx1k"), true);
  // a bare ref can never make a spec a member of a project (owner ≠ project ns)
  assert.equal(resolvesTo(ref, REPO, PROJ, "tgkx1k"), false);
});

test("rewriteImplementsForPromote: bare ref in the origin repo → qualified umbrella ref", () => {
  assert.equal(
    rewriteImplementsForPromote(REPO, "TEP-tgkx1k", REPO, "tgkx1k", PROJ),
    `${PROJ}:TEP-tgkx1k`,
  );
});

test("rewriteImplementsForPromote: re-ids the dependent ref when the TEP is renumbered on promotion", () => {
  // Matched by the OLD id ("tgkx1k"), but the project re-allocated it to "5" —
  // dependents must point at the NEW id (the org-scoped collision fix).
  assert.equal(
    rewriteImplementsForPromote(REPO, "TEP-tgkx1k", REPO, "tgkx1k", PROJ, "5"),
    `${PROJ}:TEP-5`,
  );
  // a non-dependent is still untouched even with a newId
  assert.equal(
    rewriteImplementsForPromote(REPO, "TEP-other", REPO, "tgkx1k", PROJ, "5"),
    null,
  );
});

test("rewriteImplementsForPromote: ref already qualified to the origin → rewritten", () => {
  assert.equal(
    rewriteImplementsForPromote(
      "Platform/core/control",
      `${REPO}:TEP-tgkx1k`,
      REPO,
      "tgkx1k",
      PROJ,
    ),
    `${PROJ}:TEP-tgkx1k`,
  );
});

test("rewriteImplementsForPromote: non-dependents return null", () => {
  // different TEP id
  assert.equal(
    rewriteImplementsForPromote(REPO, "TEP-other", REPO, "tgkx1k", PROJ),
    null,
  );
  // bare ref in a DIFFERENT repo (that's a different TEP, not the one moving)
  assert.equal(
    rewriteImplementsForPromote(
      "Platform/core/control",
      "TEP-tgkx1k",
      REPO,
      "tgkx1k",
      PROJ,
    ),
    null,
  );
  // no implements at all
  assert.equal(
    rewriteImplementsForPromote(REPO, undefined, REPO, "tgkx1k", PROJ),
    null,
  );
});
