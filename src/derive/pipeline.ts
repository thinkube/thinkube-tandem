/**
 * The derivation pipeline — the rounds between an ask and a decidable set
 * of changes, in v1's order re-hosted on the v2 grammar:
 *
 *   contextualize → ground → gap-close → impact → intent coverage →
 *   criteria assessment → challenger
 *
 * Ground decomposes; gap-close judges completeness (two outcomes: complete,
 * or concrete additions); impact finds the adjacent code that must move
 * too; intent coverage maps every clause of the ask to a change and turns
 * uncovered clauses into questions WITH recommendations; the assessment
 * round rewrites vague acceptance criteria into observable ones (closed
 * verdicts); the challenger confronts the result with the decisions in
 * force and raises contradictions as questions — it never applies anything.
 *
 * Every round is fail-soft: a null round skips its enrichment and the
 * pipeline still returns what the earlier rounds established. The whole
 * pipeline has the same signature as the plain grounding round, so hosts
 * (and tests) swap one injectable function.
 */
import { Ask, Change, Question } from "../core/schema";
import { readStamp } from "../core/stamp";
import { RoundDeps, runReadRound } from "./round";
import { runContextualize } from "./contextualize";
import {
  GroundingResult,
  parseGroundedNodes,
  parseGroundedQuestions,
  resolveDerived,
  runGrounding,
} from "./ground";

type Round = (deps: RoundDeps, prompt: string) => Promise<string | null>;

/** Per-ask digest persistence, provided by the host (file-backed there). */
export interface DigestStore {
  load: (askId: string) => string | undefined;
  save: (askId: string, text: string) => void;
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
  digest?: string;
  digestStore?: DigestStore;
  /** Injectable round runner for tests; production uses the SDK round. */
  round?: Round;
}

const describeChanges = (changes: Change[]): string =>
  changes
    .map(
      (c, i) =>
        `${i}. ${c.sentence}\n   lands at: ${(c.grounding?.touchpoints ?? [])
          .map((t) => t.path + (t.symbol ? ` › ${t.symbol}` : ""))
          .join(", ") || "(ungrounded)"}\n   done when: ${c.acceptance
          .map((a) => a.text)
          .join("; ")}`,
    )
    .join("\n");

/** Build the gap-close judge prompt. */
function buildGapClosePrompt(args: {
  ask: Ask;
  changes: Change[];
  repoRoot: string;
}): string {
  return (
    `You are the GAP-CLOSE judge: given ONE ask and the changes derived from ` +
    `it, decide with exactly TWO possible outcomes whether the set is ` +
    `COMPLETE — everything the ask requires is covered by some change — or ` +
    `INCOMPLETE, in which case you return the MISSING changes, concrete and ` +
    `grounded. Read the repository at ${args.repoRoot} where needed.\n\n` +
    `THE ASK:\n${args.ask.text}\n\n` +
    `THE DERIVED CHANGES:\n${describeChanges(args.changes)}\n\n` +
    `Respond with ONE JSON object and nothing else:\n` +
    `{"complete": true, "nodes": []} — the set covers the ask; OR\n` +
    `{"complete": false, "nodes": [{"sentence":"…","touchpoints":[{"path":"…"}],` +
    `"needs":[],"acceptance":[{"text":"…"}]}]} — each node one MISSING change ` +
    `in the same shape grounding uses (needs indices refer to THIS list only). ` +
    `Never restate an existing change; only genuine gaps.`
  );
}

/** Build the impact-pass prompt. */
function buildImpactPrompt(args: {
  ask: Ask;
  changes: Change[];
  repoRoot: string;
}): string {
  return (
    `You are the IMPACT pass: for the changes below, find the OTHER places ` +
    `in the repository at ${args.repoRoot} that must move too — callers of ` +
    `touched symbols, configuration that names touched files, documentation ` +
    `that states the old behavior. Grep for the touched symbols and paths; ` +
    `read what the hits demand.\n\n` +
    `THE ASK:\n${args.ask.text}\n\n` +
    `THE CHANGES:\n${describeChanges(args.changes)}\n\n` +
    `Respond with ONE JSON object and nothing else:\n` +
    `{"nodes":[…]} — each node one ADDITIONAL change (same shape grounding ` +
    `uses: sentence, touchpoints, needs, acceptance) for an affected place ` +
    `the current set misses. No affected places → {"nodes":[]}. Never ` +
    `restate an existing change.`
  );
}

/** Build the intent-coverage prompt. */
function buildIntentCoveragePrompt(args: {
  ask: Ask;
  changes: Change[];
  decisions?: string[];
}): string {
  return (
    `You are the INTENT-COVERAGE check: split the ask into its distinct ` +
    `requirement clauses, then verify every clause is served by at least one ` +
    `derived change. This is a mapping exercise — do not invent requirements ` +
    `the ask does not state.\n\n` +
    (args.decisions?.length
      ? `DECISIONS IN FORCE (a clause these settle is COVERED — never ` +
        `re-open a settled decision as a question):\n${args.decisions.map((d) => `- ${d}`).join("\n")}\n\n`
      : "") +
    `THE ASK:\n${args.ask.text}\n\n` +
    `THE CHANGES:\n${describeChanges(args.changes)}\n\n` +
    `Respond with ONE JSON object and nothing else:\n` +
    `{"uncovered":[{"clause":"the ask's words for the unserved requirement",` +
    `"question":{"text":"the decision this opens, as the author would ask it",` +
    `"recommendation":"your concrete recommended answer"}}]} — one entry per ` +
    `clause NO change serves. Full coverage → {"uncovered":[]}.`
  );
}

