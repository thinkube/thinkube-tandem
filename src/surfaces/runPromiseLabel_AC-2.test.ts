/**
 * TRANSITION: before promiseLabelOf existed, a unit holding several
 * promises had no rule for naming its card in one line. This pins that
 * `full` keeps every sentence and `label` names the first promise while
 * counting the rest, so a multi-promise unit's title is never just the
 * first sentence with the others silently dropped.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { promiseLabelOf } from "./runPromiseLabel";
import type { Change, Unit } from "../core/schema";

function change(id: string, sentence: string): Change {
  return { id, sentence, serves: [], needs: [], acceptance: [] };
}

test("promiseLabelOf on a unit holding several changes returns every sentence in full, and a label naming the first plus a count of the rest", () => {
  const nodes = [
    change("chg-1", "The audit card only goes green when every worker of that slice has passed."),
    change("chg-2", "The audit card says how many of its criteria passed and names each one that did not."),
    change("chg-3", "The run remembers, per slice, which of its criteria passed and which did not."),
  ];
  const units: Unit[] = [{ id: "SL-5#eu-1", changeIds: ["chg-1", "chg-2", "chg-3"] }];

  const out = promiseLabelOf({ nodes, units, slice: "SL-5" });

  assert.ok(out, "a unit holding several changes of the named slice still produces a label");
  assert.equal(
    out!.full,
    [
      "The audit card only goes green when every worker of that slice has passed.",
      "The audit card says how many of its criteria passed and names each one that did not.",
      "The run remembers, per slice, which of its criteria passed and which did not.",
    ].join("\n"),
    "full carries every promise sentence the unit holds, in order, none dropped",
  );
  assert.match(
    out!.label,
    /^The audit card only goes green when every worker of that slice has passed\./,
    "label opens with the first promise's own words",
  );
  assert.match(out!.label, /2/, "label counts the two promises left over, not just the first");
});
