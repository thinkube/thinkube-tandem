/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The model round: a pasted list is not a queue of tickets, it is a
 * description of one world. This round reads every sentence at once and
 * solves for what they are about — SUBJECTS (the nouns) and CLAIMS (what
 * must become true of one subject, with the purpose it carries).
 *
 * There is no third kind. A sentence that seems to hold everywhere still
 * has a noun it is about — "documentation is required on every cut" is
 * about documentation — and calling it something else loses that noun and
 * with it the work that would make it true.
 *
 * It reads no code and runs on the volume model: its whole input is the
 * sentences. It proposes; the human accepts, and nothing is ground until
 * they do.
 */
import { jsonSchemaOf, readAnswer, RoundDeps, runReadRound, volumeDeps } from "./round";
import { z } from "zod";

export interface ProposedModel {
  subjects: {
    name: string;
    from: number[];
    claims: {
      text: string;
      why?: string;
      from: number;
      /** The words of the sentence this claim was read from, exactly as
       *  written — what lets the sentence be shown back marked up. */
      quote?: string;
      /** The words that refer to the subject when they are not the
       *  subject's name: a pronoun, or empty when nothing at all stands
       *  in for it. Absent when the sentence names the subject outright. */
      mention?: string;
      /** An earlier claim of the same subject this one displaces. Two
       *  claims that cannot both hold are resolved by which sentence was
       *  written later; this is that decision, said out loud. */
      replaces?: string;
    }[];
  }[];
}

