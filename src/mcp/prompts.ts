/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The flows, as prompts a client offers by name.
 *
 * A tool is one step; the Workshop's work is a sequence of them, and a
 * person at a chat should not have to remember the order. An MCP prompt
 * is a named sequence the client lists (Claude Code offers it as a slash
 * command), so "capture what I said as asks" or "take this space to a
 * delivery" is one word, and the agent reads which tools to call and
 * where it must stop for the person.
 */
import type { ToolDef } from "./tools";

export interface PromptDef {
  name: string;
  description: string;
  arguments: { name: string; description: string; required: boolean }[];
  /** The prompt's text for the given arguments. */
  text(args: Record<string, string>): string;
}

const SPACE = { name: "space", description: "the thinking space's name, as list_spaces reports it", required: true };

export const PROMPTS: readonly PromptDef[] = [
  {
    name: "capture-asks",
    description: "Turn what the person has said into asks in a thinking space, one sentence per ask, kept only when they say so.",
    arguments: [SPACE],
    text: ({ space }) =>
      [
        `Work in the thinking space "${space}" of the Tandem Workshop.`,
        "",
        "Turn what the person has told you they want into asks: one plain sentence per ask, in their own",
        "words, never a solution. Put them in the capture box with `save_draft`, one per line, then read them",
        "back with `read_draft` and show them to the person exactly as drafted.",
        "",
        "Keeping the draft as asks is the person's act. Do not call `keep_draft` unless they say to keep it;",
        "if they change a sentence, draft it again. When they keep it, `read_space` shows what the space now holds.",
      ].join("\n"),
  },
  {
    name: "build",
    description: "Take a thinking space from its asks to a running build: read, group, choose, and build on the person's word.",
    arguments: [SPACE],
    text: ({ space }) =>
      [
        `Work in the thinking space "${space}" of the Tandem Workshop.`,
        "",
        "First `check_readiness`: build is refused while any item is not ready, and the answer says what to fix.",
        "Then `read_asks` to read the asks again and group their subjects into sets, or `group_into_sets` when",
        "the reading is already there. Show the person the sets and what each would make true.",
        "",
        "Choosing the set and signing the build are the person's acts: call `choose_set` and `build` only when",
        "they name the set and say to build it. While it runs, `read_run` says every unit and its state and",
        "`read_log` the tail of a step; `answer_worker` carries the person's answer to a parked worker.",
        "Never answer a worker's question yourself.",
      ].join("\n"),
  },
  {
    name: "review-delivery",
    description: "Read the latest delivery with the person, look at the running product, and record what they decide.",
    arguments: [SPACE],
    text: ({ space }) =>
      [
        `Work in the thinking space "${space}" of the Tandem Workshop.`,
        "",
        "`read_delivery` gives the latest delivery: every proof, every finding, and whether it was withheld.",
        "Say it in the person's words: which promises hold, which do not, and what the machine could not",
        "settle. Where the work is live, `look_at` reports what a person would notice at the address.",
        "",
        "Deciding is the person's act. `does_not_hold` records that a promise does not hold, with what they",
        "saw; `accept_delivery` and `reject_delivery` record their decision. Call none of them until they",
        "have said so.",
      ].join("\n"),
  },
];

/** The tool names a prompt's text asks the agent to call. */
export function toolsNamedIn(text: string): string[] {
  return [...text.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
}

/** Every tool a prompt names must be one the server offers. */
export function unknownToolsIn(prompts: readonly PromptDef[], tools: readonly ToolDef[]): string[] {
  const known = new Set(tools.map((t) => t.name));
  const out = new Set<string>();
  for (const p of prompts)
    for (const t of toolsNamedIn(p.text({ space: "x" }))) if (!known.has(t)) out.add(`${p.name}: ${t}`);
  return [...out];
}
