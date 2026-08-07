/**
 * The list-paste: every ask lands on the list at once, the repository is
 * read ONCE, then the asks ground five at a time on that shared reading.
 * The start message says honestly how many think NOW and how many wait;
 * each ask row carries its own progress; one summary at the end — never a
 * toast per ask.
 */
import { addAsk } from "../core/intent";
import type { TandemSession } from "./session";

export async function captureManyFlow(
  s: TandemSession,
  texts: string[],
): Promise<{ ok: boolean; reason?: string }> {
    const added: { id: string; text: string; at: string }[] = [];
    for (const t of texts) {
      const r = addAsk(s.space, t, s.deps.now(), `ask-${s.author}-${s.space.asks.length + 1}`);
      if (!r.ok) return { ok: false, reason: r.reason };
      s.space = r.space;
      added.push(r.added);
    }
    const pool = Math.min(5, added.length);
    s.changed(
      `${added.length} asks recorded — reading your code once, then thinking about ${pool}` +
        (added.length > pool ? `; the other ${added.length - pool} wait their turn` : "") +
        ".",
    );
    // The whole batch grounds on ONE reading: establish it before the
    // fan-out, so no worker spends its turn re-reading the same code.
    await s.warmRepoDigest();
    for (const a of added) s._grounding.set(a.id, { label: "waiting", current: 0, total: 4 });
    s.changed();
    let next = 0;
    const tally = { promises: 0, questions: 0 };
    const worker = async (): Promise<void> => {
      while (next < added.length) {
        const t = await s.groundAsk(added[next], `p${++next}`, true);
        tally.promises += t.promises;
        tally.questions += t.questions;
      }
    };
    await Promise.all(Array.from({ length: pool }, worker));
    s.changed(
      `Derived ${tally.promises} promise(s) across ${added.length} asks.` +
        (tally.questions ? ` ${tally.questions} question(s) need you.` : ""),
    );
    await s.renderAbstracts();
    return { ok: true };
  }
