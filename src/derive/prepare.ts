/**
 * The check-setup command, derived from the repository itself.
 *
 * Some repositories' tests run straight from source; others import
 * compiled output and cannot execute one test file until a build step
 * has run. Which world a repository lives in is a fact ABOUT THAT
 * REPOSITORY — written in its manifests and configs — not something a
 * human should discover by watching a run fail and then type into a
 * setting. So the machine reads it, once per repository state, cached
 * beside the digest; a setting remains only as an explicit override.
 *
 * Language-agnostic by construction: nothing here knows any build tool.
 * The round reads the repo's own manifests and answers with a command
 * or NONE; the parser accepts one line and never invents one.
 */
import { RoundDeps, runReadRound } from "./round";

/** Build the prompt. Pure; exported for tests. */
export function buildPreparePrompt(repoRoot: string, map: string, digest: string): string {
  return (
    `One question about the repository at ${repoRoot}: when a SINGLE test ` +
    `file is executed directly (outside the full suite command), does ` +
    `anything have to run first — a compile, a codegen, a build step — for ` +
    `that test file's imports to resolve?\n\n` +
    (map ? `THE REPOSITORY'S STRUCTURE (from the code itself):\n${map}\n\n` : "") +
    (digest ? `AN ESTABLISHED READING OF ITS CONVENTIONS:\n${digest}\n\n` : "") +
    `Read the repository's own manifests and configs to answer — the test ` +
    `runner configuration, the build scripts, where tests import from.\n\n` +
    `Respond with ONLY one line: the exact shell command to run from the ` +
    `repository root, or the single word NONE if tests run straight from ` +
    `source. No explanation, no code fences.`
  );
}

/** One command or nothing — a parser that never invents a build step. */
export function parsePrepare(raw: string | null): string {
  if (!raw) return "";
  const line =
    raw
      .split("\n")
      .map((l) => l.replace(/^`+|`+$/g, "").trim())
      .filter(Boolean)
      .pop() ?? "";
  if (!line || /^none[.!]?$/i.test(line)) return "";
  // A command is one line of sane length; an essay is not a command.
  if (line.length > 200 || /\s{4,}/.test(line)) return "";
  return line;
}

/** Derive the command with a short read round. Empty on any failure —
 *  a run without a setup step is exactly what most repositories need. */
export async function derivePrepare(
  deps: RoundDeps,
  round: typeof runReadRound = runReadRound,
  map = "",
  digest = "",
): Promise<string> {
  const raw = await round(
    { ...deps, model: deps.volumeModel ?? deps.model, maxTurns: 8 },
    buildPreparePrompt(deps.repoRoot, map, digest),
  ).catch(() => null);
  return parsePrepare(raw);
}
