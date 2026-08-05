/** Anchors are structural: positions are refused at the type's front door. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { validateAnchor } from "./schema";

test("validateAnchor: symbol paths pass; smuggled line numbers are refused", () => {
  assert.equal(validateAnchor({ path: "src/core/intent.ts", symbol: "addAsk" }), undefined);
  assert.equal(validateAnchor({ path: "src/core/intent.ts" }), undefined);
  assert.ok(validateAnchor({ path: "src/core/intent.ts:42" }));
  assert.ok(validateAnchor({ path: "src/core/intent.ts#L42" }));
  assert.ok(validateAnchor({ path: "  " }));
});
