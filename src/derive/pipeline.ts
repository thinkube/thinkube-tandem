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
import { runContextualize } from "./contextualize";
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

/**
 * Establish the shared repository digest when the cache misses. Callers
 * that fan out call this BEFORE the fan-out: every branch then grounds
 * warm, and no branch spends its turn re-reading the same code.
 */
export async function ensureRepoDigest(
  deps: RoundDeps,
  store: DigestStore,
  round: Round = runReadRound,
): Promise<void> {
  const key = await digestKeyFor(deps.repoRoot);
  if (store.load(key)) return;
  const fresh = await sharedRepoDigest(key, digestDeps(deps), round);
  if (fresh) store.save(key, fresh);
}

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

/** Build the completeness prompt — one round that both judges the set
 *  complete and finds the adjacent code that must move too. */
function buildCompletenessPrompt(args: {
  ask: Ask;
  changes: Change[];
  repoRoot: string;
  digest?: string;
  claims?: { text: string; why?: string }[];
}): string {
  return (
    `You are the COMPLETENESS round: given ONE ask and the changes derived ` +
    `from it, return every change the set still MISSES — in both senses:\n` +
    `1. GAPS: something the ask requires that no change covers.\n` +
    `2. AFFECTED CODE: other places in the repository at ${args.repoRoot} ` +
    `that must move too — callers of touched symbols, configuration that ` +
    `names touched files, documentation that states the old behavior.\n` +
    `Grep for the touched symbols and paths; read what the hits demand.\n\n` +
    (args.digest
      ? `REPOSITORY DIGEST (an established reading — build on it, verify ` +
        `only what you must):\n${args.digest}\n\n`
      : "") +
    `THE ASK:\n${args.ask.text}\n\n` +
    `THE DERIVED CHANGES:\n${describeChanges(args.changes)}\n\n` +
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
    `"acceptance":[{"text":"…"}]}]} — each node one MISSING or AFFECTED ` +
    `change in the same shape grounding uses (needs indices refer to THIS ` +
    `list only). Complete and nothing affected → {"nodes":[]}. Never ` +
    `restate an existing change; only genuine gaps and real ripples.`
  );
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
      changes: args.changes,
      repoRoot: deps.repoRoot,
      digest: args.digest,
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

  // 1. Repository digest — ONE shared reading per repo state, cached under
  //    the git stamp and reused across asks, batches and sessions.
  const stamp = [await readStamp(deps.repoRoot)];
  const digestKey = await digestKeyFor(deps.repoRoot);
  let digest = opts.digest ?? opts.digestStore?.load(digestKey);
  stage(digest ? "using what I read of your code" : "reading your code");
  if (!digest) {
    const fresh = await sharedRepoDigest(digestKey, digestDeps(deps), round);
    if (fresh) {
      digest = fresh;
      opts.digestStore?.save(digestKey, fresh);
      log(`contextualize: repository digest established (${digestKey})`);
    } else log(`contextualize: no digest — grounding reads cold`);
  }

  // 2. Ground.
  stage("deriving the changes");
  const grounded = await runGrounding(
    { ...deps, log },
    ask,
    {
      digest,
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
  if (changes.length === 0) return { changes, questions };

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
        changes,
        repoRoot: deps.repoRoot,
        digest,
        ...(opts.claims ? { claims: opts.claims } : {}),
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

  // Nothing goes to the human in the machine's own words. What is refused
  // keeps its answer — it becomes an assumption the machine states.
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

  return { changes, questions: kept };
}
