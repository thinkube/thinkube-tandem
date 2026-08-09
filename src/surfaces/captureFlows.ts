/**
 * The non-ask capture flows, factored out of the session: a question is
 * answered from the space and the code and recorded nowhere; a statement
 * becomes a decision in force born settled.
 */
import { Question, Space } from "../core/schema";
import { RoundDeps, runReadRound } from "../derive/round";
import { buildAnswerPrompt } from "../derive/classify";
import { DigestStore } from "../derive/pipeline";

export async function answerQuestionFlow(args: {
  round: RoundDeps;
  space: Space;
  text: string;
  decisions: string[];
  digests: DigestStore;
  answerRound?: typeof runReadRound;
}): Promise<{ question: string; answer: string }> {
  const lastAsk = args.space.asks[args.space.asks.length - 1];
  const answer = await (args.answerRound ?? runReadRound)(
    { ...args.round, model: args.round.volumeModel ?? args.round.model, maxTurns: 12 },
    buildAnswerPrompt({
      text: args.text,
      asks: args.space.asks,
      decisions: args.decisions,
      digest: lastAsk ? args.digests.load(lastAsk.id) : undefined,
      repoRoot: args.round.repoRoot,
    }),
  );
  return {
    question: args.text,
    answer: answer?.trim() || "I could not answer that from the space or the code.",
  };
}

export function statementFlow(
  space: Space,
  author: string,
  now: string,
  text: string,
): Space {
  const q: Question = {
    id: `q-${author}-${space.questions.length + 1}`,
    askId: "",
    text,
    decided: { text, at: now },
  };
  return { ...space, questions: [...space.questions, q] };
}

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
  return {
    space: {
      ...space,
      nodes: [],
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