/** Build the model prompt. Pure; exported for tests. */
function buildModelPrompt(sentences: string[], map = ""): string {
  const listed = sentences.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return (
    // The subject is the thing the writer is TALKING ABOUT, and most of
    // the time that thing exists in their repository already. Reading
    // their sentences with no idea what is in the code invents names for
    // things that are already there, under another name.
    (map
      ? `The writer is describing THIS repository. Its structure, extracted ` +
        `from the code, with the file of every node:\n\n${map}\n\n` +
        `Where a sentence is about something that exists here, name the ` +
        `subject as the writer names it — never as the code names it — but ` +
        `use this to tell whether two sentences are about the SAME thing.` +
        `\n\n`
      : "") +
    `You are reading a list one person wrote about ONE product. The list is ` +
    `not a queue of separate jobs — sentences in it usually describe the same ` +
    `things from different angles. Solve for what they are about.\n\n` +
    `Two kinds of thing, and nothing else:\n` +
    `- SUBJECT: the thing a sentence is ABOUT, in the writer's own words ` +
    `("the delivery page", "documentation", "the worker brief").\n` +
    `- CLAIM: what must become true OF one subject. Actions and qualities ` +
    `both. A claim belongs to exactly one subject. Keep the writer's ` +
    `wording; if the sentence says why ("so that…"), carry that ` +
    `separately.\n\n` +
    `FINDING THE FEWEST SUBJECTS IS THE WHOLE JOB. A writer describes one ` +
    `thing over and over in different words, and it wears a different ` +
    `disguise each time: "the invoices", "the unpaid ones", "anything past ` +
    `thirty days" are THREE DESCRIPTIONS OF ONE LIST, not three subjects. A ` +
    `description that NARROWS a thing — the unpaid ones, the late ones, the ` +
    `ones I starred — is never a subject of its own: it is a claim about the ` +
    `thing it narrows.\n\n` +
    `Ask of every sentence: what must become true, and OF WHAT? Then ask of ` +
    `every subject you have: is this the same thing as another, seen from a ` +
    `different angle? If it is, they are ONE subject with more claims.\n\n` +
    `The grammar will mislead you. The subject ` +
    `is never the actor ("I want…"), never the place a gesture lives ("on ` +
    `the review page"), never where something is stored ("inside the TEP"), ` +
    `and never a thing that exists only because the sentence exists ("that ` +
    `reason"). A pronoun points back at a subject already named. One ` +
    `sentence usually has ONE subject however many clauses it has:\n` +
    `   "Documentation must be required for every cut. When it is not ` +
    `needed I say so, with a reason, on the cut review page, and that ` +
    `reason is recorded in the TEP."\n` +
    `   → subject DOCUMENTATION, three claims. The review page and the TEP ` +
    `are places; "I" is the actor; "that reason" exists only here.\n\n` +
    `A CLAIM IS WHAT MUST BECOME TRUE — never what is wrong today. A ` +
    `person reporting a fault writes the fault and the fix in one ` +
    `sentence, and only the fix is a claim:\n` +
    `   "The brief a worker receives embeds the same TEP text twice under ` +
    `two headings; it must appear exactly once."\n` +
    `   → subject THE WORKER BRIEF, ONE claim: the TEP text appears ` +
    `exactly once. "embeds it twice" is the fault being reported. Read as ` +
    `a claim it would order the machine to build the bug, and it could ` +
    `never come true, because the work is what removes it. Leave it out: ` +
    `the writer's sentence is kept whole, so nothing about the fault is ` +
    `lost by not claiming it.\n\n` +
    `Never invent a subject the list does not mention, and never invent a ` +
    `catch-all like "the product" or "the system". Never drop a sentence ` +
    `quietly: every one must appear as a claim of some subject. A sentence ` +
    `whose subject you cannot name is left out ENTIRELY — it is reported to ` +
    `the writer as unplaced, which is honest, where a guess is not.\n\n` +
    `The sentences are in the order they were written, and a later one ` +
    `wins. When two claims of the same subject cannot both be true — the ` +
    `same thing said two ways — keep ONLY the later, and name the one it ` +
    `displaces in "replaces". Different attributes of one thing (bold AND ` +
    `bracketed) do not conflict; only mutually exclusive ones do.\n\n` +
    `NAMING. A subject's "name" is words the writer used, never words of ` +
    `your own. When ONE sentence names it, copy that naming exactly — "The ` +
    `brief a worker receives" is named "the brief a worker receives", never ` +
    `"the worker brief". When SEVERAL sentences name the same thing ` +
    `differently, take the PLAINEST of those namings as the name and record ` +
    `each sentence's own wording in that claim's "mention", so every way the ` +
    `writer referred to it can still be pointed at where they wrote it. ` +
    `Never merge two things under a name neither sentence used. Only a ` +
    `subject no sentence names at all gets a short name of your own.\n\n` +
    `BEFORE YOU ANSWER, COUNT. As many subjects as sentences means you have ` +
    `copied the list rather than read it. Go back and ask which of them are ` +
    `the same thing.\n\n` +
    `For every claim also give:\n` +
    `- "quote": the words of the sentence it was read from, copied EXACTLY ` +
    `— character for character, no paraphrase. Omit it if you cannot copy ` +
    `an exact span.\n` +
    `- "mention": the words in THAT sentence that stand for the subject — ` +
    `the writer's own wording for it there, or a pronoun ("it", "they"), or ` +
    `"" when nothing stands in for it at all. This is what lets the page ` +
    `point at the subject inside the sentence, so give it whenever the ` +
    `sentence's wording differs from the subject's name.\n\n` +
    `THE LIST:\n${listed}\n\n` +
    `Respond with ONE JSON object and nothing else:\n` +
    `{"subjects":[{"name":"the delivery page","from":[1,4],"claims":[` +
    `{"text":"shows a see-it line for every promise","why":"so I accept by ` +
    `experiencing it","from":1,"quote":"show me how to experience it",` +
    `"mention":"it"}]}]}\n` +
    `— "from" is the 1-based number of the sentence it came from.`
  );
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** The shape the reading round answers in. */
const ModelAnswer = z.object({
  subjects: z.array(
    z.object({
      name: z.string(),
      from: z.array(z.number()).optional(),
      claims: z.array(
        z.object({
          text: z.string(),
          why: z.string().optional(),
          from: z.number(),
          quote: z.string().optional(),
          mention: z.string().optional(),
          replaces: z.string().optional(),
        }),
      ),
    }),
  ),
});

/** Read the round's answer. Fail-soft: junk yields nothing, never a throw. */
function parseModel(raw: string | null, count: number): ProposedModel | undefined {
  const parsed = readAnswer(ModelAnswer, raw);
  if (!parsed) return undefined;
  const inRange = (n: number | undefined): number | undefined =>
    n !== undefined && n >= 1 && n <= count ? n : undefined;

  const subjects: ProposedModel["subjects"] = [];
  for (const rec of parsed.subjects) {
    const name = asString(rec.name);
    if (!name) continue;
    const claims: ProposedModel["subjects"][number]["claims"] = [];
    for (const cr of rec.claims) {
      const text = asString(cr.text);
      const from = inRange(cr.from);
      if (!text || from === undefined) continue;
      const why = asString(cr.why);
      const quote = asString(cr.quote);
      const replaces = asString(cr.replaces);
      // "" is a real answer for `mention` — the subject is implicit and
      // nothing at all stands in for it — so absence is what is checked,
      // not emptiness.
      const mention = typeof cr.mention === "string" ? cr.mention.trim() : undefined;
      claims.push({
        text,
        from,
        ...(why ? { why } : {}),
        ...(quote ? { quote } : {}),
        ...(mention !== undefined ? { mention } : {}),
        ...(replaces ? { replaces } : {}),
      });
    }
    if (!claims.length) continue;
    const from = (rec.from ?? []).map(inRange).filter((n): n is number => n !== undefined);
    subjects.push({ name, claims, from: from.length ? from : claims.map((c) => c.from) });
  }
  return subjects.length ? { subjects } : undefined;
}

/** Which sentences the model failed to account for — never silently lost. */
export function unaccountedFor(model: ProposedModel, count: number): number[] {
  const seen = new Set<number>();
  for (const s of model.subjects) for (const c of s.claims) seen.add(c.from);
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
  map = "",
): Promise<ProposedModel | undefined> {
  if (!sentences.length) return undefined;
  const raw = await round(
    { ...volumeDeps(deps), schema: jsonSchemaOf(ModelAnswer) },
    buildModelPrompt(sentences, map),
  ).catch(() => null);
  return parseModel(raw, sentences.length);
}
