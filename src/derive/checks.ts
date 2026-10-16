/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The check-proposal round: for one promise without a check, the machine
 * proposes one — a runnable check when a test can honestly reach it, an
 * assessment check (graded by a fresh, independent assessor at delivery)
 * when none can. The human accepts or rewords; their wording wins.
 */
import { Change } from "../core/schema";
import { jsonSchemaOf, readAnswer, RoundDeps, runReadRound } from "./round";
import { z } from "zod";

export interface ProposedCheck {
  text: string;
  kind: "probe" | "assessment";
}

/** The shape the check-proposal round answers in. */
const CheckAnswer = z.object({ text: z.string(), kind: z.enum(["probe", "assessment"]) });

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
  const p = readAnswer(CheckAnswer, raw);
  if (!p || !p.text.trim()) return undefined;
  return { text: p.text.trim(), kind: p.kind };
}

export async function proposeCheck(
  deps: RoundDeps,
  promise: Change,
  askText: string,
): Promise<ProposedCheck | undefined> {
  return parseProposedCheck(
    await runReadRound(
      { ...deps, model: deps.volumeModel ?? deps.model, maxTurns: 6, schema: jsonSchemaOf(CheckAnswer) },
      buildCheckPrompt(promise, askText),
    ),
  );
}
