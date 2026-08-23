/**
 * unreachedEngineModules, given a synthetic { path, content } map, returns an
 * engine module that only test files import, and does not return one that a
 * product module imports.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { unreachedEngineModules, type RepoFile } from "./engineWiring";

function pathOf(m: string | { path: string }): string {
  return typeof m === "string" ? m : m.path;
}

test("a module only a test file imports is unreached; one a product module imports is not", () => {
  const files: RepoFile[] = [
    { path: "src/extension.ts", content: `import { wired } from "./engine/wired";` },
    { path: "src/engine/wired.ts", content: `export const wired = 1;` },
    { path: "src/engine/orphan.ts", content: `export const orphan = 1;` },
    { path: "src/engine/orphan.test.ts", content: `import { orphan } from "./orphan";` },
  ];

  const unreached = unreachedEngineModules({ entry: "src/extension.ts", files }).map(pathOf);

  assert.ok(
    unreached.includes("src/engine/orphan.ts"),
    "a module only a test imports must be reported unreached",
  );
  assert.ok(
    !unreached.includes("src/engine/wired.ts"),
    "a module the product entry imports must not be reported unreached",
  );
});
