/**
 * SP-6/20 (TEP-6) AC3 — the retired env var is **fully removed** from the extension source.
 *
 * SP-6/20 derives the control dir lexically (`resolveControlDir(process.argv[1])`) at both
 * `open_review` / `start_spec_worktree` call sites and retires the env var end-to-end: the
 * `CONTROL_DIR_ENV` export leaves `controlRequests.ts`, `machineConfig.ts`'s `kanbanServerEntry`
 * env stops carrying `THINKUBE_CONTROL_DIR`, and the stale comments / error strings naming the
 * variable are gone. So a content search over `src/` (relative to the repository root —
 * `process.cwd()` when the closing gate runs `node --test out-test/acceptance/SP-6_20_AC-3.test.js`),
 * EXCLUDING `src/acceptance/`, must find ZERO occurrences of EITHER token — the env name
 * (`THINKUBE_CONTROL_DIR`) or the retired export symbol (`CONTROL_DIR_ENV`).
 *
 * Each token is assembled from parts so THIS probe file does not self-match (belt-and-braces on
 * top of the `acceptance/` exclusion). grep's exit codes are handled precisely: 0 = matches found
 * (fail with the offending lines), 1 = no match (the success we assert), 2+ = a real search error
 * (rethrow — a blanket catch would mask a broken search as a false pass).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as path from "node:path";

// Assembled from parts so the probe's own source cannot match the search.
const ENV_TOKEN = ["THINKUBE", "CONTROL", "DIR"].join("_");
const EXPORT_TOKEN = ["CONTROL", "DIR", "ENV"].join("_");

test("no THINKUBE_CONTROL_DIR / CONTROL_DIR_ENV reference remains anywhere in src/ (excluding src/acceptance/)", () => {
  const srcDir = path.join(process.cwd(), "src");

  let matches: string;
  try {
    // grep exit 0 → matches found; execFileSync returns their text on stdout.
    // -e for each token so a single search covers both the env name and the export symbol.
    matches = execFileSync(
      "grep",
      [
        "-rn",
        "--exclude-dir=acceptance",
        "-e",
        ENV_TOKEN,
        "-e",
        EXPORT_TOKEN,
        srcDir,
      ],
      { encoding: "utf8" },
    );
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 1) return; // exit 1 = no match = success
    throw err; // exit 2+ (or a spawn error) = broken search → surface it, never swallow
  }

  assert.fail(
    `Expected zero occurrences of ${ENV_TOKEN} or ${EXPORT_TOKEN} in src/ ` +
      `(excluding src/acceptance/), but found:\n${matches}`,
  );
});
