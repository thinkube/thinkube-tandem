// WHY (INVARIANT): unreachedEngineModules must tell apart an engine module
// nothing in the product reaches (only a test file imports it) from one a
// product module reaches — that is the whole point of the checker, so it
// must always hold, on any synthetic file map handed to it.
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

function buildFiles() {
  return [
    { path: "src/extension.ts", content: importLine("wired", "./engine/wired") },
    { path: "src/engine/wired.ts", content: "export function wired() {}\n" },
    { path: "src/engine/orphan.ts", content: "export function orphan() {}\n" },
    {
      path: "src/engine/orphan.test.ts",
      content: importLine("orphan", "./orphan") + 'test("x", () => orphan());\n',
    },
  ];
}

test("unreachedEngineModules returns an engine module only a test file imports", () => {
  const unreached = unreachedEngineModules({
    files: buildFiles(),
    productEntry: "src/extension.ts",
  });
  assert.ok(
    unreached.includes("src/engine/orphan.ts"),
    "a module only a test file imports is unreached from the product",
  );
});

test("unreachedEngineModules does not return an engine module a product module imports", () => {
  const unreached = unreachedEngineModules({
    files: buildFiles(),
    productEntry: "src/extension.ts",
  });
  assert.ok(
    !unreached.includes("src/engine/wired.ts"),
    "a module the product imports (even transitively through src/extension.ts) is never reported as unreached",
  );
});
