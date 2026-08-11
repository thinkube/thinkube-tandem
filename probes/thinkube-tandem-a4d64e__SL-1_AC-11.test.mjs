// WHY (TRANSITION): the gates page's Gate 1 refusal list gains a fifth
// refusal — a cut with no documentation — beside the four that already
// exist. This proves the page was updated to describe the new refusal;
// its job is done once that bullet lands and stays.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gatesPage = fs.readFileSync(
  path.join(__dirname, "..", "docs", "modules", "ROOT", "pages", "gates.adoc"),
  "utf8",
);

test("the Gate 1 refusal list names the missing-documentation refusal beside the existing four", () => {
  const gate1 = gatesPage.slice(
    gatesPage.indexOf("Gate 1"),
    gatesPage.indexOf("Gate 2") > -1 ? gatesPage.indexOf("Gate 2") : undefined,
  );
  const refusalLines = gate1.split("\n").filter((l) => /^\*\s/.test(l.trim()));
  assert.ok(
    refusalLines.length >= 5,
    `expected at least 5 Gate 1 refusal bullets (4 existing + documentation), found ${refusalLines.length}`,
  );
  assert.ok(
    refusalLines.some((l) => /document/i.test(l)),
    "one of the Gate 1 refusal bullets names documentation",
  );
});
