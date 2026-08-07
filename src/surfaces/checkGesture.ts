/**
 * The unstick gesture, host side: the machine writes ONE check for a
 * promise that has none; the human accepts or rewords — their wording
 * wins. Refuses while the machine is busy so rounds never race.
 */
import { proposeCheck as proposeCheckRound } from "../derive/checks";
import type { TandemSession } from "./session";

export async function proposeCheckGesture(
  s: TandemSession,
  changeId: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (s.activity) return { ok: false, reason: "the machine is busy — wait for the current step to finish" };
  const n = s.space.nodes.find((x) => x.id === changeId);
  if (!n) return { ok: false, reason: `no promise '${changeId}'` };
  const ask = s.space.asks.find((a) => n.serves.includes(a.id));
  s.activity = { label: "writing a check for the promise", current: 1, total: 1 };
  s.deps.onChanged?.();
  const p = await (s.deps.proposeCheck ?? proposeCheckRound)(s.deps.round, n, ask?.text ?? "").catch(() => undefined);
  s.activity = undefined;
  if (p) s.pendingCheck = { changeId, ...p };
  s.deps.onChanged?.(p ? undefined : "The round could not write a check — try again or reword the promise.");
  return p ? { ok: true } : { ok: false, reason: "no check produced" };
}
