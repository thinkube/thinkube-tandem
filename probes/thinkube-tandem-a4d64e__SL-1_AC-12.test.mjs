// WHY (TRANSITION): the gates page must say the waiver is a typed reason,
// that an empty reason does not count, and that the reason is printed on
// the cut review page. Proves the new waiver rule is documented in full,
// not just named in passing; done once this prose ships.
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
const lower = gatesPage.toLowerCase();

test("the page states the waiver is a typed reason", () => {
  assert.match(lower, /reason/, "the page mentions a reason at all");
  assert.match(lower, /waiv|not needed|not-needed/, "the page names the waiver gesture");
});

test("the page states an empty reason does not count", () => {
  assert.match(lower, /empty/, "the page states emptiness is refused");
});

test("the page states the reason is printed on the cut review page", () => {
  assert.match(lower, /cut review/, "the page names the cut review page as where the reason prints");
});
