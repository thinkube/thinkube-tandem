// WHY (INVARIANT): the wiring checker's whole job is to tell apart an engine
// module nothing in the product reaches from one a product module actually
// imports — a test-only importer must never count as reach, and a real
// product importer must always count as reach. This distinction must hold
// for as long as the checker exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unreachedEngineModules } from "../out-test/gates/engineWiring.js";

const RELPATH = ["." , "/engine/used"].join("");
const RELPATH_ORPHAN = ["." , "/orphan"].join("");

test("unreachedEngineModules returns an engine module that only test files import", () => {
  const files = [
    { path: "src/extension.ts", content: `import { used } from "${RELPATH}";\nused();\n` },
    { path: "src/engine/used.ts", content: `export function used() {}\n` },
    { path: "src/engine/orphan.ts", content: `export function orphan() {}\n` },
    {
      path: "src/engine/orphan.test.ts",
      content: `import { orphan } from "${RELPATH_ORPHAN}";\norphan();\n`,
    },
  ];

  const result = unreachedEngineModules({ entry: "src/extension.ts", files });
  const paths = result.map((m) => (typeof m === "string" ? m : m.path));

  assert.ok(
    paths.includes("src/engine/orphan.ts"),
    "an engine module imported only by a test file must be reported unreached",
  );
});

test("unreachedEngineModules does not return an engine module a product module imports", () => {
  const files = [
    { path: "src/extension.ts", content: `import { used } from "${RELPATH}";\nused();\n` },
    { path: "src/engine/used.ts", content: `export function used() {}\n` },
    { path: "src/engine/orphan.ts", content: `export function orphan() {}\n` },
    {
      path: "src/engine/orphan.test.ts",
      content: `import { orphan } from "${RELPATH_ORPHAN}";\norphan();\n`,
    },
  ];

  const result = unreachedEngineModules({ entry: "src/extension.ts", files });
  const paths = result.map((m) => (typeof m === "string" ? m : m.path));

  assert.ok(
    !paths.includes("src/engine/used.ts"),
    "an engine module a product module imports must not be reported unreached",
  );
});
