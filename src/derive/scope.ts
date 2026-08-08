/**
 * Rule scope: a rule carries what it governs in the human's words ("every
 * page you read"), and every NEW subject is tested against every rule once,
 * at the moment it is created. The verdict is recorded on the rule, so a
 * wrong call is visible on the subject's card instead of silently missing
 * from a build.
 *
 * One tool-less call judges every pending pair at once — its whole input is
 * the names and the scopes.
 */
import { RoundDeps, runReadRound, volumeDeps } from "./round";

export interface ScopeQuestion {
  ruleId: string;
  ruleText: string;
  scope: string;
  subjectId: string;
  subjectName: string;
}

/** Build the scope prompt. Pure; exported for tests. */
export function buildScopePrompt(pairs: ScopeQuestion[]): string {
  const listed = pairs
    .map(
      (p, i) =>
        `${i + 1}. Does the rule "${p.ruleText}" — which governs ${p.scope} — ` +
        `govern the subject "${p.subjectName}"?`,
    )
    .join("\n");
  return (
    `You decide which rules govern which subjects. A rule states what it ` +
    `governs in the writer's own words; a subject is a thing their product ` +
    `has. Answer each question yes or no on the plain meaning of the words — ` +
    `do not stretch a scope to cover something it does not describe, and do ` +
    `not refuse one it plainly covers.\n\n` +
    `${listed}\n\n` +
    `Respond with ONE JSON object and nothing else:\n` +
    `{"governs":[1,3]} — the numbers of the questions whose answer is yes. ` +
    `None → {"governs":[]}.`
  );
}

/** Parse the verdicts. Fail-soft: junk governs nothing. */
export function parseScope(raw: string | null, count: number): Set<number> {
  const out = new Set<number>();
  if (!raw) return out;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return out;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    for (const n of Array.isArray(parsed.governs) ? parsed.governs : [])
      if (typeof n === "number" && n >= 1 && n <= count) out.add(n);
  } catch {
    /* a broken reply governs nothing — the rule simply does not apply yet */
  }
  return out;
}

/** Judge every pending (rule, subject) pair in one call. */
export async function judgeScope(
  deps: RoundDeps,
  pairs: ScopeQuestion[],
  round: (deps: RoundDeps, prompt: string) => Promise<string | null> = runReadRound,
): Promise<ScopeQuestion[]> {
  if (!pairs.length) return [];
  const raw = await round(volumeDeps(deps), buildScopePrompt(pairs)).catch(() => null);
  const yes = parseScope(raw, pairs.length);
  return pairs.filter((_, i) => yes.has(i + 1));
}
