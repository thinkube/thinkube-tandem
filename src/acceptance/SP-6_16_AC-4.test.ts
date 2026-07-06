/**
 * SP-6/16 (TEP-6) AC4 — the content-read + undefined-fallback for the canonical example test
 * live in the resolver (the pure-probeable unit), so the prompt stays backward-compatible.
 *
 * The defect this closes: every held-out `role: test` worker independently rediscovers the repo's
 * test idiom each run. The fix declares a canonical example test ONCE in `.tandem/conventions.json`
 * (a repo-relative `testExample` path, peer to `acceptanceProbe` / `selfVerify`) and injects its
 * CONTENT into every test-worker prompt. This AC pins the sourcing seam: `defaultAcceptanceRecipeResolver`
 * resolves that declared path against `cwd`, reads the file, and returns its content as
 * `AcceptanceRecipe.testExample` — while a missing / blank / unreadable declaration yields
 * `testExample: undefined`.
 *
 * Verified PURELY against the SP-6/16 SPEC CONTRACT — the exported, vscode-free
 * `defaultAcceptanceRecipeResolver(cwd): Promise<AcceptanceRecipe | undefined>` in
 * `src/services/auditorRunner.ts`, and the `AcceptanceRecipe.testExample?: string` field:
 *
 *   - When `.tandem/conventions.json` declares a NON-BLANK string `testExample`, resolve it against
 *     `cwd`, read that file, and return its content in `recipe.testExample`.
 *   - When the `testExample` key is ABSENT / BLANK, OR the target file is UNREADABLE / MISSING,
 *     `recipe.testExample` is `undefined` (the rest of the recipe is unchanged; the existing
 *     acceptanceProbe / selfVerify resolution is untouched).
 *
 * Each case builds its OWN temp `cwd` fixture on disk — the probe never reads the real repo's
 * `.tandem/conventions.json`. To make the resolver return a recipe OBJECT at all (rather than the
 * top-level `undefined` it returns when no valid `acceptanceProbe` is declared), every fixture
 * declares a valid `acceptanceProbe`; `testExample` is then asserted as a peer field on that recipe.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  defaultAcceptanceRecipeResolver,
  type AcceptanceRecipe,
} from "../services/auditorRunner";

// A valid held-out acceptance-probe declaration — present in EVERY fixture so the resolver returns a
// recipe object we can inspect for `testExample` (the resolver returns undefined outright with no
// valid `acceptanceProbe`). Its own resolution is the untouched pre-existing behaviour.
const ACCEPTANCE_PROBE = {
  sourcePath: "src/acceptance/SP-{spec}_AC-{ac}.test.ts",
  run: "node --test out-test/acceptance/SP-{spec}_AC-{ac}.test.js",
};

// A realistic canonical example test — multi-line with quotes and indentation, so a byte-for-byte
// content read is meaningfully distinct from any re-formatting. This is the repo's
// fixture-construction + assertion idiom the test-author is meant to copy.
const EXAMPLE_CONTENT = [
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  "",
  'import { widget } from "../services/widget";',
  "",
  'test("widget doubles its input", () => {',
  "  assert.equal(widget(2), 4);",
  "});",
  "",
].join("\n");

/**
 * Build a fresh temp `cwd` whose `.tandem/conventions.json` carries the given fields (merged with a
 * valid `acceptanceProbe`), plus any extra source files. Returns the cwd path; the caller reads it
 * through the resolver. Registered for cleanup at process exit.
 */
const tmpDirs: string[] = [];
function makeCwd(
  conventions: Record<string, unknown>,
  files: Record<string, string> = {},
): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tk-testexample-"));
  tmpDirs.push(cwd);
  const tandemDir = path.join(cwd, ".tandem");
  fs.mkdirSync(tandemDir, { recursive: true });
  fs.writeFileSync(
    path.join(tandemDir, "conventions.json"),
    JSON.stringify(
      { acceptanceProbe: ACCEPTANCE_PROBE, ...conventions },
      null,
      2,
    ),
  );
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(cwd, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return cwd;
}

process.on("exit", () => {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup of temp fixtures */
    }
  }
});

// ── the core case: a declared testExample path → the file's CONTENT in recipe.testExample ─────────

test("AC4: a declared non-blank testExample path resolves against cwd and returns the file's content verbatim", async () => {
  const cwd = makeCwd(
    { testExample: "src/acceptance/example.test.ts" },
    { "src/acceptance/example.test.ts": EXAMPLE_CONTENT },
  );

  const recipe = await defaultAcceptanceRecipeResolver(cwd);
  assert.ok(
    recipe,
    "a fixture with a valid acceptanceProbe must yield a recipe object",
  );
  assert.equal(
    recipe.testExample,
    EXAMPLE_CONTENT,
    "recipe.testExample must be the declared file's content, byte-for-byte",
  );
});

test("AC4: the declared testExample is resolved RELATIVE to cwd (a nested path is read from the right file)", async () => {
  // A distinct nested path + distinct content proves the resolver reads the DECLARED file at the
  // DECLARED (cwd-relative) location, not some fixed/guessed path.
  const nestedContent = "// the canonical probe idiom\nconst answer = 42;\n";
  const cwd = makeCwd(
    { testExample: "tests/idiom/canonical.spec.ts" },
    { "tests/idiom/canonical.spec.ts": nestedContent },
  );

  const recipe = await defaultAcceptanceRecipeResolver(cwd);
  assert.ok(recipe);
  assert.equal(
    recipe.testExample,
    nestedContent,
    "the nested declared path is resolved against cwd and its content returned",
  );
});

