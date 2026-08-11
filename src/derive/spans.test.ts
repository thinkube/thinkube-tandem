import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { enrichAffected, quoteAnchor, quoteAt } from "./spans";

// The fixture is deliberately NOT TypeScript: nothing here may depend on
// what a declaration looks like in any particular language.
const repo = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-spans-"));
  fs.mkdirSync(path.join(root, "app"));
  fs.writeFileSync(
    path.join(root, "app", "billing.py"),
    ["import tax", "", "def charge(order):", '    """Charge one order."""', "    return tax.apply(order)", ""].join(
      "\n",
    ),
  );
  return root;
};

test("a pointer with a line number gains the line it points at", () => {
  const root = repo();
  assert.equal(quoteAt(root, "app/billing.py", 3), "def charge(order):");
  const out = enrichAffected(
    root,
    "- checkout() [calls] app/billing.py:L5\n- orders.py [imports] app/orders.py:L1",
  );
  assert.ok(out.includes("> return tax.apply(order)"), "the named line rides under its entry");
  assert.ok(out.includes("app/orders.py:L1"), "an entry whose file is gone keeps its pointer");
  assert.ok(!out.includes("app/orders.py:L1\n    >"), "and gains no invented quote");
});

test("an anchor's symbol is found by literal match, never by grammar", () => {
  const root = repo();
  assert.equal(
    quoteAnchor(root, { path: "app/billing.py", symbol: "charge" }),
    "def charge(order):",
  );
  assert.equal(
    quoteAnchor(root, { path: "app/billing.py", symbol: "charge", planned: true }),
    undefined,
    "a planned anchor has no source to quote",
  );
  assert.equal(
    quoteAnchor(root, { path: "app/billing.py" }),
    undefined,
    "no symbol, no guess",
  );
  assert.equal(
    quoteAnchor(root, { path: "app/missing.py", symbol: "charge" }),
    undefined,
    "a missing file quotes nothing",
  );
});

test("enrichment survives text without locators", () => {
  const root = repo();
  const plain = "Affected nodes for billing.py\nRelations: calls, imports";
  assert.equal(enrichAffected(root, plain), plain);
  assert.equal(enrichAffected(root, ""), "");
});
