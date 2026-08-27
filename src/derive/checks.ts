/**
 * The check-proposal round: for one promise without a check, the machine
 * proposes one — a runnable check when a test can honestly reach it, an
 * assessment check (graded by a fresh, independent assessor at delivery)
 * when none can. The human accepts or rewords; their wording wins.
 */
import { Change } from "../core/schema";
import { RoundDeps, runReadRound } from "./round";

export interface ProposedCheck {
  text: string;
  kind: "probe" | "assessment";
}

function buildCheckPrompt(promise: Change, askText: string): string {
  const lands = (promise.grounding?.touchpoints ?? [])
    .map((t) => t.path + (t.symbol ? ` › ${t.symbol}` : ""))
    .join(", ");
  return (
    `A promise needs its check — one concrete way to prove it was delivered.\n\n` +
    `THE PROMISE: ${promise.sentence}\n` +
    `SERVES THE ASK: ${askText}\n` +
    (lands ? `LANDS AT: ${lands}\n` : "") +
    `\nWrite ONE check in plain English a non-programmer understands.\n` +
    `- If an automated test can honestly verify it, kind is "probe" and the\n` +
    `  text states what the test observes (state what the code produces —\n` +
    `  never the act of a person using it).\n` +
    `- If no runnable test fits (how something looks, reads, or feels),\n` +
    `  kind is "assessment": the text states what an independent reviewer\n` +
    `  must confirm against the ask's own words.\n` +
    `Answer with ONLY JSON: {"text": "...", "kind": "probe"|"assessment"}`
  );
}

function parseProposedCheck(raw: string | null): ProposedCheck | undefined {
  if (!raw) return undefined;
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a < 0 || b <= a) return undefined;
  try {
    const p = JSON.parse(raw.slice(a, b + 1)) as { text?: unknown; kind?: unknown };
    if (typeof p.text !== "string" || !p.text.trim()) return undefined;
    return { text: p.text.trim(), kind: p.kind === "assessment" ? "assessment" : "probe" };
  } catch {
    return undefined;
  }
}

export async function proposeCheck(
  deps: RoundDeps,
  promise: Change,
  askText: string,
): Promise<ProposedCheck | undefined> {
  return parseProposedCheck(
    await runReadRound(
      { ...deps, model: deps.volumeModel ?? deps.model, maxTurns: 6 },
      buildCheckPrompt(promise, askText),
    ),
  );
}
