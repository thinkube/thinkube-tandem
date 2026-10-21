/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Readiness's proof of a commit's setup, and whether a run's door may take it.
 *
 * Readiness proves the setup on an untouched copy of HEAD: the product
 * build, the single-test command of the repository and of each part, the
 * whole-suite command. A run that starts at the same commit, with the same
 * setup facts (`.tandem/setup.json`) and the same setup commands, would
 * prove the same things on the same tree. So the door takes readiness's
 * answer and still makes its own tree ready: it installs (or borrows) the
 * dependencies and builds the tree for the checks, because the workers
 * need that tree.
 *
 * The proof is kept in the readiness answer in the store
 * (src/run/readiness.ts), which every process reads: readiness runs in the
 * MCP server or the editor, and the run in its own driver process.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { proved } from "./proved";
import type { TreeSetup } from "./setup";

/** The setup commands told to the door, which decide what it proves. */
export interface SetupTold {
  provision?: string;
  prepare?: string;
  build?: string;
  /** The single-test command the door proves first. */
  runOne?: string;
}

/** What readiness proved, for one commit and one set of setup facts. */
export interface SetupProof {
  /** The commit proved. */
  head: string;
  /** The content of `.tandem/setup.json` the proof was made under, hashed. */
  facts: string;
  told: SetupTold;
  /** What held on the untouched copy. */
  held: {
    runOne?: string;
    suite?: string;
    build?: string;
    parts?: Record<string, { provision?: string; prepare?: string; runOne?: string }>;
    /** What the build steps produced on the copy. */
    built: string[];
  };
}

/** The setup facts of a checkout, as a hash of `.tandem/setup.json`. */
export function setupFactsOf(repoRoot: string): string {
  const at = path.join(repoRoot, ".tandem", "setup.json");
  const content = fs.existsSync(at) ? fs.readFileSync(at) : "(absent)";
  return crypto.createHash("sha256").update(content).digest("hex");
}

/** The proof readiness keeps from a door that held. */
export function setupProofOf(head: string, facts: string, told: SetupTold, ready: TreeSetup): SetupProof {
  return {
    head,
    facts,
    told: normal(told),
    held: {
      ...(ready.runOne ? { runOne: ready.runOne } : {}),
      ...(ready.suite ? { suite: ready.suite } : {}),
      ...(ready.build ? { build: ready.build } : {}),
      ...(ready.parts ? { parts: ready.parts } : {}),
      built: [...ready.built],
    },
  };
}

function normal(t: SetupTold): SetupTold {
  return {
    ...(t.provision ? { provision: t.provision } : {}),
    ...(t.prepare ? { prepare: t.prepare } : {}),
    ...(t.build ? { build: t.build } : {}),
    ...(t.runOne ? { runOne: t.runOne } : {}),
  };
}

/**
 * Whether the run's door may take this proof: the same commit, the same
 * setup facts, the same commands, and a tree that is not resumed from a
 * branch with commits. Otherwise, why it proves the setup again.
 */
export function takeSetupProof(
  proof: SetupProof | undefined,
  now: { head: string; facts: string; told: SetupTold; resumed: boolean },
): { take: SetupProof } | { why: string } {
  if (!proof) return { why: "readiness kept no proof of the setup for this checkout" };
  if (now.resumed) return { why: "the tree resumes a branch with commits of its own" };
  if (proof.head !== now.head)
    return { why: `readiness proved ${proof.head.slice(0, 8)}, and the run starts at ${now.head.slice(0, 8)}` };
  if (proof.facts !== now.facts) return { why: "the setup facts (.tandem/setup.json) changed since readiness proved them" };
  if (JSON.stringify(normal(proof.told)) !== JSON.stringify(normal(now.told)))
    return {
      why: `the setup commands differ from the ones readiness proved (${JSON.stringify(normal(proof.told))} then, ${JSON.stringify(normal(now.told))} now)`,
    };
  return { take: proof };
}

/**
 * The door's answer from a taken proof, over the tree the door made ready
 * here. Every command in it was run by readiness on this commit and answered.
 */
export function treeFromProof(
  proof: SetupProof,
  here: { provisioned: string[]; built: string[]; provision?: string; prepare?: string },
): TreeSetup {
  const mint = (cmd: string | undefined) => (cmd ? proved(cmd, true) : undefined);
  const runOne = mint(proof.held.runOne);
  const suite = mint(proof.held.suite);
  const build = mint(proof.held.build);
  const provision = mint(here.provision);
  const prepare = mint(here.prepare);
  return {
    provisioned: here.provisioned,
    built: [...new Set([...here.built, ...proof.held.built.filter((e) => !here.provisioned.includes(e))])],
    ...(runOne ? { runOne } : {}),
    ...(suite ? { suite } : {}),
    ...(build ? { build } : {}),
    ...(proof.held.parts ? { parts: proof.held.parts } : {}),
    ...(provision ? { provision } : {}),
    ...(prepare ? { prepare } : {}),
  };
}
