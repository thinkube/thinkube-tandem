/**
 * What only the running product can show is an observation, not a check.
 *
 * The schema has said it from the start: effects the machine cannot verify
 * ride the promise as `unverified`, "reported on the delivery as not
 * verified — the machine never assigns the person a check." A criterion
 * like "in the running extension, opening two spaces shows two tabs" slips
 * past that when the derivation words it as a check, and then no gate can
 * be honest about it: red withholds the delivery the observation needs,
 * green claims somebody saw what nobody saw.
 *
 * So the classification is a rule of the design, applied wherever a
 * criterion enters the machine — never a mercy at the gate. Deterministic,
 * by the words that name a person watching a running product; a wording
 * this misses is the grounder's to catch, and one it wrongly catches is
 * visible on the cut review before signing.
 */
import type { Change, Cut, Space } from "../core/schema";

const RUNNING_PRODUCT =
  /\b(in|inside|within) the running\b|\brunning (extension|editor|app|application|product|site)\b|\bthe (user|person) (sees|watches|opens|clicks|drags|scrolls)\b|\bon (the )?screen\b|\bvisually\b|\bby hand\b|\bmanually verif/i;

/** Why this criterion is an observation, or nothing. */
export function observationShaped(text: string): string | undefined {
  return RUNNING_PRODUCT.test(text)
    ? "only the running product can show it — a person certifies it on the delivery, with the delivery"
    : undefined;
}

/**
 * The same criteria, with the promise and the ask they belong to, so a
 * driver can be told what it is judging and on whose behalf. A promise's
 * own `unverified` notes are not here: they are what nobody can drive.
 */
export function toDriveOf(space: Space, cut: Cut): { promise: string; criterion: string; criterionId?: string; ask?: string }[] {
  const byId = new Map(space.nodes.map((n) => [n.id, n]));
  const out: { promise: string; criterion: string; criterionId?: string; ask?: string }[] = [];
  for (const id of cut.changeIds) {
    const n: Change | undefined = byId.get(id);
    if (!n) continue;
    const ask = space.asks.find((x) => n.serves.includes(x.id))?.text;
    for (const c of n.acceptance)
      if (observationShaped(c.text))
        out.push({ promise: n.sentence, criterion: c.text, ...(c.id ? { criterionId: c.id } : {}), ...(ask ? { ask } : {}) });
  }
  return out;
}

/**
 * Everything a cut's delivery must hand the person to certify: the
 * promises' own unverified notes, and any signed criterion the rule above
 * classifies as an observation. Both by name, with the reason.
 */
export function observationsOf(space: Space, cut: Cut): string[] {
  const byId = new Map(space.nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  for (const id of cut.changeIds) {
    const n: Change | undefined = byId.get(id);
    if (!n) continue;
    for (const u of n.unverified ?? []) out.push(`${u.text} — ${u.why}`);
    for (const c of n.acceptance) {
      const why = observationShaped(c.text);
      if (why) out.push(`${c.text} — ${why}`);
    }
  }
  return [...new Set(out)];
}
