/**
 * INVARIANT: a module a product file imports a named symbol from directly
 * — reachable from an entry point, even from outside src/engine — has a
 * real product caller and must never appear in unwiredEngineModules. This
 * is the counterpart to the barrel case: it must hold forever, since the
 * ledger is only trustworthy if it never flags a module product code
 * actually calls.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { unwiredEngineModules } from "./engineWiring";

test("unwiredEngineModules excludes a module reached by a direct named import from outside src/engine", () => {
  const rewriteSpecifier = [".", "engine", "rtkRewrite"].join("/");
  const files = [
    {
      path: "src/entry.ts",
      content:
        `import { rewrite } from "${rewriteSpecifier}";\n` +
        `export function run() { return rewrite(); }\n`,
    },
    {
      path: "src/engine/rtkRewrite.ts",
      content: `export function rewrite(): string { return "rewritten"; }\n`,
    },
  ];
  const result = unwiredEngineModules(files, ["src/entry.ts"]);
  assert.ok(
    !result.includes("src/engine/rtkRewrite.ts"),
    `expected src/engine/rtkRewrite.ts to be excluded, got ${JSON.stringify(result)}`,
  );
});
