/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The record's command, started by the hooks of the Claude Code plugin:
 * `node cli.js <command>`, with the command's input as JSON on standard
 * input and its answer as JSON on standard output.
 *
 * A hook runs in an environment with no file system of its own, so the
 * record is written here, by the same code the editor reads it with.
 */
import * as fs from "node:fs";
import { AUTHOR_MISSING, currentAuthor } from "../core/author";
import { storeRootOf } from "../core/storeRoot";
import { leaveModule, own, said, turnEnded, view } from "./commands";
import type { Answer, Deps } from "./commands";

const COMMANDS = { said, turn: turnEnded, own, leave: leaveModule, view } as const;

function answer(command: string, input: string): Answer {
  const author = currentAuthor();
  if (!author) return { ok: false, reason: AUTHOR_MISSING };
  if (!Object.hasOwn(COMMANDS, command))
    return {
      ok: false,
      reason: `unknown command "${command}"; the commands are ${Object.keys(COMMANDS).join(", ")}`,
    };
  const deps: Deps = { storeRoot: storeRootOf(), author, now: () => new Date().toISOString() };
  const run = COMMANDS[command as keyof typeof COMMANDS] as (d: Deps, i: never) => Answer;
  return run(deps, JSON.parse(input) as never);
}

let out: Answer;
try {
  out = answer(process.argv[2] ?? "", fs.readFileSync(0, "utf8"));
} catch (err) {
  out = { ok: false, reason: err instanceof Error ? err.message : String(err) };
}
process.stdout.write(`${JSON.stringify(out)}\n`);
