/**
 * The completeness round: given what was derived, what does the set still
 * MISS — gaps the ask requires and nobody covers, and the adjacent code
 * that must move too.
 *
 * Its input is deliberately consumable: every anchor carries what its
 * grounding round saw there (or the literal source line, host-quoted),
 * and the affected listing carries the lines it names. The round is told
 * to JUDGE that material and to read only where it doubts it — a round
 * handed bare pointers has no choice but to re-read the repository the
 * earlier rounds already read.
 */
import { Ask, Change } from "../core/schema";
import { readStamp } from "../core/stamp";
import { quoteAnchor } from "./spans";
import { RoundDeps, runReadRound } from "./round";
import { parseGroundedNodes, resolveDerived } from "./ground";

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
  claims?: { text: string; why?: string }[];
  /** What the graph says moves when these files move — computed, cited,
   *  and handed over. This round used to go looking for it. */
  affected?: string;
  /** The human's settled answers — a gap that re-opens one is not a gap. */
  decisions?: string[];
}): string {
  return (
    `You are the COMPLETENESS round: given ONE ask and the changes derived ` +
    `from it, return every change the set still MISSES — in both senses:\n` +
    `1. GAPS: something the ask requires that no change covers.\n` +
    `2. AFFECTED CODE: other places in the repository at ${args.repoRoot} ` +
    `that must move too — callers of touched symbols, configuration that ` +
    `names touched files, documentation that states the old behavior.\n\n` +
    // The misses this round produces are not random: they are whole
    // families skipped — every doc page, every fixture, every copy of a
    // rule. A family answered even when empty cannot be skipped.
    `Sweep these families ONE BY ONE. An empty family is an answer; a ` +
    `skipped family is not. What a sweep finds is returned as its own ` +
    `node with its own acceptance — a defect mentioned inside another ` +
    `node's evidence has not been returned:\n` +
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
    `f. THE WORLD — every criterion that would ACT on anything outside the ` +
    `repository to prove itself (the cluster this runs in, a service, a ` +
    `process, a file outside the worktree): re-mark it — the observable ` +
    `part at a seam through a fake becomes the "probe", the effect itself ` +
    `becomes an "assessment" the person judges once. No check acts on the ` +
    `world.\n` +
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
    (args.claims?.length
      ? `EVERY node you return names the claim it makes true, as "claim": ` +
        `the NUMBER from this list:\n` +
        args.claims
          .map((c, i) => `    ${i + 1}. ${c.text}${c.why ? ` (so that ${c.why})` : ""}`)
          .join("\n") +
        `\nA gap or ripple that serves none of these is not part of this ` +
        `work — leave it out rather than returning it unattached.\n\n`
      : "") +
    `Respond with ONE JSON object and nothing else:\n` +
    `{"nodes":[{"sentence":"…"${args.claims?.length ? `,"claim":1` : ""},` +
    `"touchpoints":[{"path":"…"}],"needs":[],` +
    `"acceptance":[{"text":"…","kind":"probe"}]}]} — each node one MISSING or AFFECTED ` +
    `change in the same shape grounding uses (needs indices refer to THIS ` +
    `list only). Each acceptance carries its LIFETIME as "kind": "probe" for ` +
    `STANDING BEHAVIOR a machine should still check in five years (a permanent ` +
    `regression test), "assessment" for proof of THIS TRANSITION — something ` +
    `removed, renamed or reworded, documentation now saying something — judged ` +
    `once at delivery by an independent reviewer and never kept as a test. A ` +
    `documentation-wording check is ALWAYS "assessment"; most ripples from the ` +
    `DOCUMENTATION family are.\n` +
    `Complete and nothing affected → {"nodes":[]}. Never ` +
    `restate an existing change; only genuine gaps and real ripples.`
  );
}

/**
 * ONE completeness pass over everything a cut has derived.
 *
 * Per subject, this round is nine tool-using reads of the same repository
 * that cannot see each other: each finds the same documentation page and
 * the same callers, attributes them to whichever claims it happens to
 * hold, and the human is handed the overlap. Run once, it sees every
 * subject's claims at the same time — so a ripple lands under the claim it
 * actually serves, and it is derived once.
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
    mintNodeId: (n: number) => string;
    nextIndex: number;
  },
  round: Round = runReadRound,
): Promise<Change[]> {
  const log = deps.log ?? (() => {});
  if (!args.claims.length || !args.changes.length) return [];
  const nameOf = new Map(args.subjects.map((s) => [s.id, s.name]));
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
      claims: args.claims.map((c) => ({
        text: `${nameOf.get(c.subjectId) ?? "?"} — ${c.text}`,
        ...(c.why ? { why: c.why } : {}),
      })),
    }),
  );
  if (raw === null) {
    log("completeness: round unavailable — no gaps or ripples were looked for");
    return [];
  }
  const derived = parseGroundedNodes(raw, deps.repoRoot);
  const stamp = [await readStamp(deps.repoRoot)];
  const out: Change[] = [];
  for (const d of derived) {
    // A gap serves the claim it names, and lands under THAT claim's
    // subject — which is the whole reason for running this once.
    const claim = d.claim ? args.claims[d.claim - 1] : undefined;
    if (!claim) {
      log(`completeness: dropped "${d.sentence.slice(0, 60)}" — it named no claim`);
      continue;
    }
    const [made] = resolveDerived(
      [d],
      claim.subjectId,
      stamp,
      args.nextIndex + out.length,
      args.mintNodeId,
      [claim.id],
    );
    out.push({ ...made, servesClaim: claim.id });
  }
  log(`completeness: ${out.length} gap(s) and ripple(s) across the whole cut`);
  return out;
}
