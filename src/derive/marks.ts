/**
 * What to draw on a sentence: which words became a claim, which words
 * name the subject, and where a subject the sentence never names has to
 * be written in.
 *
 * This is arithmetic over the reading, not presentation, so it lives here
 * where it can be run against real readings rather than judged by eye
 * after it ships.
 *
 * A subject's name usually sits INSIDE the words a claim was read from —
 * "Documentation must be required" is one claim whose first word is the
 * subject — so the two are nested, never rivals. Claims are the outer
 * ranges; subject mentions are marked within them and between them.
 */

interface ReadClaim {
  text: string;
  from: number;
  quote?: string;
  mention?: string;
}

export interface ReadSubject {
  name: string;
  claims: ReadClaim[];
}

/** One piece of a sentence, and what the reading made of it. */
export interface Piece {
  text: string;
  /** The subject whose name these words are, if they are. */
  subject?: number;
}

/** The words a claim was read from, with the subject mentions inside. */
interface ClaimRun {
  at: number;
  to: number;
  subject: number;
  claim: string;
  /** The subject is nowhere in this sentence, so it is written in here. */
  writeIn: boolean;
  pieces: Piece[];
}

/** A whole sentence as it should be drawn. */
export interface MarkedSentence {
  /** Text and claim runs in reading order; a plain piece has no claim. */
  parts: ({ kind: "plain"; pieces: Piece[] } | ({ kind: "claim" } & ClaimRun))[];
}

const escape = (n: string): string => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The label a reader sees for a subject: its position among the read
 * subjects, counted from one. Colour repeats every six subjects; this
 * label never does, so a subject past the sixth is still told apart from
 * the ones sharing its hue.
 */
export function subjectKey(index: number): string {
  return `S${index + 1}`;
}

/** Words that carry a name; articles and the like do not. */
const STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "its", "this", "that", "every"]);
const contentWords = (name: string): string[] =>
  name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));

/**
 * Every place this sentence names this subject — by the name itself, or,
 * when the sentence phrases it differently, by the shortest stretch of
 * words that holds every word of the name. "the worker brief" is found at
 * "brief a worker" in "The brief a worker receives…": a reader that saw
 * the subject and a page that cannot point at it is a page saying no
 * subject was found, which is false.
 */
function mentions(text: string, name: string): { at: number; to: number }[] {
  if (!name.trim()) return [];
  const out: { at: number; to: number }[] = [];
  const re = new RegExp(escape(name), "gi");
  for (const m of text.matchAll(re)) out.push({ at: m.index ?? 0, to: (m.index ?? 0) + m[0].length });
  if (out.length) return out;
  const words = contentWords(name);
  if (!words.length) return out;
  const tokens = [...text.matchAll(/[A-Za-z0-9][A-Za-z0-9'-]*/g)].map((m) => ({
    word: m[0].toLowerCase().replace(/s$/, ""),
    at: m.index ?? 0,
    to: (m.index ?? 0) + m[0].length,
  }));
  const want = new Set(words.map((w) => w.replace(/s$/, "")));
  let best: { at: number; to: number } | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const seen = new Set<string>();
    for (let j = i; j < tokens.length && j < i + words.length + 4; j++) {
      if (want.has(tokens[j].word)) seen.add(tokens[j].word);
      if (seen.size === want.size) {
        const span = { at: tokens[i].at, to: tokens[j].to };
        if (!best || span.to - span.at < best.to - best.at) best = span;
        break;
      }
    }
  }
  return best ? [best] : out;
}

/** Split a stretch of text by the subject names inside it. */
function piecesOf(
  text: string,
  from: number,
  to: number,
  marks: { at: number; to: number; subject: number }[],
): Piece[] {
  const out: Piece[] = [];
  let at = from;
  for (const m of marks.filter((x) => x.at >= from && x.to <= to).sort((a, b) => a.at - b.at)) {
    if (m.at > at) out.push({ text: text.slice(at, m.at) });
    out.push({ text: text.slice(m.at, m.to), subject: m.subject });
    at = m.to;
  }
  if (at < to) out.push({ text: text.slice(at, to) });
  return out.filter((p) => p.text.length > 0);
}

/**
 * Mark one sentence.
 *
 * A quote that is not in the sentence character for character is not
 * placed at all — a mark in the wrong place is worse than no mark. Two
 * claims quoting overlapping words keep the first; the second is dropped
 * rather than drawn on top of it.
 *
 * The write-in is decided by the WORDS, never by the round's own opinion:
 * a sentence that names its subject anywhere needs no write-in, whatever
 * the reading says, because a subject written in over a subject written
 * in the first word is worse than none at all. It appears once per
 * subject per sentence — on the first claim that needs it.
 */
export function markSentence(text: string, subjects: readonly ReadSubject[], n: number): MarkedSentence {
  const named = new Map<number, boolean>();
  const marks: { at: number; to: number; subject: number }[] = [];
  subjects.forEach((s, si) => {
    const found = mentions(text, s.name);
    named.set(si, found.length > 0);
    for (const f of found) marks.push({ ...f, subject: si });
  });

  const claims: Omit<ClaimRun, "pieces" | "writeIn">[] = [];
  subjects.forEach((s, si) => {
    for (const c of s.claims) {
      if (c.from !== n || !c.quote) continue;
      const at = text.indexOf(c.quote);
      if (at < 0) continue;
      claims.push({ at, to: at + c.quote.length, subject: si, claim: c.text });
    }
  });
  const kept: typeof claims = [];
  for (const c of claims.sort((a, b) => a.at - b.at || b.to - a.to))
    if (!kept.some((k) => c.at < k.to && k.at < c.to)) kept.push(c);
  kept.sort((a, b) => a.at - b.at);

  const written = new Set<number>();
  const parts: MarkedSentence["parts"] = [];
  let at = 0;
  for (const c of kept) {
    if (c.at > at) parts.push({ kind: "plain", pieces: piecesOf(text, at, c.at, marks) });
    const writeIn = !named.get(c.subject) && !written.has(c.subject);
    if (writeIn) written.add(c.subject);
    parts.push({
      kind: "claim",
      at: c.at,
      to: c.to,
      subject: c.subject,
      claim: c.claim,
      writeIn,
      pieces: piecesOf(text, c.at, c.to, marks),
    });
    at = c.to;
  }
  if (at < text.length) parts.push({ kind: "plain", pieces: piecesOf(text, at, text.length, marks) });
  return { parts };
}
