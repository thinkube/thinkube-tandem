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
import { promisesOfSpec } from "../derive/specs";
import { Space, Spec } from "../core/schema";
import { signedIds } from "../core/cutClosure";
import type { TandemSession } from "./session";

/** What a component costs to think about, and what it will make true. */
export interface WorkCost {
  /** Objects still to be read. */
  subjects: number;
  /** Rounds it will take — two per subject (ground, then the cheap tail),
   *  plus one shared reading of the code and one whole-cut search for what
   *  is still missing. */
  rounds: number;
}

/**
 * What can be built right now. Nothing is offered while the machine is
 * still deriving: a component whose subjects are half thought about would
 * commit work that does not exist yet, and building is the one act that
 * cannot be undone.
 */
export function readyToBuild(
  space: Space,
  thinking: boolean,
  /** The thing in hand. With one chosen, readiness is that thing's alone:
   *  the others are not being built, so what they still cost to think
   *  about is not a reason to wait. */
  chosen?: Spec,
): { subjects: number; promises: number; asks: number; thinking: boolean } {
  if (thinking || costOfThinking(space, chosen?.subjectIds).subjects > 0)
    return { subjects: 0, promises: 0, asks: 0, thinking: true };
  if (chosen) {
    const signed = signedIds(space.cuts);
    const promises = promisesOfSpec(space, chosen).filter((id) => !signed.has(id));
    const subjects = (space.subjects ?? []).filter((s) => chosen.subjectIds.includes(s.id));
    return {
      subjects: subjects.length,
      promises: promises.length,
      asks: new Set(subjects.flatMap((s) => s.from)).size,
      thinking: false,
    };
  }
  const cs = buildable(space);
  return {
    subjects: cs.reduce((n, c) => n + c.subjectIds.length, 0),
    promises: cs.reduce((n, c) => n + promisesOf(space, c).length, 0),
    // The sentences this press would lock: the price the human pays that
    // is not money, so it is named in the same breath as the money.
    asks: new Set(cs.flatMap((c) => c.askIds)).size,
    thinking: false,
  };
}

/**
 * The price of thinking about what has not been ground yet.
 *
 * A reading the human has not kept yet counts too. It is what going on to
 * the work page will keep and then think about, so leaving it out said
 * everything here has been thought about already, over a page of subjects
 * nobody had spent a round on — and the press that was supposed to start
 * the thinking started nothing at all.
 */
export function costOfThinking(space: Space, only?: readonly string[]): WorkCost {
  const ground = new Set(
    space.nodes.flatMap((n) => n.serves).filter((s) => s.startsWith("subject-")),
  );
  // With a thing in hand, only its subjects are priced: the others are not
  // being thought about, and pricing them offered to work out the wrong
  // things under the name of the one chosen.
  const mine = (space.subjects ?? []).filter((s) => !only || only.includes(s.id));
  const subjects =
    mine.filter((s) => !ground.has(s.id)).length +
    (only ? 0 : (space.proposal?.subjects.length ?? 0));
  return { subjects, rounds: subjects ? subjects * 2 + 2 : 0 };
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
 * Build. One cut over every component the human left in, so a sentence is
 * never half-committed, and one TEP over all of them — the work orders
 * inside it are still formed per file, which is what keeps building safe.
 */
export async function buildFlow(
  s: TandemSession,
  specId: string,
): Promise<{ ok: boolean; reason?: string }> {
  // Refused while anything is still being derived. A half-thought subject
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

  const spec = (s.space.specs ?? []).find((x) => x.id === specId);
  if (!spec) return { ok: false, reason: `no set called '${specId}' — group your asks into sets first` };
  const ids = promisesOfSpec(s.space, spec);
  if (!ids.length)
    return { ok: false, reason: `nothing is derived from "${spec.name}" yet — work it out first` };
  const signed = signedIds(s.space.cuts);
  if (ids.every((id) => signed.has(id)))
    return { ok: false, reason: `"${spec.name}" is already built` };

  // The press is the moment of consent: every assumption nobody objected
  // to becomes a decision on the record at that instant, and from then on
  // every derivation in this space runs under it. Nothing hardens before
  // the human commits to building, and nothing is signed while something
  // is still undecided.
  const at = s.deps.now();
  const settled = s.space.questions.filter((q) => !q.decided && q.recommendation).length;
  if (settled)
    s.space = {
      ...s.space,
      questions: s.space.questions.map((q) =>
        q.decided || !q.recommendation ? q : { ...q, decided: { text: q.recommendation, at } },
      ),
    };

  s.cutNodeIds = new Set(ids);
  s.cutSpecId = spec.id;
  s.changed(
    `Building "${spec.name}" — ${ids.length} promise(s)` +
      (settled ? `, ${settled} assumption(s) now in force` : "") +
      ". The sentences behind them are read-only from now on.",
  );
  return s.signCut();
}