test("AC4: with testExample set, the rest of the recipe is UNCHANGED (acceptanceProbe resolution untouched)", async () => {
  const cwd = makeCwd(
    {
      testExample: "src/acceptance/example.test.ts",
      selfVerify: "npm run verify",
    },
    { "src/acceptance/example.test.ts": EXAMPLE_CONTENT },
  );

  const recipe = await defaultAcceptanceRecipeResolver(cwd);
  assert.ok(recipe);
  const expected: AcceptanceRecipe = {
    sourcePath: ACCEPTANCE_PROBE.sourcePath,
    run: ACCEPTANCE_PROBE.run,
    prepare: undefined,
    selfVerify: "npm run verify",
    testExample: EXAMPLE_CONTENT,
  };
  // The pre-existing fields resolve exactly as before; testExample is a purely additive peer.
  assert.equal(recipe.sourcePath, expected.sourcePath);
  assert.equal(recipe.run, expected.run);
  assert.equal(recipe.selfVerify, expected.selfVerify);
  assert.equal(recipe.testExample, expected.testExample);
});

// ── the undefined-fallback cases: absent / blank / unreadable / missing ───────────────────────────

test("AC4: an ABSENT testExample key yields recipe.testExample === undefined (recipe otherwise intact)", async () => {
  const cwd = makeCwd({}); // acceptanceProbe only — no testExample declared

  const recipe = await defaultAcceptanceRecipeResolver(cwd);
  assert.ok(recipe, "the recipe still resolves from acceptanceProbe");
  assert.equal(
    recipe.testExample,
    undefined,
    "no testExample declaration → testExample is undefined",
  );
  // The rest of the recipe is unaffected by the missing declaration.
  assert.equal(recipe.sourcePath, ACCEPTANCE_PROBE.sourcePath);
  assert.equal(recipe.run, ACCEPTANCE_PROBE.run);
});

test("AC4: a BLANK / whitespace testExample declaration is treated as absent (undefined)", async () => {
  for (const blank of ["", "   ", "\n\t "]) {
    // Even if a file happened to exist, a blank declaration must never be dereferenced.
    const cwd = makeCwd({ testExample: blank });
    const recipe = await defaultAcceptanceRecipeResolver(cwd);
    assert.ok(recipe);
    assert.equal(
      recipe.testExample,
      undefined,
      `a blank testExample (${JSON.stringify(blank)}) must yield undefined`,
    );
  }
});

test("AC4: a NON-STRING testExample declaration is treated as absent (undefined)", async () => {
  // Only a non-blank STRING declaration is honoured; a number/array/object is ignored, not crashed on.
  for (const bad of [42, ["a"], { path: "x" }, true, null]) {
    const cwd = makeCwd({ testExample: bad });
    const recipe = await defaultAcceptanceRecipeResolver(cwd);
    assert.ok(recipe);
    assert.equal(
      recipe.testExample,
      undefined,
      `a non-string testExample (${JSON.stringify(bad)}) must yield undefined`,
    );
  }
});

test("AC4: a testExample pointing at a MISSING file yields undefined (unreadable declaration)", async () => {
  // The declaration is present + non-blank, but no file exists at the resolved path.
  const cwd = makeCwd({ testExample: "src/acceptance/does-not-exist.test.ts" });

  const recipe = await defaultAcceptanceRecipeResolver(cwd);
  assert.ok(recipe, "an unreadable testExample must not sink the whole recipe");
  assert.equal(
    recipe.testExample,
    undefined,
    "a testExample whose file is missing → undefined (fallback), rest of recipe intact",
  );
  assert.equal(recipe.sourcePath, ACCEPTANCE_PROBE.sourcePath);
  assert.equal(recipe.run, ACCEPTANCE_PROBE.run);
});

test("AC4: a testExample pointing at a DIRECTORY (unreadable as a file) yields undefined", async () => {
  // The declared path exists but is a directory — reading it as a file fails; the resolver must
  // fall back to undefined rather than throw.
  const cwd = makeCwd({ testExample: "src/acceptance" });
  fs.mkdirSync(path.join(cwd, "src", "acceptance"), { recursive: true });

  const recipe = await defaultAcceptanceRecipeResolver(cwd);
  assert.ok(recipe);
  assert.equal(
    recipe.testExample,
    undefined,
    "an unreadable (directory) target → testExample undefined",
  );
});

// ── the fallback is MEANINGFUL — a readable declaration DOES surface content ───────────────────────

test("AC4: the undefined-fallback is caused by unreadability, not by the field never populating (control)", async () => {
  // Control against the missing/blank cases above: the SAME resolver, given a readable declared
  // file, returns its content — so the `undefined` results are genuinely the fallback, not a field
  // that never gets set.
  const marker =
    "// SENTINEL EXAMPLE — proves the read path populates testExample\n";
  const cwd = makeCwd(
    { testExample: "example.test.ts" },
    { "example.test.ts": marker },
  );

  const recipe = await defaultAcceptanceRecipeResolver(cwd);
  assert.ok(recipe);
  assert.equal(recipe.testExample, marker);
});
