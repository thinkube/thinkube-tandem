/**
 * resolveCompositeSpecId — a create_slice `spec` arg resolves to the composite
 * `<tep>/<sp>` id the org tree is keyed by. SP numbers are PER-TEP (SP-3 exists
 * under TEP-1, TEP-3, TEP-6 in the real thinking space), so a bare id must either
 * resolve uniquely or refuse with the candidate TEPs named — never mis-resolve to
 * a phantom `specs/SP-3` path for a spec that plainly exists under its TEP.
 */
import "./installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveCompositeSpecId } from "./kanbanMcpServer";

const DIRS = ["1/1", "1/3", "3/3", "6/1", "6/2", "6/3", "6/8"];
const list = () => Promise.resolve(DIRS);

test("a bare SP number that is unique across TEPs resolves to its composite", async () => {
  assert.equal(await resolveCompositeSpecId(list, "8"), "6/8");
  assert.equal(await resolveCompositeSpecId(list, "2"), "6/2");
});

test("a bare SP number that repeats across TEPs is refused, naming the candidate TEPs", async () => {
  // SP-3 lives under TEP-1, TEP-3, and TEP-6 — ambiguous.
  await assert.rejects(() => resolveCompositeSpecId(list, "3"), (e: Error) => {
    assert.match(e.message, /Ambiguous spec id "3"/);
    assert.match(e.message, /TEP-1, TEP-3, TEP-6/);
    assert.match(e.message, /<tep>\/3/); // tells the caller how to disambiguate
    return true;
  });
});

test("an already-composite id passes through untouched (no lookup)", async () => {
  const boom = () => Promise.reject(new Error("listSpecDirs must not be called"));
  assert.equal(await resolveCompositeSpecId(boom, "6/3"), "6/3");
});

test("an unknown bare id is returned verbatim (caller reports the real not-found path)", async () => {
  // No throw here — createSlice's getFile miss reports `pathForSpecDoc` truthfully.
  assert.equal(await resolveCompositeSpecId(list, "99"), "99");
});
