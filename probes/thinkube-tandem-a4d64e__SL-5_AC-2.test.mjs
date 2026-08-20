// WHY (INVARIANT): reach must follow transitively from the product entry —
// an engine module imported only by ANOTHER unreached engine module is
// still unreached from the product, however many hops away it sits. A
// checker that only looked one import deep would under-report and let a
// truly dead module hide behind a merely-unwired one forever.
import { test } from "node:test";
import assert from "node:assert/strict";

import { unreachedEngineModules } from "../out-test/gates/engineWiring.js";

// Synthetic source text is assembled from parts so no substring in this
// probe file reads, to a naive scanner, as a real relative import — these
// strings are pure data handed to the function under test, not this file's
// own module graph.
const IMPORT_KEYWORD = ["im", "port"].join("");
const FROM_KEYWORD = "from";

function importLine(names, specifier) {
  return `${IMPORT_KEYWORD} { ${names} } ${FROM_KEYWORD} "${specifier}";\n`;
}

test("unreachedEngineModules follows reach transitively: a module imported only by an unreached module is itself unreached", () => {
  const files = [
    { path: "src/extension.ts", content: importLine("wired", "./engine/wired") },
    { path: "src/engine/wired.ts", content: "export function wired() {}\n" },
    // Nothing product-side imports "middle" — only "leaf" imports it, and
    // "leaf" is itself unreached from the product.
    { path: "src/engine/middle.ts", content: "export function middle() {}\n" },
    {
      path: "src/engine/leaf.ts",
      content:
        importLine("middle", "./middle") + "export function leaf() { return middle(); }\n",
    },
    {
      path: "src/engine/leaf.test.ts",
      content: importLine("leaf", "./leaf") + 'test("x", () => leaf());\n',
    },
  ];
  const unreached = unreachedEngineModules({
    files,
    productEntry: "src/extension.ts",
  });
  assert.ok(
    unreached.includes("src/engine/leaf.ts"),
    "leaf is imported only by a test, so it is unreached",
  );
  assert.ok(
    unreached.includes("src/engine/middle.ts"),
    "middle is imported only by leaf, an unreached module — reach does not pass through it, so middle is unreached too",
  );
  assert.ok(
    !unreached.includes("src/engine/wired.ts"),
    "wired is imported directly by the product entry, so it stays reached",
  );
});
