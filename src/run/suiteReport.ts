/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * An actor's report that the repository's whole suite is red.
 *
 * The closing gate does not run a suite the platform's pipeline runs; an
 * actor at the gate may run it anyway and see it red. That is a red suite
 * the gate must not merge past, so the actor says it in one line of a
 * fixed shape, naming the failing test files, and the gate reads that
 * line — never the actor's prose.
 */

const PREFIX = "SUITE RED:";

/** The instruction the closer and the finisher carry, in one place. */
export const SUITE_RED_RULE = [
  "If you ran the repository's whole suite and it was red, say so in one line of its own:",
  "    SUITE RED: <test file>, <test file>, ...",
  "naming every test file that failed, as the runner named it. Write that line whether or not",
  "the failures are yours to fix. The delivery is not merged while it stands. Write nothing of the",
  "kind when the suite was green or you did not run it.",
].join("\n");

/** The failing test files a report names on its `SUITE RED:` lines;
 *  nothing when it has none. A line naming no file is still a red suite. */
export function suiteRedIn(text: string): { files: string[] } | undefined {
  let red = false;
  const files = new Set<string>();
  for (const line of (text ?? "").split(/\r?\n/)) {
    const stripped = line.replace(/^\s*(?:[-*+]|\d+[.)])?\s*/, "").replace(/^\*\*/, "");
    if (!stripped.toUpperCase().startsWith(PREFIX)) continue;
    red = true;
    for (const f of stripped.slice(PREFIX.length).split(/[,\s]+/)) {
      const file = f.replace(/^[`'"*]+|[`'"*.;:]+$/g, "").replace(/::.*$/, "");
      if (file) files.add(file);
    }
  }
  return red ? { files: [...files] } : undefined;
}
