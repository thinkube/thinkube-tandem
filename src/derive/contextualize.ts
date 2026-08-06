/**
 * The contextualize round: one bounded reading of the repository around an
 * ask, produced BEFORE grounding so later rounds build on an established
 * reading instead of re-discovering the tree. The digest is machine
 * working-memory (cited, bounded), persisted per ask by the caller; it is
 * never shown as a decision surface.
 */
import { Ask } from "../core/schema";
import { RoundDeps, runReadRound } from "./round";

/** Beyond this the digest is carrying homework, not context. */
export const DIGEST_CHAR_BUDGET = 6000;

/** Build the contextualize prompt. Pure; exported for tests. */
export function buildContextualizePrompt(ask: Ask, repoRoot: string): string {
  return (
    `You are producing a CONTEXT DIGEST: a bounded reading of the repository ` +
    `at ${repoRoot}, scoped to ONE ask. Read only what the ask touches ` +
    `(Grep first, Read the spans that matter).\n\n` +
    `THE ASK:\n${ask.text}\n\n` +
    `Write the digest as plain prose sections:\n` +
    `- WHAT EXISTS: the components, modules and flows the ask touches, each ` +
    `claim citing its source path (e.g. "the toolbar renders in src/ui/toolbar.ts").\n` +
    `- CONVENTIONS: patterns the change must respect (naming, test layout, ` +
    `error handling), each cited.\n` +
    `- EDGES: adjacent code likely affected, cited.\n\n` +
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
  ask: Ask,
  round: (deps: RoundDeps, prompt: string) => Promise<string | null> = runReadRound,
): Promise<string | null> {
  const text = await round(deps, buildContextualizePrompt(ask, deps.repoRoot));
  if (!text || !text.trim()) return null;
  return text.trim().slice(0, DIGEST_CHAR_BUDGET);
}
