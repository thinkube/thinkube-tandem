/**
 * Unit tests for the prompt-template loader (context tranche, 2026-07-14) — the resolution
 * order (repo override → configured dir → plugin dirs → undefined), the `<!-- if:… -->`
 * conditionals, and the marketplace-registry plugin-dir discovery. All hermetic: every test
 * pins `pluginDirs` (or a fake homedir), so the machine's real installed plugin never leaks in.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  applyConditionals,
  configurePromptTemplates,
  loadTemplate,
  pluginTemplateDirs,
} from "./promptTemplates";

/** A throwaway dir with the given files (rel path → content). */
function tmpDirWith(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-tpl-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return dir;
}

test("loadTemplate: the repo's .tandem/prompts override wins over the configured dir and plugin dirs", (t) => {
  t.after(() => configurePromptTemplates({}));
  const repo = tmpDirWith({
    ".tandem/prompts/worker-preamble.md": "REPO OVERRIDE PROSE",
  });
  const doctrine = tmpDirWith({ "worker-preamble.md": "DOCTRINE DIR PROSE" });
  const plugin = tmpDirWith({ "worker-preamble.md": "PLUGIN PROSE" });
  configurePromptTemplates({
    repoDir: repo,
    templateDir: doctrine,
    pluginDirs: [plugin],
  });
  assert.equal(loadTemplate("worker-preamble"), "REPO OVERRIDE PROSE");
});

test("loadTemplate: falls to the configured doctrine dir when the repo has no override, then to plugin dirs", (t) => {
  t.after(() => configurePromptTemplates({}));
  const repo = tmpDirWith({}); // no .tandem/prompts
  const doctrine = tmpDirWith({ "audit-rules.md": "DOCTRINE RULES" });
  const plugin = tmpDirWith({
    "audit-rules.md": "PLUGIN RULES",
    "intent-check.md": "PLUGIN INTENT",
  });
  configurePromptTemplates({
    repoDir: repo,
    templateDir: doctrine,
    pluginDirs: [plugin],
  });
  assert.equal(loadTemplate("audit-rules"), "DOCTRINE RULES");
  // Not in repo or doctrine dir → the plugin dir serves it.
  assert.equal(loadTemplate("intent-check"), "PLUGIN INTENT");
});

test("loadTemplate: returns undefined when nothing resolves — the caller's bundled fallback then applies", (t) => {
  t.after(() => configurePromptTemplates({}));
  configurePromptTemplates({ repoDir: tmpDirWith({}), pluginDirs: [] });
  assert.equal(loadTemplate("worker-preamble"), undefined);
  assert.equal(loadTemplate("no-such-template"), undefined);
});

test("loadTemplate: a blank template file reads as absent (never an empty preamble)", (t) => {
  t.after(() => configurePromptTemplates({}));
  const repo = tmpDirWith({ ".tandem/prompts/worker-preamble.md": "   \n\n" });
  configurePromptTemplates({ repoDir: repo, pluginDirs: [] });
  assert.equal(loadTemplate("worker-preamble"), undefined);
});

test("applyConditionals: keeps a flagged-on section (markers stripped) and drops a flagged-off one", () => {
  const text = [
    "always",
    "<!-- if:tep -->",
    "tep-only line",
    "<!-- endif:tep -->",
    "tail",
  ].join("\n");
  const on = applyConditionals(text, { tep: true });
  assert.match(on, /tep-only line/);
  assert.doesNotMatch(on, /<!--/);
  const off = applyConditionals(text, { tep: false });
  assert.doesNotMatch(off, /tep-only line/);
  assert.doesNotMatch(off, /<!--/);
  assert.match(off, /always/);
  assert.match(off, /tail/);
});

test("pluginTemplateDirs: discovers templates/ under each marketplace installLocation carrying the plugin", () => {
  const home = tmpDirWith({});
  const mp = tmpDirWith({
    "plugins/tandem-methodology/templates/worker-preamble.md": "x",
  });
  const mpNoPlugin = tmpDirWith({ "readme.md": "no plugin here" });
  fs.mkdirSync(path.join(home, ".claude", "plugins"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".claude", "plugins", "known_marketplaces.json"),
    JSON.stringify({
      thinkube: { installLocation: mp },
      other: { installLocation: mpNoPlugin },
      broken: {},
    }),
    "utf8",
  );
  assert.deepEqual(pluginTemplateDirs(home), [
    path.join(mp, "plugins", "tandem-methodology", "templates"),
  ]);
  // Absent registry → [] (never a throw).
  assert.deepEqual(pluginTemplateDirs(tmpDirWith({})), []);
});
