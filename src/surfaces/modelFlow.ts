/**
 * Capture through the model: the pasted sentences become asks (the human's
 * words, kept whole), the model round proposes what they are about, and the
 * proposal waits for the human. Nothing is ground until they accept it —
 * a wrong reading costs one cheap round, not seven expensive ones.
 */
import { Claim, Rule, Space, Subject } from "../core/schema";
import { addAsk } from "../core/intent";
import { ProposedModel, solveModel, unaccountedFor } from "../derive/model";
import { judgeScope, ScopeQuestion } from "../derive/scope";
import type { TandemSession } from "./session";

export interface PendingModel {
  /** The asks these sentences became, in order. */
  askIds: string[];
  model: ProposedModel;
  /** Sentence numbers the round accounted for nowhere — shown, never hidden. */
  missing: number[];
}

/** Why a reading failed, kept so the human can see it and try again. */
export interface ModelFailure {
  reason: string;
  texts: string[];
  askIds: string[];
}

/** Record the sentences as asks, then ask the round what they are about. */
export async function proposeModelFlow(
  s: TandemSession,
  texts: string[],
): Promise<{ ok: boolean; reason?: string }> {
  const added: string[] = [];
  for (const t of texts) {
    const r = addAsk(s.space, t, s.deps.now(), `ask-${s.author}-${s.space.asks.length + 1}`);
    if (!r.ok) return { ok: false, reason: r.reason };
    s.space = r.space;
    added.push(r.added.id);
  }
  s.changed(`${added.length} recorded — reading them as one description…`);
  return readModel(s, texts, added);
}

/** Read again, over the sentences already recorded. */
export async function retryModel(s: TandemSession): Promise<{ ok: boolean; reason?: string }> {
  const f = s.modelFailure;
  if (!f) return { ok: false, reason: "nothing to read again" };
  s.modelFailure = undefined;
  return readModel(s, f.texts, f.askIds);
}

/**
 * The reading itself. It either produces a model the human can check, or it
 * FAILS — and says so. There is no fallback: a reading that quietly becomes
 * one subject per sentence looks exactly like a working model and is the
 * old shape wearing new words.
 */
async function readModel(
  s: TandemSession,
  texts: string[],
  askIds: string[],
): Promise<{ ok: boolean; reason?: string }> {
  s.activity = { label: "reading your list as one description", current: 1, total: 1 };
  s.deps.onChanged?.();
  // The round's own failure lines are the diagnosis; without them a failed
  // reading is a mystery.
  const said: string[] = [];
  const model = await (s.deps.solveModel ?? solveModel)(
    { ...s.deps.round, log: (line) => said.push(line) },
    texts,
  ).catch((err: unknown) => {
    said.push(err instanceof Error ? err.message : String(err));
    return undefined;
  });
  s.activity = undefined;

  if (!model) {
    s.modelFailure = {
      reason: said.join("\n").trim() || "the round returned nothing I could read as subjects and claims",
      texts,
      askIds,
    };
    s.changed("I could not read your list. Nothing was derived — your sentences are recorded and waiting.");
    return { ok: false, reason: s.modelFailure.reason };
  }

  s.pendingModel = { askIds, model, missing: unaccountedFor(model, texts.length) };
  s.changed(
    `${model.subjects.length} subject(s) and ${model.rules.length} rule(s) — check them before I think about the code.`,
  );
  return { ok: true };
}

/** The human accepted: the proposal becomes the space's model. */
export function applyModel(space: Space, pending: PendingModel, author: string): Space {
  const subjects: Subject[] = [];
  const claims: Claim[] = [];
  const rules: Rule[] = [];
  const askOf = (n: number): string => pending.askIds[n - 1] ?? pending.askIds[0] ?? "";

  pending.model.subjects.forEach((sub, i) => {
    const id = `subject-${author}-${(space.subjects?.length ?? 0) + i + 1}`;
    subjects.push({ id, name: sub.name, from: sub.from.map(askOf) });
    sub.claims.forEach((c, j) => {
      claims.push({
        id: `claim-${author}-${(space.claims?.length ?? 0) + claims.length + j + 1}`,
        subjectId: id,
        text: c.text,
        ...(c.why ? { why: c.why } : {}),
        fromAsk: askOf(c.from),
      });
    });
  });
  pending.model.rules.forEach((r, i) => {
    rules.push({
      id: `rule-${author}-${(space.rules?.length ?? 0) + i + 1}`,
      text: r.text,
      scope: r.scope,
      fromAsk: askOf(r.from),
      governs: subjects.map((s) => s.id),
    });
  });

  return {
    ...space,
    subjects: [...(space.subjects ?? []), ...subjects],
    claims: [...(space.claims ?? []), ...claims],
    rules: [...(space.rules ?? []), ...rules],
  };
}

/**
 * Every rule already in force is tested against every subject that has not
 * been judged against it — once, when the subject appears. A rule promoted
 * in round one therefore reaches a subject captured in round three, before
 * that subject grounds.
 */
export async function inheritRules(s: TandemSession): Promise<number> {
  const rules = s.space.rules ?? [];
  const subjects = s.space.subjects ?? [];
  const judged = s.space.judgedScope ?? [];
  const pairs: ScopeQuestion[] = [];
  for (const r of rules)
    for (const sub of subjects) {
      const key = `${r.id}|${sub.id}`;
      if (r.governs.includes(sub.id) || judged.includes(key)) continue;
      pairs.push({
        ruleId: r.id,
        ruleText: r.text,
        scope: r.scope,
        subjectId: sub.id,
        subjectName: sub.name,
      });
    }
  if (!pairs.length) return 0;

  const yes = await (s.deps.judgeScope ?? judgeScope)(s.deps.round, pairs);
  const gained = new Set(yes.map((p) => `${p.ruleId}|${p.subjectId}`));
  s.space = {
    ...s.space,
    // Judged once, remembered: a "no" is a decision too, not a question the
    // machine re-asks every time the space is opened.
    judgedScope: [...judged, ...pairs.map((p) => `${p.ruleId}|${p.subjectId}`)],
    rules: rules.map((r) => ({
      ...r,
      governs: [
        ...r.governs,
        ...pairs
          .filter((p) => p.ruleId === r.id && gained.has(`${p.ruleId}|${p.subjectId}`))
          .map((p) => p.subjectId),
      ],
    })),
  };
  return gained.size;
}
