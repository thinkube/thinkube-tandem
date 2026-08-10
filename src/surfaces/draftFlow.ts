/**
 * The draft: what you are writing, before any of it is an ask.
 *
 * It is kept with the space, so closing the window mid-sentence loses
 * nothing. Nothing is derived from it, nothing is locked by it, and it
 * costs nothing — only the readings you ask for cost anything, and those
 * are yours to ask for as often as you like.
 */
import { addAsk } from "../core/intent";
import { asksOfText } from "../derive/asks";
import { readEverything } from "./modelFlow";
import type { TandemSession } from "./session";

export function readDraftFlow(s: TandemSession): Promise<{ ok: boolean; reason?: string }> {
  if (!asksOfText(s.space.draft ?? "").length)
    return Promise.resolve({ ok: false, reason: "there is nothing written yet" });
  return readEverything(s);
}

/**
 * Keep the reading: the draft's lines become asks, in order and word for
 * word, and the reading already on screen becomes their model.
 *
 * It spends nothing. Everything the cards are made of was worked out when
 * the draft was read; this binds each sentence number in that reading to
 * the ask it just became. A reading that no longer matches what is
 * written is refused rather than quietly re-run — recording asks under a
 * model built from different words is the one thing this must never do.
 */
export function keepDraftFlow(s: TandemSession): { ok: boolean; reason?: string } {
  const pending = s.space.proposal;
  if (!pending) return { ok: false, reason: "nothing has been read yet" };
  const recorded = s.space.asks.length;
  const written = asksOfText(s.space.draft ?? "").map((a) => a.text);
  const read = pending.texts.slice(recorded);
  if (!written.length) return { ok: false, reason: "there is nothing written yet" };
  if (written.length !== read.length || written.some((t, i) => t !== read[i]))
    return { ok: false, reason: "what is written has changed since it was read — read it again" };
  const ids: string[] = [];
  for (const t of written) {
    const r = addAsk(s.space, t, s.deps.now(), `ask-${s.author}-${s.space.asks.length + 1}`);
    if (!r.ok) return { ok: false, reason: r.reason };
    s.space = r.space;
    ids.push(r.added.id);
  }
  s.space = {
    ...s.space,
    draft: "",
    proposal: { ...pending, askIds: [...pending.askIds.slice(0, recorded), ...ids] },
  };
  s.changed(`${ids.length} ask${ids.length === 1 ? "" : "s"} recorded, word for word.`);
  return { ok: true };
}
