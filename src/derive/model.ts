/**
 * The model round: a pasted list is not a queue of tickets, it is a
 * description of one world. This round reads every sentence at once and
 * solves for what they are about — SUBJECTS (the nouns), CLAIMS (what must
 * become true of one subject, with the purpose it carries), and RULES (what
 * holds across subjects).
 *
 * It reads no code and runs on the volume model: its whole input is the
 * sentences. It proposes; the human accepts, and nothing is ground until
 * they do.
 */
import { RoundDeps, runReadRound, volumeDeps } from "./round";

export interface ProposedModel {
  subjects: { name: string; from: number[]; claims: { text: string; why?: string; from: number }[] }[];
  rules: { text: string; scope: string; from: number }[];
}

/** Build the model prompt. Pure; exported for tests. */
export function buildModelPrompt(sentences: string[]): string {
  const listed = sentences.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return (
    `You are reading a list one person wrote about ONE product. The list is ` +
    `not a queue of separate jobs — sentences in it usually describe the same ` +
    `things from different angles. Solve for what they are about.\n\n` +
    `Three kinds of thing, and nothing else:\n` +
    `- SUBJECT: the noun the work is about, in the writer's own words ("the ` +
    `delivery page", "the worker brief"). Two sentences about the same noun ` +
    `belong to ONE subject.\n` +
    `- CLAIM: what must become true of one subject. Actions and qualities ` +
    `both. A claim belongs to exactly one subject. Keep the writer's wording; ` +
    `if the sentence says why ("so that…"), carry that separately.\n` +
    `- RULE: something that must hold across MANY subjects, not one ("labels ` +
    `are in my words", "documentation unless a reason is recorded"). Only ` +
    `promote to a rule what genuinely governs more than one subject.\n\n` +
    `Never invent a subject the list does not mention. Never drop a sentence: ` +
    `every one must appear as a claim or a rule. A sentence may yield both.\n\n` +
    `THE LIST:\n${listed}\n\n` +
    `Respond with ONE JSON object and nothing else:\n` +
    `{"subjects":[{"name":"the delivery page","from":[1,4],"claims":[` +
    `{"text":"shows a see-it line for every promise","why":"so I accept by ` +
    `experiencing it","from":1}]}],"rules":[{"text":"labels are in my words",` +
    `"scope":"every page the human reads","from":4}]}\n` +
    `— "from" is the 1-based number of the sentence it came from.`
  );
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Parse the model reply. Fail-soft: junk yields nothing, never a throw. */
export function parseModel(raw: string | null, count: number): ProposedModel | undefined {
  if (!raw) return undefined;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const inRange = (n: unknown): number | undefined =>
    typeof n === "number" && n >= 1 && n <= count ? n : undefined;

  const subjects: ProposedModel["subjects"] = [];
  for (const s of Array.isArray(parsed.subjects) ? parsed.subjects : []) {
    const rec = (s ?? {}) as Record<string, unknown>;
    const name = asString(rec.name);
    if (!name) continue;
    const claims: ProposedModel["subjects"][number]["claims"] = [];
    for (const c of Array.isArray(rec.claims) ? rec.claims : []) {
      const cr = (c ?? {}) as Record<string, unknown>;
      const text = asString(cr.text);
      const from = inRange(cr.from);
      if (!text || from === undefined) continue;
      const why = asString(cr.why);
      claims.push({ text, from, ...(why ? { why } : {}) });
    }
    if (!claims.length) continue;
    const from = (Array.isArray(rec.from) ? rec.from : [])
      .map(inRange)
      .filter((n): n is number => n !== undefined);
    subjects.push({ name, claims, from: from.length ? from : claims.map((c) => c.from) });
  }

  const rules: ProposedModel["rules"] = [];
  for (const r of Array.isArray(parsed.rules) ? parsed.rules : []) {
    const rec = (r ?? {}) as Record<string, unknown>;
    const text = asString(rec.text);
    const from = inRange(rec.from);
    if (!text || from === undefined) continue;
    rules.push({ text, scope: asString(rec.scope) || "every subject", from });
  }

  return subjects.length ? { subjects, rules } : undefined;
}

/** Which sentences the model failed to account for — never silently lost. */
export function unaccountedFor(model: ProposedModel, count: number): number[] {
  const seen = new Set<number>();
  for (const s of model.subjects) for (const c of s.claims) seen.add(c.from);
  for (const r of model.rules) seen.add(r.from);
  const missing: number[] = [];
  for (let i = 1; i <= count; i++) if (!seen.has(i)) missing.push(i);
  return missing;
}

/** Run the model round over the sentences. Null on failure — the caller then
 *  falls back to treating each sentence as its own subject. */
export async function solveModel(
  deps: RoundDeps,
  sentences: string[],
  round: (deps: RoundDeps, prompt: string) => Promise<string | null> = runReadRound,
): Promise<ProposedModel | undefined> {
  if (!sentences.length) return undefined;
  const raw = await round(volumeDeps(deps), buildModelPrompt(sentences)).catch(() => null);
  return parseModel(raw, sentences.length);
}
