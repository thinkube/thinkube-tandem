/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The single-check command that does not install again.
 *
 * A repository declares in `thinkube.yaml` how its pipeline runs one test
 * (`test.one`). The pipeline runs it in a fresh container, so it is often
 * a script that installs the requirements first and then runs the test
 * runner. In a run's tree the door has already run that installation once
 * (the repository's provisioning command), so the script repeats it for
 * every single check: 3.9 s against 1.5 s, on every one of about a hundred
 * check runs.
 *
 * When the declared command runs the same provisioning the door runs, and
 * the repository's own facts (`.tandem/setup.json` `runOne`) name another
 * single-check command, the door proves that command first and uses it for
 * single checks. The declared suite command is not touched: the whole
 * suite runs as the repository declares it.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** What the door does with the declared single-check command. */
export type SingleCheck =
  /** Prove `plain` first; `why` says it in the log. */
  | { kind: "plain"; plain: string; why: string }
  /** The declared command provisions again, and nothing names another. */
  | { kind: "reprovisions"; why: string }
  /** The declared command does not provision again: it is used as it is. */
  | { kind: "declared" };

/**
 * Whether the declared single-check command runs `provision` again: in its
 * own text, or in a script file of the tree that the command names.
 */
export function runsProvisioning(worktree: string, command: string, provision: string): boolean {
  const install = provision.trim();
  if (!install) return false;
  if (command.includes(install)) return true;
  for (const word of command.split(/\s+/)) {
    if (!word || word === "<file>" || word.startsWith("-")) continue;
    const file = path.resolve(worktree, word);
    if (!file.startsWith(path.resolve(worktree) + path.sep)) continue;
    let text: string;
    try {
      if (!fs.statSync(file).isFile()) continue;
      text = fs.readFileSync(file, "utf8");
    } catch (e) {
      // A word of the command that is not a path in the tree is an
      // argument, not a script. Any other read error is the tree's fault.
      if ((e as NodeJS.ErrnoException).code === "ENOENT" || (e as NodeJS.ErrnoException).code === "ENAMETOOLONG") continue;
      throw e;
    }
    if (text.includes(install)) return true;
  }
  return false;
}

/** Which single-check command the door proves first. */
export function singleCheckFor(a: {
  worktree: string;
  /** The single-check command `thinkube.yaml` declares. */
  declared: string;
  /** The provisioning command the door runs on the tree. */
  provision?: string;
  /** The single-check command `.tandem/setup.json` records. */
  facts?: string;
}): SingleCheck {
  if (!a.provision || !runsProvisioning(a.worktree, a.declared, a.provision)) return { kind: "declared" };
  const plain = a.facts?.trim();
  if (plain && plain !== a.declared.trim() && plain.includes("<file>") && !runsProvisioning(a.worktree, plain, a.provision))
    return {
      kind: "plain",
      plain,
      why:
        `the declared single-check command (${a.declared}) installs again on every check (${a.provision}), ` +
        `which the door already ran on this tree — single checks run with the repository's own: ${plain}`,
    };
  return {
    kind: "reprovisions",
    why:
      `the declared single-check command (${a.declared}) installs again on every check (${a.provision}), and ` +
      `.tandem/setup.json names no single-check command that does not — record the plain runner there as "runOne" to skip it`,
  };
}
