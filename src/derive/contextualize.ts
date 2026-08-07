/**
 * The contextualize round: one bounded reading of the REPOSITORY — its
 * structure, key modules, conventions and seams — shared by every ask
 * that grounds against it. The digest is machine working-memory (cited,
 * bounded), cached by the caller under the repository's git stamp; it
 * refreshes only when the code moves underneath. It is never shown as a
 * decision surface.
 */
import { RoundDeps, runReadRound } from "./round";

/** Beyond this the digest is carrying homework, not context. */
export const DIGEST_CHAR_BUDGET = 6000;

/** Build the repository-digest prompt. Pure; exported for tests. */
export function buildContextualizePrompt(repoRoot: string): string {
  return (
    `You are producing a REPOSITORY DIGEST: a bounded reading of the whole ` +
    `repository at ${repoRoot}, to be REUSED by many later derivations over ` +
    `different asks — none of which you can see. Map the terrain, not one ` +
    `path through it (Glob the tree first, Read the spans that matter).\n\n` +
    `Write the digest as plain prose sections:\n` +
    `- LAYOUT: the top-level areas and what lives in each, every claim ` +
    `citing its source path (e.g. "surfaces own the webview in src/surfaces/").\n` +
    `- KEY MODULES: the load-bearing modules and flows — entry points, core ` +
    `state, the seams where features plug in — each cited.\n` +
    `- CONVENTIONS: patterns any change must respect (naming, test layout, ` +
    `error handling, size limits), each cited.\n` +
    `- EDGES: couplings that make distant code move together, cited.\n\n` +
    `Rules: every claim carries a repo-relative path; no recommendations, no ` +
    `plan — this is a reading, not a design; at most ${DIGEST_CHAR_BUDGET} ` +
    `characters. Respond with the digest text only.`
  );
}

/**
 * Run the contextualize round. Null on failure — grounding then runs
 * without a digest, exactly as before (fail-soft).
 */
export async function runContextualize(
  deps: RoundDeps,
  round: (deps: RoundDeps, prompt: string) => Promise<string | null> = runReadRound,
): Promise<string | null> {
  const text = await round(deps, buildContextualizePrompt(deps.repoRoot));
  if (!text || !text.trim()) return null;
  return text.trim().slice(0, DIGEST_CHAR_BUDGET);
}
