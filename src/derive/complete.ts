/**
 * MISS — what must also move for a derived change to hold.
 *
 * A promise exists because a sentence requires it; this round never adds
 * one. Given the changes derived from the sentences, it names the OTHER
 * places each change must also touch to hold — a caller, a definition
 * kept single, a test that pins the old rule, a page that states it —
 * and each becomes a landing on the change it serves. What it notices
 * that serves no derived change is not work, and is dropped.
 *
 * The round is handed the material: the graph's own list of what moves
 * with the touched files, quoted, and the digest. It is asked to JUDGE
 * that material and to read only where it doubts it.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { Anchor, Ask, Change, validateAnchor } from "../core/schema";
import { quoteAnchor } from "./spans";
import { RoundDeps, runReadRound } from "./round";

type Round = (deps: RoundDeps, prompt: string) => Promise<string | null>;

const describeChanges = (changes: Change[]): string =>
  changes
    .map(
      (c, i) =>
        `${i}. ${c.sentence}\n   lands at: ${(c.grounding?.touchpoints ?? [])
          .map(
            (t) =>
              t.path +
              (t.symbol ? ` › ${t.symbol}` : "") +
              (t.evidence ? ` — ${t.evidence}` : ""),
          )
          .join(", ") || "(ungrounded)"}\n   done when: ${c.acceptance
          .map((a) => a.text)
          .join("; ")}`,
    )
    .join("\n");

/**
 * Fill in what the anchors point at, for a prompt's eyes only: anchors
 * whose round left no evidence get the literal source line instead, so a
 * later round can judge the change without re-opening the file. The space
 * keeps what the round SAID; the quote is recomputed at use, never stored.
 */
export const withAnchorQuotes = (repoRoot: string, changes: Change[]): Change[] =>
  changes.map((c) =>
    c.grounding
      ? {
          ...c,
          grounding: {
            ...c.grounding,
            touchpoints: c.grounding.touchpoints.map((t) => {
              if (t.evidence) return t;
              const quoted = quoteAnchor(repoRoot, t);
              return quoted ? { ...t, evidence: `now reads: ${quoted}` } : t;
            }),
          },
        }
      : c,
  );

/** Build the completeness prompt — one round that both judges the set
 *  complete and finds the adjacent code that must move too. */
export function buildCompletenessPrompt(args: {
  ask: Ask;
  changes: Change[];
  repoRoot: string;
  digest?: string;
  /** What the graph says moves when these files move — computed, cited,
   *  and handed over. This round used to go looking for it. */
  affected?: string;
  /** The human's settled answers — a gap that re-opens one is not a gap. */
  decisions?: string[];
}): string {
  return (
    `You are the COMPLETENESS round: given the changes derived from what a ` +
    `person asked, name every OTHER PLACE in the repository at ${args.repoRoot} ` +
    `that must also move for one of those changes to hold — callers of ` +
    `touched symbols, configuration that names touched files, a definition ` +
    `that must stay single, documentation and tests that state the old ` +
    `behavior. Each place is a LANDING on the change it serves.\n` +
    `You add no change of your own. A new behavior, an improvement, a ` +
    `weakness you noticed in code this work does not change, a test you ` +
    `would write for existing code: none of these is a landing. If nothing ` +
    `else must move, say so.\n\n` +
    // The misses this round finds are not random: they are whole
    // families skipped — every doc page, every fixture, every copy of a
    // rule. A family answered even when empty cannot be skipped.
    `Sweep these families ONE BY ONE. An empty family is an answer; a ` +
    `skipped family is not:\n` +
    `a. DOCUMENTATION — every page that states behavior this work changes: ` +
    `the published pages a person reads (search them for the old ` +
    `behavior's words) AND the repository's own registers of decisions ` +
    `and vocabulary.\n` +
    `b. EXISTING TESTS — every test that exercises a gate, default or rule ` +
    `this work tightens: each must be brought under the new rule, or the ` +
    `suite goes red the moment the work lands. Bringing under INCLUDES ` +
    `RETIRING — a test whose pinned behavior no longer exists is deleted, ` +
    `not appeased.\n` +
    `c. DERIVED COPIES — every place that re-derives, re-renders, hashes, ` +
    `persists or merges an object this work extends: a new field must ride ` +
    `ALL of them, or it silently falls out somewhere.\n` +
    `d. ONE RULE, MANY READERS — when two places spell the same decision ` +
    `separately today, name the one definition this work must give them, ` +
    `or they will disagree later.\n` +
    `e. LIFECYCLE — the create, open, close, delete and shutdown paths of ` +
    `anything this work multiplies: what held one must now hold many.\n` +
    (args.affected
      ? `\nWHAT MOVES WITH THIS, from the code graph — every caller, ` +
        `importer and referencer of what these changes touch, with its file ` +
        `and line, and under each entry the source line itself, quoted ` +
        `("> …"). This is extracted, not guessed, and the quote is the ` +
        `evidence: JUDGE each entry from it, and read a file only where ` +
        `the quoted line is not enough to decide. Which of these really ` +
        `must move, and what does each one need?\n\n${args.affected}\n\n`
      : `Grep for the touched symbols and paths; read what the hits demand.\n\n`) +
    (args.digest
      ? `REPOSITORY DIGEST (an established reading — build on it, verify ` +
        `only what you must):\n${args.digest}\n\n`
      : "") +
    `THE ASK:\n${args.ask.text}\n\n` +
    `THE DERIVED CHANGES (each anchor carries what its round saw there — ` +
    `trust it; read only where you doubt it):\n${describeChanges(args.changes)}\n\n` +
    (args.decisions?.length
      ? `DECISIONS IN FORCE (the human already settled these — a "gap" that ` +
        `re-opens one is not a gap):\n${args.decisions.map((d) => `- ${d}`).join("\n")}\n\n`
      : "") +
    `Respond with ONE JSON object and nothing else:\n` +
    `{"landings":[{"change":0,"path":"…","symbol":"…","why":"…"}]} — "change" ` +
    `is the NUMBER of the derived change the place serves, from the list ` +
    `above; "path" is repository-relative; "symbol" the function, section or ` +
    `key there, when there is one; "why" one sentence: what is there and why ` +
    `it must move with that change. A place that serves none of the derived ` +
    `changes is left out. Nothing else must move → {"landings":[]}.`
  );
}

