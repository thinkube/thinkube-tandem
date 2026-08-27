/**
 * The derivation pipeline — the rounds between an ask and a decidable set
 * of changes, consolidated so knowledge is read once and reused:
 *
 *   repository digest (shared, stamp-cached) → ground → completeness
 *   (gap-close + impact, one round) → tail (coverage + criteria +
 *   challenger, one tool-less call)
 *
 * The digest is one reading of the WHOLE repository, cached under its git
 * stamp and shared by every ask, batch and session until the code moves.
 * Ground decomposes under it; the completeness round both judges the set
 * complete and finds the adjacent code that must move too; the tail maps
 * every clause of the ask to a change (uncovered clauses become questions
 * WITH recommendations), rewrites vague acceptance criteria into
 * observable ones, and confronts the result with the decisions in force —
 * all in a single volume-model call whose entire input is the prompt.
 *
 * Every round is fail-soft: a null round skips its enrichment and the
 * pipeline still returns what the earlier rounds established. The whole
 * pipeline has the same signature as the plain grounding round, so hosts
 * (and tests) swap one injectable function.
 */
import { Ask, Change, Question } from "../core/schema";
import { readStamp } from "../core/stamp";
import { RoundDeps, runReadRound, volumeDeps } from "./round";
import { attributePromises } from "./attribute";
import { judgeRaised } from "../gates/assumptions";
import type { Knowledge } from "./knowledge";
import { runContextualize } from "./contextualize";
import { buildCompletenessPrompt, withAnchorQuotes } from "./complete";

export { completeCut } from "./complete";
import {
  GroundingResult,
  parseGroundedNodes,
  parseGroundedQuestions,
  resolveDerived,
  runGrounding,
} from "./ground";

type Round = (deps: RoundDeps, prompt: string) => Promise<string | null>;

/** Digest persistence, provided by the host (file-backed there). Keys are
 *  repository stamps — one shared digest per repo state, not per ask. */
export interface DigestStore {
  load: (key: string) => string | undefined;
  save: (key: string, text: string) => void;
}

/** One in-flight reading per repo state: five parallel asks that all miss
 *  the cache share a single contextualize round, never five. */
const inflightDigests = new Map<string, Promise<string | null>>();

/** The cache key for a repository's current state. */
async function digestKeyFor(repoRoot: string): Promise<string> {
  const stamp = await readStamp(repoRoot);
  return `repo@${stamp.head || "no-git"}`;
}

/** The digest deps: the cheap model, a bounded reading. */
const digestDeps = (deps: RoundDeps): RoundDeps => ({
  ...deps,
  model: deps.volumeModel ?? deps.model,
  maxTurns: 15,
});

async function sharedRepoDigest(
  key: string,
  deps: RoundDeps,
  round: Round,
): Promise<string | null> {
  const mapKey = `${deps.repoRoot}|${key}`;
  let p = inflightDigests.get(mapKey);
  if (!p) {
    p = runContextualize(deps, round).finally(() => inflightDigests.delete(mapKey));
    inflightDigests.set(mapKey, p);
  }
  return p;
}

export interface PipelineOpts {
  nextIndex: number;
  /** Author-scoped id mint for new changes (merge-proof across users). */
  mintNodeId?: (n: number) => string;
  /** Member scopes of a multirepo project open in this workspace. */
  scopes?: { id: string; dir: string; label?: string }[];
  /** Liveness: called as each round starts — (stage label, 1-based index,
   *  total). The surface renders it; silence here was ledger lesson #79. */
  onStage?: (stage: string, index: number, total: number) => void;
  decisions?: string[];
  /** The claims this subject's grounding serves. */
  claims?: { id: string; text: string; why?: string }[];
  /**
   * Leave the gaps and ripples to a single pass over the whole cut. Nine
   * subjects each running their own completeness round is nine tool-using
   * reads of one repository, and each one can only attribute what it finds
   * to its OWN claims — so a ripple that belongs to another subject either
   * lands unattached or is invented twice.
   */
  skipCompleteness?: boolean;
  digest?: string;
  digestStore?: DigestStore;
  /** What is known: the map from the code, the reading on top of it, and
   *  the questions the graph can answer. Built once for the whole
   *  derivation and carried into every step. */
  knowledge?: Knowledge;
  /** Injectable round runner for tests; production uses the SDK round. */
  round?: Round;
}

