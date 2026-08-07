/**
 * The capture classifier — the interpreter's audited rules on the one seam
 * every surface shares. An utterance is exactly one of a closed vocabulary:
 * an ASK (something to build — the normal case), a QUESTION (answered from
 * the space and the code, recorded nowhere), a STATEMENT (a fact the human
 * is settling — it becomes a decision in force, born settled), or an
 * OPERATION (an instruction about the space itself — routed like an ask
 * today; the space's verbs are the buttons). Fail-soft: an unclassifiable
 * utterance is an ask, never a refusal.
 */
import { Ask } from "../core/schema";
import { RoundDeps, runReadRound, volumeDeps } from "./round";

export type UtteranceKind = "ask" | "question" | "statement" | "operation";

function buildClassifyPrompt(text: string): string {
  return (
    `Classify ONE utterance a person typed into a pair-development capture ` +
    `box. Exactly one verdict from the closed vocabulary:\n` +
    `- "ask": they want something built or changed (imperative or desire — the normal case).\n` +
    `- "question": they want to KNOW something; nothing should be built from it.\n` +
    `- "statement": they are settling a fact or constraint the machine must build under.\n` +
    `- "operation": an instruction about the workspace/process itself (undo, clear, rename).\n\n` +
    `THE UTTERANCE:\n${text}\n\n` +
    `Respond with ONE JSON object and nothing else: {"kind":"ask|question|statement|operation"}.`
  );
}

function parseKind(raw: string | null): UtteranceKind {
  if (!raw) return "ask";
  const m = raw.match(/"kind"\s*:\s*"(ask|question|statement|operation)"/);
  return (m?.[1] as UtteranceKind) ?? "ask";
}

/**
 * List-paste detection: numbered, bulleted, or plain multi-line text splits
 * into one ask per item — previewed before anything is recorded. Null when
 * the text is a single utterance.
 */
export function splitList(text: string): string[] | null {
  const items: string[] = [];
  let markers = 0;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (/^(\d+[.)]|[-*•])\s+/.test(t)) {
      markers++;
      items.push(t.replace(/^\d+[.)]\s+/, "").replace(/^[-*•]\s+/, "").trim());
    } else if (items.length) {
      // A wrapped continuation of the item above it — fold, never split.
      items[items.length - 1] += " " + t;
    } else {
      items.push(t);
    }
  }
  // Two or more MARKED items is a list; unmarked multi-line stays one ask
  // (people write paragraphs).
  if (markers < 2 || items.length < 2) return null;
  return items.filter(Boolean);
}

export async function classifyUtterance(
  deps: RoundDeps,
  text: string,
  round: (deps: RoundDeps, prompt: string) => Promise<string | null> = runReadRound,
): Promise<UtteranceKind> {
  return parseKind(await round(volumeDeps(deps), buildClassifyPrompt(text)));
}

export function buildAnswerPrompt(args: {
  text: string;
  asks: Ask[];
  decisions: string[];
  digest?: string;
  repoRoot: string;
}): string {
  return (
    `Answer ONE question from a person pairing on this repository ` +
    `(${args.repoRoot}). Answer from the space below and the code (read what ` +
    `you need); plain language, short; cite paths for code claims. This is a ` +
    `reply, not a plan — change nothing, propose nothing.\n\n` +
    `THE QUESTION:\n${args.text}\n\n` +
    (args.asks.length
      ? `THE SPACE'S ASKS:\n${args.asks.map((a) => `- ${a.text}`).join("\n")}\n\n`
      : "") +
    (args.decisions.length
      ? `DECISIONS IN FORCE:\n${args.decisions.map((d) => `- ${d}`).join("\n")}\n\n`
      : "") +
    (args.digest ? `WHAT THE CODE LOOKS LIKE:\n${args.digest}\n` : "")
  );
}
