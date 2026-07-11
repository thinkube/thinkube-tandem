/**
 * Unit tests for the nested tree-path builders.
 * Pure strings — no vscode, no fs. Asserts the thinking space-RELATIVE shape the store
 * joins onto a thinking space root to get `<thinking space>/<org>/teps/TEP-n/SP-m/SL-k.md`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  tepsRoot,
  tepDir,
  tepDoc,
  specDir,
  specDoc,
  slicePath,
  sliceHandle,
} from "./treePaths";

test("builders produce the nested <org>/teps/TEP-n/SP-m/SL-k.md tree", () => {
  assert.equal(tepsRoot("Acme"), "Acme/teps");
  assert.equal(tepDir("Acme", 1), "Acme/teps/TEP-1");
  assert.equal(tepDoc("Acme", 1), "Acme/teps/TEP-1/tep.md");
  assert.equal(specDir("Acme", 1, 2), "Acme/teps/TEP-1/SP-2");
  assert.equal(specDoc("Acme", 1, 2), "Acme/teps/TEP-1/SP-2/spec.md");
  assert.equal(slicePath("Acme", 1, 2, 3), "Acme/teps/TEP-1/SP-2/SL-3.md");
});

test("the org segment is verbatim and forward-slashed (deepened namespace)", () => {
  // An org derived from a deepened namespace keeps its `/` separators so the
  // tree nests correctly under a multi-segment thinking space.
  assert.equal(
    slicePath("Platform/projects/plugin-delivery/cmxela", 1, 1, 1),
    "Platform/projects/plugin-delivery/cmxela/teps/TEP-1/SP-1/SL-1.md",
  );
});

test("sliceHandle flattens to the tep-qualified TEP-n_SP-m_SL-k form", () => {
  assert.equal(sliceHandle(1, 1, 1), "TEP-1_SP-1_SL-1");
  assert.equal(sliceHandle(2, 5, 3), "TEP-2_SP-5_SL-3");

  // The TEP segment is what keeps the handle unique when bare SP/SL numbers
  // repeat across different TEPs.
  assert.notEqual(sliceHandle(1, 1, 1), sliceHandle(2, 1, 1));
});
