/**
 * Unit tests for the pure `sectionPatch` helper (SP-th1ddy_SL-1). Run via the
 * repo recipe — compiled to out-test/ by `tsconfig.test.json` and executed with
 * Node's built-in runner (`node --test`). No external framework: `sectionPatch`
 * is a pure `body -> body` function, so `node:test` + `node:assert` suffice.
 *
 * What `patch_spec_section` promises (the AC this test arms):
 *  1. it replaces exactly ONE named section of a spec body, leaving every other
 *     section byte-identical; and
 *  2. the rewritten body still goes through the secret-scanning safe-write path,
 *     so a planted secret in the new content is refused.
 *
 * `sectionPatch` itself is pure (no I/O, no scanning) — the write goes through
 * `ThinkubeStore.writeFile`, whose boundary is `scanForSecrets` (the only
 * board-write applying the scan). So we verify (2) by feeding the patched body
 * to that exact production scanner and asserting it refuses — i.e. the body the
 * safe-write path would reject.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { sectionPatch } from "./sectionPatch";
import { scanForSecrets } from "../store/frontmatter";

/**
 * A multi-section spec body (no frontmatter — `writeFile` carries that
 * separately, so `sectionPatch` operates on the body alone). "Design" sits in
 * the interior: a real section before it and after it, so a correct patch must
 * leave both neighbours untouched.
 */
const BODY = `# patch_spec_section demo spec

Intro paragraph that belongs to no section.

## Acceptance Criteria

- [ ] First criterion
- [ ] Second criterion

## Design

The original design text.

Second paragraph of design.

## Constraints

- Stay pure.

## File Structure Plan

- \`a.ts\` — the helper.
`;

/**
 * Independent extraction of one `## Title` section (heading line through the
 * line before the next level-≤2 heading, or EOF). Deliberately re-derived in
 * the test — not reusing `sectionPatch`'s internals — so "byte-identical" is
 * checked against an independent reading of the bytes.
 */
function sectionSlice(body: string, title: string): string | null {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${title}`);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s+\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

test("sectionPatch replaces exactly the named section's content", () => {
  const patched = sectionPatch(BODY, "Design", "Completely new design body.");

  // The new content is present; neither paragraph of the old content survives.
  assert.match(patched, /Completely new design body\./);
  assert.doesNotMatch(patched, /The original design text\./);
  assert.doesNotMatch(patched, /Second paragraph of design\./);

  // The section heading itself is preserved — only its body was swapped.
  assert.match(patched, /^## Design$/m);
});

test("sectionPatch leaves every other section byte-identical", () => {
  const patched = sectionPatch(BODY, "Design", "Completely new design body.");

  for (const title of [
    "Acceptance Criteria",
    "Constraints",
    "File Structure Plan",
  ]) {
    const before = sectionSlice(BODY, title);
    const after = sectionSlice(patched, title);
    assert.notEqual(before, null, `fixture must contain "## ${title}"`);
    assert.equal(
      after,
      before,
      `section "## ${title}" must be byte-identical after patching Design`,
    );
  }
});

test("planted secret in the patched body is refused by the safe-write scan", () => {
  // A valid classic GitHub PAT shape (ghp_ + 36 alnum) — exactly what
  // scanForSecrets refuses on the way to disk.
  const planted = "ghp_" + "x".repeat(36);
  assert.equal(
    planted.length,
    40,
    "guard: planted token is a well-formed ghp_ PAT",
  );

  const patched = sectionPatch(BODY, "Design", `Token follows: ${planted}\n`);

  // The secret survives into the body the safe-write path would receive...
  assert.match(patched, new RegExp(planted));
  // ...and that exact production scanner refuses it (≥1 match ⇒ writeFile throws
  // SECRET_REFUSED unless allowSecrets:true).
  const hits = scanForSecrets(patched);
  assert.ok(
    hits.some((h) => h.pattern === "github-pat-classic"),
    "scanForSecrets must flag the planted github-pat-classic token",
  );

  // Sanity: an innocuous patch passes the same scan (no false refusal).
  const clean = sectionPatch(BODY, "Design", "Just a harmless paragraph.\n");
  assert.equal(scanForSecrets(clean).length, 0);
});
