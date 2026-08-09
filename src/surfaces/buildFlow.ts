/**
 * The two acts that spend, and the one that commits.
 *
 * Going to look at the work starts the thinking — nothing speculative runs
 * before that, because a reading the human has not read yet is the most
 * expensive thing to be wrong about. Pressing Build commits: every
 * assumption nobody objected to becomes a rule, the components go into one
 * cut, and the sentences behind them become read-only.
 *
 * Silence is consent only at the moment of a press. Nothing here is ever
 * triggered by time passing, so walking away can neither spend money nor
 * lock a sentence.
 */
import { Component, components, promisesOf } from "../core/component";
import { Rule, Space } from "../core/schema";
import { signedIds } from "../core/cutClosure";
import type { TandemSession } from "./session";

/** What a component costs to think about, and what it will make true. */
export interface WorkCost {
  /** Objects still to be read. */
  subjects: number;
  /** Rounds it will take — three per object, plus one shared reading. */
  rounds: number;
}

/**
 * What can be built right now. Nothing is offered while the machine is
 * still deriving: a component whose objects are half thought about would
 * commit work that does not exist yet, and building is the one act that
 * cannot be undone.
 */
export function readyToBuild(
  space: Space,
  thinking: boolean,
): { objects: number; promises: number; thinking: boolean } {
  if (thinking || costOfThinking(space).subjects > 0)
    return { objects: 0, promises: 0, thinking: true };
  const cs = buildable(space);
  return {
    objects: cs.reduce((n, c) => n + c.subjectIds.length, 0),
    promises: cs.reduce((n, c) => n + promisesOf(space, c).length, 0),
    thinking: false,
  };
}

/** The price of thinking about what has not been ground yet. */
export function costOfThinking(space: Space): WorkCost {
  const ground = new Set(
    space.nodes.flatMap((n) => n.serves).filter((s) => s.startsWith("subject-")),
  );
  const subjects = (space.subjects ?? []).filter((s) => !ground.has(s.id)).length;
  return { subjects, rounds: subjects ? subjects * 3 + 1 : 0 };
}

/** Everything ready to build: components with promises and nothing signed. */
function buildable(space: Space): Component[] {
  const signed = signedIds(space.cuts);
  return components(space).filter((c) => {
    const ids = promisesOf(space, c);
    return ids.length > 0 && !ids.some((id) => signed.has(id));
  });
}

/**
 * Assumptions become rules at the press, never before — so silence never
 * hardens into law nobody read. They are marked as assumed, because a rule
 * the human did not write is weaker than one they did.
 */
function assumptionsAsRules(space: Space, author: string): Rule[] {
  const subjects = (space.subjects ?? []).map((s) => s.id);
  const existing = new Set((space.rules ?? []).map((r) => r.text.trim().toLowerCase()));
  const out: Rule[] = [];
  for (const q of space.questions) {
    const text = (q.decided?.text ?? q.recommendation ?? "").trim();
    if (!text || existing.has(text.toLowerCase())) continue;
    existing.add(text.toLowerCase());
    out.push({
      id: `rule-${author}-${(space.rules?.length ?? 0) + out.length + 1}`,
      text,
      scope: q.clause ? `where ${q.clause}` : "every subject",
      fromAsk: q.askId,
      governs: subjects,
      ...(q.decided ? {} : { assumed: true }),
    });
  }
  return out;
}

/**
 * Build. One cut over every component the human left in, so a sentence is
 * never half-committed, and one TEP over all of them — the work orders
 * inside it are still formed per file, which is what keeps building safe.
 */
export async function buildFlow(
  s: TandemSession,
  excluded: string[] = [],
): Promise<{ ok: boolean; reason?: string }> {
  // Refused while anything is still being derived. A half-thought object
  // would commit work that does not exist yet, and this is the one act
  // that cannot be undone — so the guard is here, in the act itself, not
  // in a button the surface can forget to hide.
  const state = readyToBuild(s.space, !!s.activity || s.groundingView().length > 0);
  if (state.thinking)
    return {
      ok: false,
      reason:
        "still working out what to build — nothing can be committed until every object is thought through",
    };

  const out = new Set(excluded);
  const included = buildable(s.space).filter(
    (c) => !c.subjectIds.some((id) => out.has(id)) && !c.askIds.some((id) => out.has(id)),
  );
  if (!included.length) return { ok: false, reason: "nothing to build" };

  // The press is the moment of consent. Every assumption nobody objected
  // to becomes a rule AND a decision on the record at the same instant —
  // so nothing is signed while something is still undecided, and nothing
  // hardens into law before the human commits to building.
  const rules = assumptionsAsRules(s.space, s.author);
  const at = s.deps.now();
  if (rules.length)
    s.space = {
      ...s.space,
      rules: [...(s.space.rules ?? []), ...rules],
      questions: s.space.questions.map((q) =>
        q.decided || !q.recommendation ? q : { ...q, decided: { text: q.recommendation, at } },
      ),
    };

  const ids = included.flatMap((c) => promisesOf(s.space, c));
  s.cutNodeIds = new Set(ids);
  s.changed(
    `Building ${included.length} object group(s) — ${ids.length} promise(s)` +
      (rules.length ? `, ${rules.length} assumption(s) now in force` : "") +
      ". The sentences behind them are read-only from now on.",
  );
  return s.signCut();
}
