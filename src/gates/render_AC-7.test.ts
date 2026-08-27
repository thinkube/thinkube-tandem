/**
 * INVARIANT — the webview never decides for itself whether a cut owes
 * documentation: SpacePush must declare the documentation field, and no
 * file under webview/map/src may re-derive that verdict from landings or
 * exemptions on its own. The one rule is docsDuty; this test drives it for
 * real fixtures (landed, exempt, missing) and checks the webview's type
 * declares a field able to carry exactly what docsDuty returns. This must
 * always hold, or the rail and the one rule can silently disagree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { docsDuty } from "../core/docsDuty";
import { emptySpace, Cut } from "../core/schema";

const repo = path.resolve(__dirname, "..", "..");
const webviewSrc = path.join(repo, "webview", "map", "src");

test("the webview's SpacePush type declares a documentation field shaped to hold docsDuty's own verdict, and no file under webview/map/src decides for itself whether a cut owes documentation", () => {
  // Drive the real rule for the three states it can return, so the webview
  // type is checked against what docsDuty actually produces, not an
  // assumed literal.
  const landedSpace = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "land a doc page",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "the page exists" }],
        grounding: { touchpoints: [{ path: "docs/modules/ROOT/pages/gates.adoc", planned: false }], stamp: [] },
      },
    ],
  };
  const landedCut: Cut = { id: "cut-1", changeIds: ["n1"] };
  const landed = docsDuty(landedSpace as never, landedCut);
  assert.equal(landed.state, "landed");
  assert.ok(landed.landings.length > 0, "docsDuty names the landed docs paths");

  const exemptSpace = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "rename an internal helper",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "the helper is renamed" }],
        grounding: { touchpoints: [{ path: "src/internal/helper.ts", planned: false }], stamp: [] },
      },
    ],
  };
  const exemptCut: Cut = {
    id: "cut-2",
    changeIds: ["n1"],
    docsExemption: { reason: "no doc page describes this internal helper", at: "2026-08-24T00:00:00Z" },
  };
  const exempt = docsDuty(exemptSpace as never, exemptCut);
  assert.equal(exempt.state, "exempt");
  assert.equal(exempt.reason, "no doc page describes this internal helper");

  const missingSpace = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "add a helper",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "helper() runs" }],
        grounding: { touchpoints: [{ path: "src/helper.ts", planned: false }], stamp: [] },
      },
    ],
  };
  const missingCut: Cut = { id: "cut-3", changeIds: ["n1"] };
  const missing = docsDuty(missingSpace as never, missingCut);
  assert.equal(missing.state, "missing");

  // The webview's own type must declare a field able to carry every one of
  // the three verdicts docsDuty actually returns.
  const vscodeTs = fs.readFileSync(path.join(webviewSrc, "vscode.ts"), "utf8");
  const spacePushBlock = /interface SpacePush \{[\s\S]*?\n\}/.exec(vscodeTs);
  assert.ok(spacePushBlock, "SpacePush interface not found in webview/map/src/vscode.ts");
  assert.match(
    spacePushBlock[0],
    /documentation[?]?:\s*\{/,
    "SpacePush does not declare a documentation field",
  );
  assert.match(
    spacePushBlock[0],
    /"landed"\s*\|\s*"exempt"\s*\|\s*"missing"|"missing"\s*\|\s*"exempt"\s*\|\s*"landed"|state:\s*string/,
    "SpacePush's documentation field is not shaped to carry docsDuty's landed/exempt/missing states",
  );

  // No file under webview/map/src may re-derive the documentation verdict
  // itself: that would be a second place stating the rule docsDuty already
  // states once. A file may only READ push.documentation, never compute a
  // landed/exempt/missing verdict from raw landings or exemption fields.
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) {
        walk(p);
      } else if (/\.(ts|tsx)$/.test(name)) {
        const text = fs.readFileSync(p, "utf8");
        if (/docsExemption|docsDuty/.test(text)) offenders.push(path.relative(webviewSrc, p));
      }
    }
  };
  walk(webviewSrc);
  assert.deepEqual(offenders, [], "a webview file references docsExemption/docsDuty directly instead of reading push.documentation");
});
