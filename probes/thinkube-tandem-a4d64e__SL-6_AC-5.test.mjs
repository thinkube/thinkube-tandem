// WHY (TRANSITION): deactivate() used to dispose one module-level `panel`;
// this proves it now disposes the SpaceTabs register instead, so a tab left
// open never outlives the extension. src/extension.ts imports the real
// "vscode" module at the top level and cannot be loaded under plain
// node:test (no vscode module is resolvable outside the running editor —
// the effect of a real shutdown is not this probe's to perform), so this
// reads deactivate's source text: the one seam this probe can honestly
// observe without starting the extension host.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/extension.ts", import.meta.url), "utf8");

function bodyOf(fnName) {
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

test("deactivate disposes the tab register rather than a single panel", () => {
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
