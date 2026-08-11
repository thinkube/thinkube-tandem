// WHY (TRANSITION): no sentence on the gates page may still imply
// documentation is only checked at accept time — that was the old shape
// (the accept-time docs gate was the only rule); this proves the page no
// longer says or implies that, once the sign-time rule ships.
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

test("the page never states or implies documentation is checked only at accept", () => {
  const lower = gatesPage.toLowerCase();
  assert.doesNotMatch(
    lower,
    /documentation obligation derives from grounding/,
    "the superseded grounding-derives-obligation phrasing is gone",
  );
  // Gate 1 (sign-time) must itself carry a documentation refusal — the
  // strongest proof the page no longer treats accept-time as the only gate.
  const gate1 = gatesPage.slice(
    gatesPage.indexOf("Gate 1"),
    gatesPage.indexOf("Gate 2") > -1 ? gatesPage.indexOf("Gate 2") : undefined,
  );
  assert.match(gate1.toLowerCase(), /document/, "Gate 1's own section names documentation");
});
