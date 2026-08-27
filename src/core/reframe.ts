/**
 * Reframing: the one way to correct the machine. Everything derived comes
 * from the human's sentences, so a wrong reading, a wrong grouping and a
 * wrong assumption are all the same defect — a sentence that did not say
 * enough. Correcting the sentence fixes the cause; correcting the derived
 * shape fixes one symptom and leaves the cause to reproduce it.
 *
 * A sentence whose work is signed is never edited. Rewriting it would
 * change no code — the promises it produced are frozen — and would leave
 * the record claiming the software satisfies words nobody built against.
 * Changing something already committed is new work, so it arrives as a new
 * sentence that says what it amends.
 */
import { componentOf, promisesOf } from "./component";
import { Ask, Space } from "./schema";

/** What an edit will disturb, so the price is known before it is paid. */
export interface Price {
  /** Objects that must be read again. */
  subjects: number;
  /** Promises that will be discarded and derived afresh. */
  promises: number;
  /** Other sentences read again because they share those objects. */
  alsoReads: string[];
}

/** The cost of editing one sentence, computed from the record. */
export function priceOfEditing(space: Space, askId: string): Price {
  const c = componentOf(space, askId);
  if (!c) return { subjects: 0, promises: 0, alsoReads: [] };
  return {
    subjects: c.subjectIds.length,
    promises: promisesOf(space, c).length,
    alsoReads: c.askIds
      .filter((id) => id !== askId)
      .map((id) => space.asks.find((a) => a.id === id)?.text ?? "")
      .filter((t) => t.length > 0),
  };
}

export type ReframeResult =
  | { ok: true; space: Space; reread: string[] }
  | { ok: false; reason: string };

/**
 * Edit an open sentence in place. The derived work of its whole component
 * goes, because it was read under the old words; the sentences that share
 * those objects are named in `reread` so the caller can say what it cost.
 */
export function editAsk(
  space: Space,
  askId: string,
  text: string,
  /** Promises whose work was ACCEPTED, and so is in the project. Not the
   *  signed ones: an approval that never delivered anything holds nobody
   *  to anything, and a sentence whose run refused itself must not be
   *  frozen out of being said better. */
  merged: Set<string>,
): ReframeResult {
  const ask = space.asks.find((a) => a.id === askId);
  if (!ask) return { ok: false, reason: "no such sentence" };
  if (!text.trim()) return { ok: false, reason: "a sentence cannot be empty" };
  const c = componentOf(space, askId);
  const doomed = new Set(c ? promisesOf(space, c) : []);
  if ([...doomed].some((id) => merged.has(id)))
    return {
      ok: false,
      reason:
        "that sentence is delivered and accepted — its work is in the project. Say what you want now as a new sentence; the later words win.",
    };

  const subjects = new Set(c?.subjectIds ?? []);
  const claimIds = new Set(
    (space.claims ?? []).filter((x) => subjects.has(x.subjectId)).map((x) => x.id),
  );
  return {
    ok: true,
    reread: c?.askIds ?? [askId],
    space: {
      ...space,
      asks: space.asks.map((a) => (a.id === askId ? { ...a, text: text.trim() } : a)),
      // The reading of this component goes with the words it came from.
      subjects: (space.subjects ?? []).filter((s) => !subjects.has(s.id)),
      claims: (space.claims ?? []).filter((x) => !subjects.has(x.subjectId)),
      nodes: space.nodes.filter((n) => !doomed.has(n.id)),
      questions: space.questions.filter(
        (q) => !claimIds.has(q.askId) && !subjects.has(q.askId) && q.askId !== askId,
      ),
    },
  };
}

/** A new sentence that supersedes a bound one — the only way to change
 *  what was already built, because changing it is new work. */
export function amendAsk(
  space: Space,
  askId: string,
  text: string,
  at: string,
  id: string,
): { ok: true; space: Space; added: Ask } | { ok: false; reason: string } {
  if (!space.asks.some((a) => a.id === askId)) return { ok: false, reason: "no such sentence" };
  if (!text.trim()) return { ok: false, reason: "an amendment needs words" };
  const added: Ask = { id, text: text.trim(), at, amends: askId };
  return { ok: true, space: { ...space, asks: [...space.asks, added] }, added };
}
