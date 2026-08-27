/**
 * INVARIANT: a module reached only through a barrel re-export has no
 * product caller. unwiredEngineModules must not credit
 * `src/engine/core/watchdog.ts` with a caller merely because
 * `orchestratorCore.ts` re-exports it and some product file imports an
 * unrelated named type from that barrel — the barrel hop must not launder
 * an unreachable module into "wired". This must hold forever: any future
 * traversal change that starts crediting barrel re-exports as callers
 * would silently hide dead engine modules from the ledger.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { unwiredEngineModules } from "./engineWiring";

test("unwiredEngineModules returns a module reached only via a barrel re-export, not by a real caller", () => {
  const barrelSpecifier = [".", "engine", "orchestratorCore"].join("/");
  const watchdogSpecifier = [".", "core", "watchdog"].join("/");
  const files = [
    {
      path: "src/entry.ts",
      content:
        `import type { UnrelatedType } from "${barrelSpecifier}";\n` +
        `export function run(x: UnrelatedType) { return x; }\n`,
    },
    {
      path: "src/engine/orchestratorCore.ts",
      content:
        `export * from "${watchdogSpecifier}";\n` +
        `export interface UnrelatedType { id: string }\n`,
    },
    {
      path: "src/engine/core/watchdog.ts",
      content: `export function watch(): void {}\n`,
    },
  ];
  const result = unwiredEngineModules(files, ["src/entry.ts"]);
  assert.ok(
    result.includes("src/engine/core/watchdog.ts"),
    `expected src/engine/core/watchdog.ts among unwired modules, got ${JSON.stringify(result)}`,
  );
});