/** Closed verdicts for acceptance criteria — the assessment vocabulary. */
const CRITERION_VERDICTS = ["observable", "vague", "untestable"] as const;

/** Build the tail prompt — coverage, criteria and challenger in ONE
 *  tool-less call: its entire input is below; nothing needs the repo. */
function buildTailPrompt(args: {
  ask: Ask;
  changes: Change[];
  decisions?: string[];
}): string {
  const listed = args.changes
    .map(
      (c, i) =>
        `${i}. ${c.sentence}\n${c.acceptance
          .map((a, j) => `   ${i}.${j} ${a.text}`)
          .join("\n")}`,
    )
    .join("\n");
  return (
    `You run THREE checks over one ask and its derived changes, and answer ` +
    `all three in one JSON object. Everything you need is below — do not ` +
    `assume access to anything else.\n\n` +
    `CHECK 1 — INTENT COVERAGE: split the ask into its distinct requirement ` +
    `clauses, then verify every clause is served by at least one change. A ` +
    `mapping exercise — do not invent requirements the ask does not state.\n` +
    `CHECK 2 — ACCEPTANCE ASSESSMENT: judge every numbered criterion with ` +
    `exactly one verdict from ${JSON.stringify(CRITERION_VERDICTS)}. ` +
    `"observable": a person or a probe can check it as stated. "vague": ` +
    `directionally right but not checkable as written. "untestable": no ` +
    `observation could settle it.\n` +
    `CHECK 3 — CHALLENGER: confront the changes with the decisions in ` +
    `force. You NEVER change anything — you only raise REAL contradictions ` +
    `as questions, each with a recommended resolution.\n\n` +
    (args.decisions?.length
      ? `DECISIONS IN FORCE (a clause these settle is COVERED — never ` +
        `re-open a settled decision as a question):\n${args.decisions.map((d) => `- ${d}`).join("\n")}\n\n`
      : `DECISIONS IN FORCE: none — check 3 returns [].\n\n`) +
    `THE ASK:\n${args.ask.text}\n\n` +
    `THE CHANGES (numbered change.criterion):\n${listed}\n\n` +
    `Respond with ONE JSON object and nothing else:\n` +
    `{"uncovered":[{"clause":"the ask's words for the unserved requirement",` +
    `"question":{"text":"the decision this opens, as the author would ask it",` +
    `"recommendation":"your concrete recommended answer"}}],` +
    `"rewrites":[{"node":0,"criterion":1,"verdict":"vague",` +
    `"text":"the criterion rewritten as an observable statement"}],` +
    `"questions":[{"text":"the contradiction, named plainly (which change, ` +
    `which decision)","recommendation":"your recommended resolution"}]}\n` +
    `— "uncovered": one entry per clause NO change serves (full coverage → []);` +
    ` "rewrites": one entry per NON-observable criterion, keeping its meaning,` +
    ` making it checkable (all observable → []); "questions": one entry per` +
    ` REAL contradiction (none → []).`
  );
}

