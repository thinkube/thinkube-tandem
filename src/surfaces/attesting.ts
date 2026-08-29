/**
 * Recording what only a person could settle.
 *
 * Some promises are answered nowhere a machine can look: the installer
 * ran on a clean node, or it did not; the running product did the thing,
 * or it did not. Those ride the delivery as pending until the person who
 * has it says. Their words close that one promise and move nothing else —
 * a machine saying it held would be inventing the single verdict it
 * cannot reach, which is why the boundary reserves this gesture entirely.
 */
import { attest } from "../run/harvest";
import type { TandemSession } from "./session";

export function attestOn(
  s: TandemSession,
  deliveryId: string,
  criterionId: string,
  held: boolean,
  note?: string,
): { ok: boolean; reason?: string } {
  const d = s.space.deliveries.find((x) => x.id === deliveryId);
  if (!d) return { ok: false, reason: `no delivery '${deliveryId}'` };
  const r = attest(d, criterionId, {
    held,
    ...(note ? { note } : {}),
    by: s.author,
    at: s.deps.now(),
  });
  if ("refused" in r) return { ok: false, reason: r.refused };
  s.space = { ...s.space, deliveries: s.space.deliveries.map((x) => (x.id === r.id ? r : x)) };
  s.changed(`Attested: ${held ? "it held" : "it did not hold"}.`);
  return { ok: true };
}
