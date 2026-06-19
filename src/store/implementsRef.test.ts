/**
 * Unit tests for the qualified `implements:` ref engine (SP-tgvpbm_SL-1).
 * Pure — no vscode/fs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseImplements,
  formatImplements,
  resolvesTo,
  normalizeTepId,
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

test("resolvesTo: bare ref resolves to the spec's OWN board, never a project", () => {
  const ref = parseImplements("TEP-tgkx1k")!;
  // bare → repo-local: matches the spec's own namespace
  assert.equal(resolvesTo(ref, REPO, REPO, "tgkx1k"), true);
  // a bare ref can never make a spec a member of a project (owner ≠ project ns)
  assert.equal(resolvesTo(ref, REPO, PROJ, "tgkx1k"), false);
});