/** The first JSON object in a round's answer, or nothing. */
function firstJson(raw: string): unknown {
  const start = raw.indexOf("{");
  if (start < 0) return undefined;
  for (let end = raw.lastIndexOf("}"); end > start; end = raw.lastIndexOf("}", end - 1)) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      /* a brace inside prose — try the previous one */
    }
  }
  return undefined;
}

/**
 * ONE completeness pass over everything a cut has derived.
 *
 * Run once over every subject's changes, so a place that must move lands
 * on the change it actually serves and is found once. Returns the changes
 * that gained a landing, with it added; never a change that did not
 * exist. The count of promises a person sees is the count their
 * sentences made.
 */
export async function completeCut(
  deps: RoundDeps,
  args: {
    /** Every claim in the cut, with the subject that owns it. */
    claims: { id: string; subjectId: string; text: string; why?: string }[];
    /** What the subjects are called, for the round to read them by. */
    subjects: { id: string; name: string }[];
    changes: Change[];
    digest?: string;
    /** What the graph says moves with these files — computed before the
     *  round, so it judges rather than searches. */
    affected?: string;
    decisions?: string[];
  },
  round: Round = runReadRound,
): Promise<Change[]> {
  const log = deps.log ?? (() => {});
  if (!args.claims.length || !args.changes.length) return [];
  const text =
    `Everything below belongs to one piece of work. What must become ` +
    `true, by subject:\n` +
    args.subjects
      .map(
        (s) =>
          `${s.name}:\n` +
          args.claims
            .filter((c) => c.subjectId === s.id)
            .map((c) => `  - ${c.text}${c.why ? ` (so that ${c.why})` : ""}`)
            .join("\n"),
      )
      .join("\n");
  const raw = await round(
    deps,
    buildCompletenessPrompt({
      ask: { id: "cut", text, at: "" },
      changes: withAnchorQuotes(deps.repoRoot, args.changes),
      repoRoot: deps.repoRoot,
      digest: args.digest,
      ...(args.affected ? { affected: args.affected } : {}),
      ...(args.decisions?.length ? { decisions: args.decisions } : {}),
    }),
  );
  if (raw === null) {
    log("completeness: round unavailable — nothing was looked for beyond the derived changes");
    return [];
  }
  return applyLandings(deps.repoRoot, args.changes, raw, log);
}

/**
 * The round's answer applied: each landing goes on the change it names,
 * once; a landing that names no derived change, or no place, is dropped.
 * Returns the changes that grew, and nothing that did not exist before.
 */
export function applyLandings(
  repoRoot: string,
  changes: Change[],
  raw: string,
  log: (line: string) => void = () => {},
): Change[] {
  const parsed = firstJson(raw) as { landings?: unknown } | undefined;
  const landings = Array.isArray(parsed?.landings) ? (parsed!.landings as Record<string, unknown>[]) : [];
  const grown = new Map<string, Change>();
  let added = 0;
  let dropped = 0;
  for (const l of landings) {
    const n = typeof l.change === "number" ? l.change : Number(l.change);
    const change = Number.isInteger(n) ? changes[n] : undefined;
    const at = typeof l.path === "string" ? l.path.trim() : "";
    if (!change || !at) {
      dropped++;
      continue;
    }
    const anchor: Anchor = {
      path: at,
      ...(typeof l.symbol === "string" && l.symbol.trim() ? { symbol: l.symbol.trim() } : {}),
      ...(typeof l.why === "string" && l.why.trim() ? { evidence: l.why.trim() } : {}),
      ...(fs.existsSync(path.join(repoRoot, at)) ? {} : { planned: true }),
    };
    if (validateAnchor(anchor)) {
      dropped++;
      continue;
    }
    const current = grown.get(change.id) ?? change;
    const had = current.grounding?.touchpoints ?? [];
    if (had.some((t) => t.path === anchor.path && (t.symbol ?? "") === (anchor.symbol ?? ""))) continue;
    grown.set(change.id, {
      ...current,
      grounding: { touchpoints: [...had, anchor], stamp: current.grounding?.stamp ?? [] },
    });
    added++;
  }
  log(
    `completeness: ${added} landing(s) added to ${grown.size} promise(s)` +
      (dropped ? `; ${dropped} named no derived change and were dropped` : ""),
  );
  return [...grown.values()];
}
