/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Whether a check's run shows that a test of it was executed.
 *
 * An exit code of 0 says the command ended well, not that it tested
 * anything. A runner handed a file it does not collect — pytest given a
 * JavaScript file, a runner given an extension it does not handle — runs
 * nothing, and some runners then exit 0. A check is green only when the
 * runner's own words show at least one of its tests ran and passed.
 *
 * Three answers:
 * - `ran`: the output reports a test that ran (a pass count above zero,
 *   a TAP `ok` line, a `PASS` line).
 * - `none`: the output says that no test ran or none was collected.
 * - `silent`: the output says neither; nothing shows a test ran.
 */

/** What runners print when they ran nothing. */
const NOTHING_RAN = [
  /\bno tests ran\b/i,
  /\bcollected 0 items\b/,
  /^ERROR: not found:/m,
  /^(# |ℹ )tests 0\b/m,
  /\bNo tests found\b/,
  /\bNo test files found\b/,
  /\bno test files\b/,
  /\btesting: warning: no tests to run\b/,
  /^\s*0 passing\b/m,
  /\b0 examples\b/,
  /\btest result: ok\. 0 passed\b/,
  /\bTests?:\s+0 total\b/,
];

/** What runners print when a test ran. */
const A_TEST_RAN = [
  /\b[1-9]\d* passed\b/,
  /^(# |ℹ )pass [1-9]/m,
  /^ok \d+\b/m,
  /^\s*✔ /m,
  /^--- PASS\b/m,
  /^PASS\b/m,
  /^ok\s+\S+\s+[\d.]+s\b/m,
  /\b[1-9]\d* passing\b/,
  /\b[1-9]\d* examples?, 0 failures\b/,
  /\btest result: ok\. [1-9]\d* passed\b/,
];

export type TestsRan = "ran" | "none" | "silent";

export function testsRanIn(output: string): TestsRan {
  if (A_TEST_RAN.some((r) => r.test(output))) return "ran";
  if (NOTHING_RAN.some((r) => r.test(output))) return "none";
  return "silent";
}

/**
 * The verdict of a check whose command exited 0, read from its output:
 * green only when a test of it ran; otherwise not green, with the reason.
 * `unjudged` marks a run that shows nothing either way.
 */
export function greenOnlyWhenRan(output: string): { pass: true } | { pass: false; why: string; unjudged?: true } {
  const said = testsRanIn(output);
  if (said === "ran") return { pass: true };
  if (said === "none")
    return {
      pass: false,
      why: "the runner executed no test of this check (it reported that no test ran or none was collected) — a check that ran nothing proves nothing",
    };
  return {
    pass: false,
    unjudged: true,
    why: "the runner exited 0 without showing any test of this check run — nothing was judged",
  };
}
