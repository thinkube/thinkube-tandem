/**
 * SP-6/17 (TEP-6) AC3 — `THINKUBE_APPROVAL_DIR` is **fully removed** from the extension source.
 *
 * A content search over the `src` directory (relative to the repository root — `process.cwd()` when
 * the closing gate runs `node --test out-test/acceptance/SP-6_17_AC-3.test.js`), EXCLUDING
 * `src/acceptance/`, must find ZERO occurrences of the token: no env read, no injection site, no
 * lingering comment.
 *
 * The search token is assembled from parts so THIS probe file does not self-match (belt-and-braces
 * on top of the `acceptance/` exclusion). grep's exit codes are handled precisely: 0 = matches found
 * (fail with the offending lines), 1 = no match (the success we assert), 2+ = a real search error
 * (rethrow — a blanket catch would mask a broken search as a false pass).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as path from "node:path";

// Assembled from parts so the probe's own source cannot match the search.
const TOKEN = ["THINKUBE", "APPROVAL", "DIR"].join("_");

test("no THINKUBE_APPROVAL_DIR reference remains anywhere in src/ (excluding src/acceptance/)", () => {
  const srcDir = path.join(process.cwd(), "src");

  let matches: string;
  try {
    // grep exit 0 → matches found; execFileSync returns their text on stdout.
    matches = execFileSync(
      "grep",
      ["-rn", "--exclude-dir=acceptance", TOKEN, srcDir],
      { encoding: "utf8" },
    );
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 1) return; // exit 1 = no match = success
    throw err; // exit 2+ (or a spawn error) = broken search → surface it, never swallow
  }

  assert.fail(
    `Expected zero occurrences of ${TOKEN} in src/ (excluding src/acceptance/), but found:\n${matches}`,
  );
});
