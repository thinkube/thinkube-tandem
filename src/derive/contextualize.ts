/**
 * The reading ON TOP of the map.
 *
 * The structure of a repository is a fact and comes from the code itself,
 * extracted, cited and free. This round is not asked for it. It is asked
 * for what a structural map cannot hold: the conventions a change must
 * respect, and the reasons written in the comments — the why, which no
 * extractor can see.
 *
 * It starts FROM the map, so it is not searching. Cached by the caller
 * under the same stamp as the map, and never shown as a decision surface.
 */
import { RoundDeps, runReadRound } from "./round";

/** Beyond this the digest is carrying homework, not context. */
export const DIGEST_CHAR_BUDGET = 6000;

/** Build the prompt. Pure; exported for tests. */
export function buildContextualizePrompt(repoRoot: string, map: string): string {
  return (
    `Below is a STRUCTURAL MAP of the repository at ${repoRoot}, extracted ` +
    `from the code itself: what is here, what hangs off what, with the file ` +
    `and line of every node. It is fact. Do not re-derive it, do not list ` +
    `modules back to me, and do not go looking for structure — you have it.` +
    `\n\n${map}\n\n` +
    `Read what the map CANNOT hold, and only that:\n` +
    `- CONVENTIONS: what any change here must respect — naming, how tests ` +
    `are laid out and named, how failures are handled, size limits, what is ` +
    `never done. Each one cited.\n` +
    `- WHY: the reasons written down in comments and headers — the rules a ` +
    `newcomer would break because nothing in the structure says them. Each ` +
    `one cited.\n\n` +
    `Read the spans the map points at; do not survey the tree. Every claim ` +
    `carries a repo-relative path. No recommendations and no plan — this is ` +
    `a reading. At most ${DIGEST_CHAR_BUDGET} characters. Respond with the ` +
    `reading only.`
  );
}

/**
 * Run the contextualize round. Null on failure — grounding then runs
 * without a digest, exactly as before (fail-soft).
 */
export async function runContextualize(
  deps: RoundDeps,
  round: (deps: RoundDeps, prompt: string) => Promise<string | null> = runReadRound,
  map = "",
): Promise<string | null> {
  const text = await round(deps, buildContextualizePrompt(deps.repoRoot, map));
  if (!text || !text.trim()) return null;
  return text.trim().slice(0, DIGEST_CHAR_BUDGET);
}
