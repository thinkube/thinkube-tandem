/**
 * The check-setup facts, derived from the repository itself.
 *
 * A fresh checkout is not a working tree: dependencies may have to be
 * installed before anything resolves (PROVISION), and some repositories'
 * tests import compiled output that a build step must produce before one
 * test file can run (PREPARE). Which world a repository lives in is a
 * fact ABOUT THAT REPOSITORY — written in its manifests and configs —
 * not something a human should discover by watching a run fail and then
 * type into a setting. So the machine reads it, once per repository
 * state, cached beside the digest; a setting remains only as an explicit
 * override.
 *
 * Language-agnostic by construction: nothing here knows any build tool.
 * The round reads the repo's own manifests and answers with commands or
 * NONE; the parser accepts labeled lines and never invents a step.
 */
import { RoundDeps, runReadRound } from "./round";

export interface Setup {
  /** Installs what a fresh checkout lacks; empty when nothing is needed. */
  provision: string;
  /** Builds what a single check imports; empty when tests run from source. */
  prepare: string;
}

export const NO_SETUP: Setup = { provision: "", prepare: "" };

/** Build the prompt. Pure; exported for tests. */
export function buildPreparePrompt(repoRoot: string, map: string, digest: string): string {
  return (
    `Two questions about the repository at ${repoRoot}, answered from its ` +
    `own manifests and configs (the dependency manifests and lockfiles, ` +
    `the test runner configuration, the build scripts, where tests import from).\n\n` +
    (map ? `THE REPOSITORY'S STRUCTURE (from the code itself):\n${map}\n\n` : "") +
    (digest ? `AN ESTABLISHED READING OF ITS CONVENTIONS:\n${digest}\n\n` : "") +
    `1. PROVISION — in a FRESH checkout of this repository (nothing installed ` +
    `yet), what single command installs its dependencies so that its tests ` +
    `can be built and run? Prefer the reproducible form the repository's ` +
    `lockfile calls for. NONE if a fresh checkout is already complete.\n` +
    `2. PREPARE — when a SINGLE test file is executed directly (outside the ` +
    `full suite command), does anything have to run first — a compile, a ` +
    `codegen, a build step — for that test file's imports to resolve? ` +
    `NONE if tests run straight from source.\n\n` +
    `Respond with EXACTLY two lines and nothing else — no explanation, no ` +
    `code fences:\n` +
    `PROVISION: <the exact shell command, run from the repository root, or NONE>\n` +
    `PREPARE: <the exact shell command, run from the repository root, or NONE>`
  );
}

/** One command per label or nothing — a parser that never invents a step. */
export function parseSetup(raw: string | null): Setup {
  const setup: Setup = { ...NO_SETUP };
  if (!raw) return setup;
  for (const l of raw.split("\n")) {
    const m = /^\s*`*\s*(PROVISION|PREPARE)\s*:\s*(.*?)\s*`*\s*$/i.exec(l);
    if (!m) continue;
    const cmd = m[2].replace(/^`+|`+$/g, "").trim();
    // A command is one line of sane length; an essay or NONE is not one.
    const value =
      !cmd || /^none[.!]?$/i.test(cmd) || cmd.length > 200 || /\s{4,}/.test(cmd) ? "" : cmd;
    if (m[1].toUpperCase() === "PROVISION") setup.provision = value;
    else setup.prepare = value;
  }
  return setup;
}

/** Derive both facts with a short read round. Empty on any failure — a
 *  run without setup steps is exactly what many repositories need. */
export async function deriveSetup(
  deps: RoundDeps,
  round: typeof runReadRound = runReadRound,
  map = "",
  digest = "",
): Promise<Setup> {
  const raw = await round(
    { ...deps, model: deps.volumeModel ?? deps.model, maxTurns: 8 },
    buildPreparePrompt(deps.repoRoot, map, digest),
  ).catch(() => null);
  return parseSetup(raw);
}
