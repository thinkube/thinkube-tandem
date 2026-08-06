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
    args.round,
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
