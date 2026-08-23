/**
 * unreachedEngineModules follows reach transitively from the product entry
 * src/extension.ts: an engine module imported only by another unreached
 * engine module is itself returned as unreached.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { unreachedEngineModules, type RepoFile } from "./engineWiring";

function pathOf(m: string | { path: string }): string {
  return typeof m === "string" ? m : m.path;
}

test("reach is transitive from the product entry", () => {
  const files: RepoFile[] = [
    { path: "src/extension.ts", content: `import { top } from "./engine/top";` },
    { path: "src/engine/top.ts", content: `import { mid } from "./mid";\nexport const top = mid;` },
    { path: "src/engine/mid.ts", content: `export const mid = 1;` },
  ];

  const reached = unreachedEngineModules({ entry: "src/extension.ts", files }).map(pathOf);
  assert.ok(!reached.includes("src/engine/top.ts"));
  assert.ok(
    !reached.includes("src/engine/mid.ts"),
    "a module reached through another reached module must not be unreached",
  );
});

test("reach does not launder through an unreached module", () => {
  const files: RepoFile[] = [
    { path: "src/extension.ts", content: `export const entry = 1;` },
    { path: "src/engine/a.ts", content: `import { b } from "./b";\nexport const a = b;` },
    { path: "src/engine/b.ts", content: `export const b = 1;` },
  ];

  const unreached = unreachedEngineModules({ entry: "src/extension.ts", files }).map(pathOf);
  assert.ok(unreached.includes("src/engine/a.ts"));
  assert.ok(
    unreached.includes("src/engine/b.ts"),
    "b is imported only by the unreached a.ts, so b must be reported unreached too",
  );
});