function parseJson(raw: string): Record<string, unknown> | undefined {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Parse intent-coverage output into questions (fail-soft to none). */
function parseUncovered(
  raw: string,
): { clause: string; text: string; recommendation: string }[] {
  const parsed = parseJson(raw);
  const out: { clause: string; text: string; recommendation: string }[] = [];
  for (const u of Array.isArray(parsed?.uncovered) ? parsed!.uncovered : []) {
    if (typeof u !== "object" || u === null) continue;
    const rec = u as Record<string, unknown>;
    const clause = typeof rec.clause === "string" ? rec.clause.trim() : "";
    const q = (rec.question ?? {}) as Record<string, unknown>;
    const text = typeof q.text === "string" ? q.text.trim() : "";
    const recommendation =
      typeof q.recommendation === "string" ? q.recommendation.trim() : "";
    if (clause && text && recommendation) out.push({ clause, text, recommendation });
  }
  return out;
}

/** Parse criteria rewrites (fail-soft to none; out-of-range refused). */
function parseCriteriaRewrites(
  raw: string,
  changes: Change[],
): { node: number; criterion: number; text: string }[] {
  const parsed = parseJson(raw);
  const out: { node: number; criterion: number; text: string }[] = [];
  for (const r of Array.isArray(parsed?.rewrites) ? parsed!.rewrites : []) {
    if (typeof r !== "object" || r === null) continue;
    const rec = r as Record<string, unknown>;
    const node = typeof rec.node === "number" ? rec.node : -1;
    const criterion = typeof rec.criterion === "number" ? rec.criterion : -1;
    const text = typeof rec.text === "string" ? rec.text.trim() : "";
    if (
      text &&
      node >= 0 &&
      node < changes.length &&
      criterion >= 0 &&
      criterion < changes[node].acceptance.length
    )
      out.push({ node, criterion, text });
  }
  return out;
}

/**
 * Only what speaks the human's language reaches them. What is refused
 * keeps its answer and becomes an assumption the machine states; it is
 * never silently dropped, and never put to the human as their decision.
 */
function speakable(
  questions: Omit<Question, "id">[],
  ask: Ask,
  opts: PipelineOpts,
  log: (line: string) => void = () => {},
): Omit<Question, "id">[] {
  const judged = judgeRaised(
    questions.map((q) => ({ text: q.text, recommendation: q.recommendation })),
    {
      asks: [ask.text],
      claims: (opts.claims ?? []).map((c) => c.text),
      rules: opts.decisions ?? [],
    },
  );
  const kept: Omit<Question, "id">[] = [];
  judged.forEach((j, i) => {
    if (!j.refused) {
      kept.push(questions[i]);
      return;
    }
    log(
      j.refused === "answered"
        ? `assumption: already settled — "${j.text.slice(0, 60)}"`
        : `assumption: my words, not yours (${j.foreign!.slice(0, 4).join(", ")}) — "${j.text.slice(0, 50)}"`,
    );
  });
  return kept;
}

/**
 * Run the whole derivation pipeline for one ask. Same signature family as
 * `runGrounding`, so hosts swap a single injectable.
 */
export async function runDerivationPipeline(
  deps: RoundDeps,
  ask: Ask,
  opts: PipelineOpts,
): Promise<GroundingResult> {
  const round = opts.round ?? runReadRound;
  const log = deps.log ?? (() => {});
  const TOTAL_STAGES = 4;
  let stageNo = 0;
  const stage = (label: string): void => {
    stageNo++;
    opts.onStage?.(label, stageNo, TOTAL_STAGES);
  };

  // 1. What is known — built once for the derivation and handed in. The
  //    map comes from the code itself and costs no tokens; the reading on
  //    top of it is cached under the same stamp. Only a caller with no
  //    knowledge (an old test, a bare pipeline) pays for a reading here.
  const stamp = [await readStamp(deps.repoRoot)];
  let digest = opts.knowledge?.digest ?? opts.digest;
  const map = opts.knowledge?.map ?? "";
  stage(digest ? "using what I read of your code" : "reading your code");
  if (!digest) {
    const digestKey = await digestKeyFor(deps.repoRoot);
    digest = opts.digestStore?.load(digestKey);
    if (!digest) {
      const fresh = await sharedRepoDigest(digestKey, digestDeps(deps), round);
      if (fresh) {
        digest = fresh;
        opts.digestStore?.save(digestKey, fresh);
      }
    }
  }

  // 2. Ground. The graph is asked with the ask's own words first — the
  //    map is about the repository at large; this is the structure nearest
  //    to what THIS ask names, cited, for milliseconds. The capability
  //    existed on Knowledge and nothing consumed it.
  stage("deriving the changes");
  const graphed = opts.knowledge
    ? await opts.knowledge.ask(ask.text.slice(0, 400)).catch(() => "")
    : "";
  const grounded = await runGrounding(
    { ...deps, log },
    ask,
    {
      digest,
      ...(map ? { map } : {}),
      ...(graphed ? { graphed } : {}),
      nextIndex: opts.nextIndex,
      decisions: opts.decisions,
      mintId: opts.mintNodeId,
      scopes: opts.scopes,
      ...(opts.claims ? { claims: opts.claims } : {}),
    },
    round,
  );
  let changes = grounded.changes;
  const questions: Omit<Question, "id">[] = [...grounded.questions];
  // A round that derived nothing may still have raised something, and it
  // used to go straight to the human — around the gate that decides
  // whether it speaks their language. Nothing leaves without being judged.
  if (changes.length === 0)
    return { changes, questions: speakable(questions, ask, opts) };

  const addFrom = async (raw: string | null, label: string): Promise<void> => {
    if (raw === null) {
      log(`${label}: round unavailable — skipped`);
      return;
    }
    const derived = parseGroundedNodes(raw, deps.repoRoot);
    if (!derived.length) return;
    const added = resolveDerived(
      derived,
      ask.id,
      stamp,
      opts.nextIndex + changes.length,
      opts.mintNodeId,
      opts.claims?.map((c) => c.id),
    );
    changes = [...changes, ...added];
    log(`${label}: ${added.length} change(s) added`);
  };

  // 3. Completeness — gaps AND affected code, one digest-warm round.
  //    Skipped when the caller runs one pass over the whole cut instead.
  if (opts.skipCompleteness) stage("leaving gaps and ripples to the whole-cut pass");
  else
    await addFrom(
    await round(
      deps,
      buildCompletenessPrompt({
        ask,
        changes: withAnchorQuotes(deps.repoRoot, changes),
        repoRoot: deps.repoRoot,
        digest,
        ...(opts.claims ? { claims: opts.claims } : {}),
        ...(opts.decisions?.length ? { decisions: opts.decisions } : {}),
      }),
    ),
    "completeness",
  );

  // 4. The tail — coverage, criteria and challenger in ONE tool-less
  //    volume-model call; its entire input is the prompt.
  stage("weighing coverage, criteria and decisions");
  const tail = await round(
    volumeDeps(deps),
    buildTailPrompt({ ask, changes, decisions: opts.decisions }),
  );
  if (tail !== null) {
    for (const u of parseUncovered(tail))
      questions.push({
        askId: ask.id,
        text: `Uncovered: "${u.clause}" — ${u.text}`,
        recommendation: u.recommendation,
      });
    const rewrites = parseCriteriaRewrites(tail, changes);
    if (rewrites.length) {
      changes = changes.map((c, i) => {
        const mine = rewrites.filter((r) => r.node === i);
        if (!mine.length) return c;
        return {
          ...c,
          acceptance: c.acceptance.map((a, j) => {
            const rw = mine.find((r) => r.criterion === j);
            return rw ? { ...a, text: rw.text } : a;
          }),
        };
      });
      log(`assessment: ${rewrites.length} criterion(a) sharpened`);
    }
    if (opts.decisions?.length)
      for (const q of parseGroundedQuestions(tail))
        questions.push({ askId: ask.id, ...q });
  }

  // A round that forgot to name its claim leaves the human holding the
  // machine's bookkeeping. It is the machine's failure and the machine
  // repairs it: one cheap, tool-less reading of the sentences against the
  // claims. What it still cannot place stays unattached and is named —
  // never attached because it was the only candidate left.
  if (opts.claims?.length) {
    const loose = changes.filter((c) => !c.servesClaim);
    if (loose.length) {
      const placed = await attributePromises(
        deps,
        ask.text.split("\n")[0],
        opts.claims,
        loose.map((c) => ({ id: c.id, sentence: c.sentence })),
        round,
      );
      if (placed.size)
        changes = changes.map((c) =>
          placed.has(c.id) ? { ...c, servesClaim: placed.get(c.id)! } : c,
        );
      log(
        `attribution: ${placed.size} of ${loose.length} unattached change(s) placed` +
          (placed.size < loose.length ? `; ${loose.length - placed.size} still name no claim` : ""),
      );
    }
  }

  return { changes, questions: speakable(questions, ask, opts, log) };
}
