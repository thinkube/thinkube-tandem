/**
 * TRANSITION — the documentation-exemption action is added to both the
 * surface's SHAPING set (webview/map/src/vscode.ts) and the host's phase
 * table (src/surfaces/phase.ts). This test's job is done once both name
 * the same action and the repository's own hygiene check ("every shaping
 * action the surface can send is gated by a phase") holds for it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { gatedActions } from "../surfaces/phase";

const repo = path.resolve(__dirname, "..", "..");

test("the SHAPING set and the phase table hold exactly the same action names once the documentation-exemption action is added to both", () => {
  const src = fs.readFileSync(path.join(repo, "webview", "map", "src", "vscode.ts"), "utf8");
  const block = /const SHAPING = new Set\(\[([\s\S]*?)\]\)/.exec(src);
  assert.ok(block, "the surface no longer declares which actions are shaping");
  const shaping = [...block[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).sort();
  const gated = gatedActions().sort();

  // The two full lists must agree, exactly as the repository's own hygiene
  // check requires — this is that same invariant, driven specifically by
  // the new documentation-exemption action.
  assert.deepEqual(shaping.filter((a) => !gated.includes(a)), [], "the surface can send these, and no phase governs them");
  assert.deepEqual(gated.filter((a) => !shaping.includes(a)), [], "the phase table governs these, and the surface never sends them");

  const docsAction = shaping.find((a) => /doc/.test(a));
  assert.ok(docsAction, "no documentation-exemption action was found in the surface's SHAPING set");
  assert.ok(gated.includes(docsAction!), `the phase table does not gate '${docsAction}'`);
});
