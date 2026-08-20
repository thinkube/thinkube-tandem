// WHY (TRANSITION): a press the surface let through by mistake must never
// start work the host cannot do — proves refusedNow names why the
// documentation-exemption action is refused in a phase where signing is not
// possible, instead of silently letting it through.
import { test } from "node:test";
import assert from "node:assert/strict";
import { refusedNow } from "../out-test/surfaces/phase.js";

test("refusedNow names why the documentation-exemption action is refused in a phase where signing is not possible", () => {
  const reason = refusedNow("excuse-docs", "running");
  assert.ok(
    typeof reason === "string" && reason.length > 0,
    "refusedNow must name a reason when a run is in flight, not let the action through unqueried",
  );
});
