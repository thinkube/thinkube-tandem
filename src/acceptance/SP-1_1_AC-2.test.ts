// SP-1/1 AC2 — no git-tracked file contains old extension identity strings after the rebrand.
//
// WHY (TRANSITION — proves the rename happened; once the rebrand ships this probe stays
// green permanently and its work is done):
// Before TEP-1/SP-1 the extension was published under the old package name and old
// command-palette category label. After the rebrand every git-tracked file must use the
// new identity instead. Four substrings/file-sets are deliberately exempted:
//   (a) "github.com/cmxela/<old-name>" — historical fixture URLs in sliceThinkingSpace.test.ts
//       pointing at real GitHub commits/PRs; they stay valid after a GitHub repo rename via
//       redirect, so renaming them would break the fixture intent.
//   (b) "Platform/extensions/<old-name>" — the on-disk container-directory path that this
//       spec intentionally does not rename; it is a separate ops action per TEP-1 Rollout.
//   (c) scripts/deploy.sh's one-time migration/uninstall step — the old EXTENSION ID
//       ("thinkube.<old-name>", the --uninstall-extension target and the old globalStorage
//       path being copied FROM) and the ".migrated-from-<old-name>" sentinel: removing the
//       old install requires naming it. Exemption is NARROW: only lines in scripts/deploy.sh
//       that contain the old extension id or migration sentinel; a missed rename elsewhere
//       in that file still fails.
//   (d) src/acceptance/SP-1_1_AC-*.test.ts — these probes must name the old identity to
//       prove its absence (e.g. building the grep pattern, naming carve-outs). They are
//       git-tracked once the slice lands. Only these specific acceptance probe files are
//       exempt; no other test file is.
//
// NOTE ON SELF-CONSISTENCY: the grep pattern and the literal old strings that appear
// elsewhere in this file are built via join() so the COMBINED literals never appear as
// raw substrings in the source — if they did, git grep would match THIS file and the test
// would flag itself as a violation. The carve-out constants for (a)/(b)/(c) are exempt
// because they contain the carve-out substrings (so git grep hits on those lines are
// filtered out). Carve-out (d) exempts the entire file by its path pattern.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Build pattern parts via join() so the full combined literals don't appear in this
// source file as searchable substrings — avoiding self-flagging under git grep.
//   OLD_PKG_NAME  assembles to: thinkube-ai-integration
//   OLD_CATEGORY  assembles to: Thinkube AI
const OLD_PKG_NAME = ["thinkube", "ai", "integration"].join("-");
const OLD_CATEGORY = ["Thinkube", "AI"].join(" ");
const GREP_PATTERN = `${OLD_PKG_NAME}|${OLD_CATEGORY}`;

// Carve-out (a): historical fixture URLs — these lines are allowed to remain.
// This constant itself contains the carve-out substring, so any git grep hit on
// this very line is correctly classified as exempt by the filter below.
const CARVEOUT_HISTORICAL_URL = "github.com/cmxela/thinkube-ai-integration";

// Carve-out (b): on-disk container-directory path — these lines are allowed to remain.
// Same self-consistent exemption: the constant contains the carve-out substring.
const CARVEOUT_DISK_PATH = "Platform/extensions/thinkube-ai-integration";

// Carve-out (c): the one-time migration/uninstall step in scripts/deploy.sh must name
// the old install to remove it. Deliberately NARROW — only the old extension id and the
// migration sentinel are exempt, so a missed rename elsewhere in deploy.sh (e.g. the
// VSIX filename variable) is still flagged. Built via join() for self-consistency.
const CARVEOUT_OLD_EXTENSION_ID = [
  "thinkube.thinkube",
  "ai",
  "integration",
].join("-");
const CARVEOUT_MIGRATION_SENTINEL = [
  ".migrated-from-thinkube",
  "ai",
  "integration",
].join("-");

// Carve-out (d): this spec's own acceptance probes must name the old identity to prove
// its absence (e.g. building the grep pattern, naming carve-out substrings). They become
// git-tracked once the slice lands. Exempt only these files — no other test file is exempt.
// Git grep output format is "<path>:<line>", so matching the file path prefix is exact.
const CARVEOUT_ACCEPTANCE_PROBE_PREFIX = "src/acceptance/SP-1_1_AC-";

// Resolve the repo root from this compiled file's location.
// The test compiles to out-test/acceptance/SP-1_1_AC-2.test.js, so __dirname is
// <repo>/out-test/acceptance/ and two levels up is the repo root.
const REPO_ROOT = path.resolve(__dirname, "../..");

test(
  "git grep finds no old-identity strings outside the four spec-defined carve-outs" +
    " (TRANSITION: done once rebrand ships)",
  () => {
    // git grep exit codes:
    //   0  — matches found (potential violations, must be filtered)
    //   1  — no matches (clean — test passes immediately)
    //   ≥2 — error (bad arguments, not a git repo, etc.)
    const result = spawnSync("git", ["grep", "-E", GREP_PATTERN], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    });

    // If spawnSync itself failed (e.g. git not on PATH), result.error is set.
    if (result.error) {
      assert.fail(
        `Failed to spawn 'git grep': ${result.error.message}. ` +
          `Ensure git is available and cwd is a git repo (resolved to: ${REPO_ROOT}).`,
      );
    }

    // Status ≥ 2 means a git error (not inside a git repo, malformed arguments, etc.)
    assert.ok(
      result.status !== null && result.status <= 1,
      `git grep exited with error status ${result.status ?? "null"}: ` +
        (result.stderr ?? "(no stderr)"),
    );

    // Status 1 = zero matches anywhere — no old-identity strings exist at all.
    if (result.status === 1) return;

    // Status 0 = matches found. Apply the four spec-defined carve-outs: any line that
    // falls under a carve-out is intentionally retained and not a violation.
    const hits = result.stdout
      .split("\n")
      .filter((line) => line.trim().length > 0);

    const violations = hits.filter(
      (line) =>
        // (a) historical fixture URLs in sliceThinkingSpace.test.ts
        !line.includes(CARVEOUT_HISTORICAL_URL) &&
        // (b) on-disk container-directory path (separate ops rename)
        !line.includes(CARVEOUT_DISK_PATH) &&
        // (c) scripts/deploy.sh one-time migration/uninstall step (narrow: only that file)
        !(
          line.startsWith("scripts/deploy.sh:") &&
          (line.includes(CARVEOUT_OLD_EXTENSION_ID) ||
            line.includes(CARVEOUT_MIGRATION_SENTINEL))
        ) &&
        // (d) this spec's own acceptance probes (must name old identity to prove its absence)
        !line.startsWith(CARVEOUT_ACCEPTANCE_PROBE_PREFIX),
    );

    assert.deepEqual(
      violations,
      [],
      `${violations.length} old-identity reference(s) remain in git-tracked files ` +
        `(expected 0 outside the four carve-outs):\n` +
        violations.map((v) => `  ${v}`).join("\n"),
    );
  },
);
