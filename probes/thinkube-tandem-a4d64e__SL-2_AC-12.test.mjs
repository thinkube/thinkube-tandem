// AC-12 (TRANSITION): the treatment chosen for pre-documentation signature
// drift is written down as a one-sentence decision in DECISIONS.md — this
// proves the record was made, not a standing behaviour; its job is done
// once the sentence lands and stays.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const decisionsPath = path.join(here, "..", "DECISIONS.md");

test("DECISIONS.md records the pre-documentation signature-drift treatment in the Parity batch", () => {
  const text = fs.readFileSync(decisionsPath, "utf8");
  assert.match(text, /## Parity batch/, "the Parity batch section still exists");
  const parityBatch = text.slice(text.indexOf("## Parity batch"));
  assert.match(
    parityBatch,
    /pre-documentation|signed before.*documentation|documentation line/i,
    "the Parity batch names the treatment of a cut signed before the documentation line existed",
  );
  assert.match(
    parityBatch,
    /re-?sign|verif(y|ies) clean|tolerat/i,
    "the entry states the chosen treatment: tolerated, or settled by re-signing",
  );
});
