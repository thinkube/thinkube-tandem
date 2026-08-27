/**
 * Attribution: which claim does a promise make true. The grounding and
 * completeness rounds are asked this as they derive; when one of them
 * comes back without an answer, the question is still answerable — the
 * promise's own sentence and the subject's claims are all it takes, with
 * no repository reading. This is that reading, done once over everything
 * left unattached.
 *
 * A promise the round cannot place stays unattached and is named. Nothing
 * is attached because it is the only candidate.
 */
import { RoundDeps, runReadRound, volumeDeps } from "./round";

export interface Attributable {
  id: string;
  sentence: string;
}

function buildAttributePrompt(
  subject: string,
  claims: { text: string; why?: string }[],
  promises: Attributable[],
): string {
  return (
    `Everything below is about ONE subject: ${subject}.\n\n` +
    `WHAT MUST BECOME TRUE OF IT — the claims, numbered:\n` +
    claims
      .map((c, i) => `${i + 1}. ${c.text}${c.why ? ` (so that ${c.why})` : ""}`)
      .join("\n") +
    `\n\nPROMISES already derived for this subject, numbered. Each one was ` +
    `derived to make ONE of those claims true, but which one was not ` +
    `recorded:\n` +
    promises.map((p, i) => `${i + 1}. ${p.sentence}`).join("\n") +
    `\n\nSay which claim each promise makes true. Judge the sentence as ` +
    `written — do not reason about what the promise ought to have been.\n` +
    `A promise that makes NONE of these claims true is left out of your ` +
    `answer entirely: a wrong attachment is worse than none, because it ` +
    `hides work that serves nothing.\n\n` +
    `Respond with ONE JSON object and nothing else:\n` +
    `{"attach":[{"promise":1,"claim":2}]} — promise and claim are the ` +
    `numbers above. Nothing placeable → {"attach":[]}.`
  );
}

/** Pairs the reply names, bounded to the lists it was given. */
function parseAttribution(
  raw: string | null,
  promises: number,
  claims: number,
): { promise: number; claim: number }[] {
  if (raw === null) return [];
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  let parsed: { attach?: unknown };
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as typeof parsed;
  } catch {
    return [];
  }
  const out: { promise: number; claim: number }[] = [];
  const seen = new Set<number>();
  for (const a of Array.isArray(parsed.attach) ? parsed.attach : []) {
    if (typeof a !== "object" || a === null) continue;
    const rec = a as Record<string, unknown>;
    const promise = typeof rec.promise === "number" ? rec.promise : 0;
    const claim = typeof rec.claim === "number" ? rec.claim : 0;
    // Out of range, or a promise named twice: refused, not repaired.
    if (promise < 1 || promise > promises || claim < 1 || claim > claims) continue;
    if (seen.has(promise)) continue;
    seen.add(promise);
    out.push({ promise, claim });
  }
  return out;
}

/** Attach what can be attached: node id → claim id. */
export async function attributePromises(
  deps: RoundDeps,
  subject: string,
  claims: { id: string; text: string; why?: string }[],
  promises: Attributable[],
  round = runReadRound,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!claims.length || !promises.length) return out;
  const raw = await round(
    volumeDeps(deps),
    buildAttributePrompt(subject, claims, promises),
  );
  for (const { promise, claim } of parseAttribution(raw, promises.length, claims.length))
    out.set(promises[promise - 1].id, claims[claim - 1].id);
  return out;
}
