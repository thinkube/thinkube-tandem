/**
 * `src/extension.ts` imports the real `vscode` module at the top level and
 * cannot be loaded under plain `node:test` (no `vscode` module is
 * resolvable outside the running editor). Its source text is the one seam
 * these checks can honestly observe without starting the extension host.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";

const repo = path.resolve(__dirname, "..");
const src = readFileSync(path.join(repo, "src", "extension.ts"), "utf8");

function bodyOf(fnName: string): string {
  const start = src.indexOf(`function ${fnName}(`);
  assert.ok(start >= 0, `${fnName} must be declared in src/extension.ts`);
  const braceStart = src.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(braceStart, i + 1);
    }
  }
  throw new Error(`unterminated body for ${fnName}`);
}

test("deactivate disposes the SpaceTabs register rather than a single panel, so no tab outlives the extension", () => {
  const body = bodyOf("deactivate");
  assert.ok(
    !/\bpanel\?\.dispose\(\)/.test(body) && !/\bpanel\.dispose\(\)/.test(body),
    "deactivate must no longer dispose a single module-level panel variable",
  );
  assert.ok(
    /(spaceTabs|tabs)\??\.dispose\(\)/i.test(body),
    "deactivate must dispose the SpaceTabs register so every open tab is closed",
  );
});
