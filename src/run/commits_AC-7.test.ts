/**
 * INVARIANT — proofOfPass must never hand the surface a bare "passed" when
 * there is nothing behind it: zero log lines must always report proven
 * false and say plainly that no log of the proof is kept, so a card can
 * never draw a green with nothing standing behind it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { proofOfPass } from "../surfaces/surfaceContract";

test("proofOfPass with zero lines reports proven false and says no log is kept", () => {
  const p = proofOfPass(0);

  assert.equal(p.proven, false, "zero log lines is never proof of a pass");
  assert.notEqual(p.text.trim().toLowerCase(), "passed", "never a bare 'passed'");
  assert.match(
    p.text,
    /no log/i,
    "the text says outright that no log of the proof is kept",
  );
});
