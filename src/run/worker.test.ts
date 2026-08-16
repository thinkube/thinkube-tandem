import { test } from "node:test";
import assert from "node:assert/strict";
import { realUndelivered } from "./worker";

test("a worker declaring nothing undelivered is not failed for its honesty", () => {
  assert.deepEqual(realUndelivered("all done\nUNDELIVERED: none."), []);
  assert.deepEqual(realUndelivered("UNDELIVERED: None"), []);
  assert.deepEqual(realUndelivered("UNDELIVERED: n/a"), []);
  assert.deepEqual(
    realUndelivered("UNDELIVERED: none — all 8 footprint files are written."),
    [],
    "a remark after 'none' is still nothing missing",
  );
  assert.deepEqual(
    realUndelivered("UNDELIVERED: nothing was written to Rail.tsx — no write access"),
    ["nothing was written to Rail.tsx — no write access"],
    "a gap that begins with 'nothing' is still a gap",
  );
  assert.deepEqual(
    realUndelivered("UNDELIVERED: the docs page was not reworded — no write access"),
    ["the docs page was not reworded — no write access"],
    "a real gap still counts",
  );
});
