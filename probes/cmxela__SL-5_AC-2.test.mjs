// WHY (INVARIANT): reach must be transitive from the product entry point —
// an engine module that is only imported by another engine module which is
// itself unreached must not be laundered into "reached" just because
// something imports it. This must hold for as long as the checker exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unreachedEngineModules } from "../out-test/gates/engineWiring.js";

const RELPATH = ["." , "/engine/used"].join("");
const RELPATH_ORPHAN_ROOT = ["." , "/orphanRoot"].join("");

test("unreachedEngineModules follows reach transitively from src/extension.ts", () => {
  const files = [
    {
      path: "src/extension.ts",
      content: `import { used } from "${RELPATH}";\nused();\n`,
    },
    { path: "src/engine/used.ts", content: `export function used() {}\n` },
    {
      path: "src/engine/orphanRoot.ts",
      content: `export function orphanRoot() {}\n`,
    },
    {
      path: "src/engine/orphanLeaf.ts",
      content: `import { orphanRoot } from "${RELPATH_ORPHAN_ROOT}";\nexport function orphanLeaf() { orphanRoot(); }\n`,
    },
  ];

  const result = unreachedEngineModules({ entry: "src/extension.ts", files });
  const paths = result.map((m) => (typeof m === "string" ? m : m.path));

  assert.ok(
    paths.includes("src/engine/orphanRoot.ts"),
    "orphanRoot is only imported by an unreached engine module, so it must itself be unreached",
  );
  assert.ok(
    paths.includes("src/engine/orphanLeaf.ts"),
    "orphanLeaf is not reached from the product entry either, so it must be reported unreached too",
  );
  assert.ok(
    !paths.includes("src/engine/used.ts"),
    "used is reached directly from the product entry and must not be reported",
  );
});
