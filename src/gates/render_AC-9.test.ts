/**
 * TRANSITION — the WebToHost union gains a documentation-exemption action
 * carrying reason text, so Rail.tsx can post it and the webview compiles
 * against a real member of the union. The action it posts must be one the
 * host actually gates (src/surfaces/phase.ts) and one whose reason text is
 * exactly what signCut requires to sign an otherwise-undocumented cut
 * (src/gates/sign.ts) — so this test drives both real modules and checks
 * the webview names the same action the host wiring expects. This test's
 * job is done once that union member exists and is wired to a real gate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { gatedActions } from "../surfaces/phase";
import { signCut } from "../gates/sign";
import { emptySpace, Cut } from "../core/schema";

const repo = path.resolve(__dirname, "..", "..");

test("the WebToHost union carries the documentation-exemption action with its reason text, so Rail.tsx can post it, and that reason is exactly what signCut needs to sign an undocumented cut", () => {
  // Ground the "reason text" half of the criterion in the real signing
  // rule: an empty reason must not be enough to sign an undocumented cut,
  // and a real reason, recorded as docsExemption, must be.
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "add an internal helper with no doc page",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "helper() runs" }],
        grounding: { touchpoints: [{ path: "src/helper.ts", planned: false }], stamp: [] },
      },
    ],
  };
  const REASON = "this cut only touches internal tooling that ships no doc page";
  const unexempted: Cut = { id: "cut-1", changeIds: ["n1"] };
  const refused = signCut(space as never, unexempted, "2026-08-24T00:00:00Z");
  assert.equal(refused.ok, false, "signCut refuses an undocumented cut with no exemption");

  const exempted: Cut = {
    id: "cut-2",
    changeIds: ["n1"],
    docsExemption: { reason: REASON, at: "2026-08-24T00:00:00Z" },
  };
  const signed = signCut(space as never, exempted, "2026-08-24T00:00:00Z");
  assert.equal(signed.ok, true, signed.ok ? "" : signed.reason);

  const vscodeTs = fs.readFileSync(path.join(repo, "webview", "map", "src", "vscode.ts"), "utf8");
  const unionBlock = /export type WebToHost =[\s\S]*?;\n/.exec(vscodeTs);
  assert.ok(unionBlock, "WebToHost union not found in webview/map/src/vscode.ts");

  const docsMember = /\{ action: "([a-z-]*doc[a-z-]*)"; reason: string \}/.exec(unionBlock[0]);
  assert.ok(docsMember, "WebToHost has no member naming a documentation-exemption action with reason text");

  // The action the webview names must be one the host's own phase table
  // actually gates — otherwise the surface could post it into a table that
  // never heard of it.
  const gated = gatedActions();
  assert.ok(
    gated.includes(docsMember![1]),
    `the phase table does not gate '${docsMember![1]}' — SHAPING and the phase table must agree on this action`,
  );

  const railTsx = fs.readFileSync(path.join(repo, "webview", "map", "src", "Rail.tsx"), "utf8");
  assert.match(
    railTsx,
    new RegExp(`action:\\s*"${docsMember![1]}"`),
    "Rail.tsx does not post the documentation-exemption action",
  );
});