/** Closed verdicts for acceptance criteria — the assessment vocabulary. */
const CRITERION_VERDICTS = ["observable", "vague", "untestable"] as const;

/** Build the criteria-assessment prompt. */
function buildCriteriaPrompt(args: { changes: Change[] }): string {
  const listed = args.changes
    .map(
      (c, i) =>
        `${i}. ${c.sentence}\n${c.acceptance
          .map((a, j) => `   ${i}.${j} ${a.text}`)
          .join("\n")}`,
    )
    .join("\n");
  return (
    `You are the ACCEPTANCE ASSESSMENT: judge every criterion below with ` +
    `exactly one verdict from the closed vocabulary ` +
    `${JSON.stringify(CRITERION_VERDICTS)}. "observable": a person or a ` +
    `probe can check it as stated. "vague": directionally right but not ` +
    `checkable as written. "untestable": no observation could settle it.\n\n` +
    `THE CRITERIA (numbered change.criterion):\n${listed}\n\n` +
    `Respond with ONE JSON object and nothing else:\n` +
    `{"rewrites":[{"node":0,"criterion":1,"verdict":"vague",` +
    `"text":"the criterion rewritten as an observable statement"}]} — one ` +
    `entry per NON-observable criterion, keeping its meaning, making it ` +
    `checkable. All observable → {"rewrites":[]}.`
  );
}

/** Build the challenger prompt. */
function buildChallengerPrompt(args: {
  ask: Ask;
  changes: Change[];
  decisions: string[];
}): string {
  return (
    `You are the CHALLENGER: confront the derived changes with the decisions ` +
    `the human has already made. You NEVER change anything — you only raise ` +
    `contradictions as questions, each with a recommended resolution.\n\n` +
    `THE ASK:\n${args.ask.text}\n\n` +
    `DECISIONS IN FORCE:\n${args.decisions.map((d) => `- ${d}`).join("\n")}\n\n` +
    `THE CHANGES:\n${describeChanges(args.changes)}\n\n` +
    `Respond with ONE JSON object and nothing else:\n` +
    `{"questions":[{"text":"the contradiction, named plainly (which change, ` +
    `which decision)","recommendation":"your recommended resolution"}]} — ` +
    `one entry per REAL contradiction. None → {"questions":[]}.`
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
  const TOTAL_STAGES = 7;
  let stageNo = 0;
  const stage = (label: string): void => {
    stageNo++;
    opts.onStage?.(label, stageNo, TOTAL_STAGES);
  };

  // 1. Contextualize (reuse a stored digest; otherwise one bounded reading).
  stage("reading your code");
  let digest = opts.digest ?? opts.digestStore?.load(ask.id);
  if (!digest) {
    const fresh = await runContextualize(deps, ask, round);
    if (fresh) {
      digest = fresh;
      opts.digestStore?.save(ask.id, fresh);
      log(`contextualize: digest established for ${ask.id}`);
    } else log(`contextualize: no digest — grounding reads cold`);
  }

  // 2. Ground.
  stage("deriving the changes");
  const grounded = await runGrounding(
    { ...deps, log },
    ask,
    { digest, nextIndex: opts.nextIndex, decisions: opts.decisions, mintId: opts.mintNodeId, scopes: opts.scopes },
    round,
  );
  let changes = grounded.changes;
  const questions: Omit<Question, "id">[] = [...grounded.questions];
  if (changes.length === 0) return { changes, questions };

  const stamp = [await readStamp(deps.repoRoot)];
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
    );
    changes = [...changes, ...added];
    log(`${label}: ${added.length} change(s) added`);
  };

  // 3. Gap-close judge (two outcomes: complete, or concrete additions).
  stage("judging completeness");
  await addFrom(
    await round(deps, buildGapClosePrompt({ ask, changes, repoRoot: deps.repoRoot })),
    "gap-close",
  );

  // 4. Impact pass (the adjacent code that must move too).
  stage("finding affected code");
  await addFrom(
    await round(deps, buildImpactPrompt({ ask, changes, repoRoot: deps.repoRoot })),
    "impact",
  );

  // 5. Intent coverage — uncovered clauses become questions, never silence.
  stage("checking every clause of your ask is covered");
  const coverage = await round(
    deps,
    buildIntentCoveragePrompt({ ask, changes, decisions: opts.decisions }),
  );
  if (coverage !== null)
    for (const u of parseUncovered(coverage))
      questions.push({
        askId: ask.id,
        text: `Uncovered: "${u.clause}" — ${u.text}`,
        recommendation: u.recommendation,
      });

  // 6. Criteria assessment — vague criteria come back observable.
  stage("sharpening the acceptance criteria");
  const assessed = await round(deps, buildCriteriaPrompt({ changes }));
  if (assessed !== null) {
    const rewrites = parseCriteriaRewrites(assessed, changes);
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
  }

  // 7. Challenger — contradictions with decisions in force become questions.
  stage("checking against your decisions");
  if (opts.decisions?.length) {
    const challenged = await round(
      deps,
      buildChallengerPrompt({ ask, changes, decisions: opts.decisions }),
    );
    if (challenged !== null)
      for (const q of parseGroundedQuestions(challenged))
        questions.push({ askId: ask.id, ...q });
  }

  return { changes, questions };
}
