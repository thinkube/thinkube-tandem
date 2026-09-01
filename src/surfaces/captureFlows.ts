/**
 * What a decision does to work already derived, and the wipe that clears
 * derived thinking without touching a word the human wrote.
 */
import { Space } from "../core/schema";

/** The human's accept on a question: the recommendation (or their edited
 *  wording) becomes a DECISION, and — TEP-22 — its implication on the
 *  affected ask is STAGED, never auto-applied. */
export function decideQuestionFlow(args: {
  space: Space;
  questionId: string;
  editedText: string | undefined;
  now: string;
  author: string;
}): { space: Space; staged: boolean; askId?: string } | { reason: string } {
  const q = args.space.questions.find((x) => x.id === args.questionId);
  if (!q) return { reason: `no question '${args.questionId}'` };
  if (q.decided) return { reason: "already decided" };
  const text = (args.editedText ?? q.recommendation ?? "").trim();
  if (!text) return { reason: "a decision cannot be empty" };
  let space: Space = {
    ...args.space,
    questions: args.space.questions.map((x) =>
      x.id === args.questionId ? { ...x, decided: { text, at: args.now } } : x,
    ),
  };
  const staged = !!q.askId;
  if (q.askId)
    space = {
      ...space,
      impacts: [
        ...(space.impacts ?? []),
        {
          id: `impact-${args.author}-${(space.impacts ?? []).length + 1}`,
          questionId: args.questionId,
          askId: q.askId,
          decision: text,
        },
      ],
    };
  return { space, staged, ...(q.askId ? { askId: q.askId } : {}) };
}

/** Panic: wipe everything DERIVED — asks and deliveries survive (your
 *  words and history are never machine-deleted), decided questions stay in
 *  force; nodes, open questions and unsigned cuts go. Refused once
 *  any TEP was signed — a frozen scope is not erasable. */
export function panicFlow(space: Space): { space: Space } | { reason: string } {
  if (space.cuts.some((c) => c.signature))
    return { reason: "a TEP was already signed in this space — panic is refused after a freeze" };
  // Everything derived goes, and only what you wrote stays. The reading is
  // derived like the rest of it: leaving the subjects and claims behind left
  // no way back to plain sentences, so a space could never be read again —
  // its first reading was its only one, however much better a later one
  // would be.
  return {
    space: {
      ...space,
      nodes: [],
      subjects: [],
      claims: [],
      specs: [],
      proposal: undefined,
      questions: space.questions.filter((q) => q.decided),
      cuts: [],
    },
  };
}

/** The human's accepted check lands on the promise; assessment checks are
 *  graded by an independent reviewer at delivery, probe checks become
 *  runnable tests. */
export function addCheckFlow(
  space: Space,
  changeId: string,
  text: string,
  kind: "probe" | "assessment",
  author: string,
): { space: Space; message: string } | { reason: string } {
  if (!text.trim()) return { reason: "a check cannot be empty" };
  const n = space.nodes.find((x) => x.id === changeId);
  if (!n) return { reason: `no promise '${changeId}'` };
  return {
    space: {
      ...space,
      nodes: space.nodes.map((x) =>
        x.id === changeId
          ? {
              ...x,
              acceptance: [
                ...x.acceptance,
                { id: `c-${author}-${x.acceptance.length + 1}`, text: text.trim(), kind },
              ],
            }
          : x,
      ),
    },
    message:
      kind === "assessment"
        ? "Check added — an independent reviewer will grade it at delivery."
        : "Check added — it becomes a runnable test at delivery.",
  };
}
