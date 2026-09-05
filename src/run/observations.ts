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
export function toDriveOf(
  space: Space,
  cut: Cut,
  /** The directories that build what answers at the address, as the
   *  repository declares them. A promise landing in one of them is a
   *  promise about the page. */
  pageRoots: readonly string[] = [],
): { promise: string; criteria: { id?: string; text: string }[]; ask?: string }[] {
  const byId = new Map(space.nodes.map((n) => [n.id, n]));
  const out: { promise: string; criteria: { id?: string; text: string }[]; ask?: string }[] = [];
  const onThePage = (n: Change): boolean =>
    (n.grounding?.touchpoints ?? []).some((t) => pageRoots.some((r) => t.path === r || t.path.startsWith(`${r}/`)));
  for (const id of cut.changeIds) {
    const n: Change | undefined = byId.get(id);
    if (!n) continue;
    const ask = space.asks.find((x) => n.serves.includes(x.id))?.text;
    const page = onThePage(n);
    // Something to do and see on the page, or a criterion worded for a
    // person watching. Never one that is answered elsewhere, and never an
    // assessment: those are read, not driven.
    const criteria = n.acceptance
      .filter((c) => observationShaped(c.text) || (page && c.kind !== "assessment" && !c.settledBy))
      .map((c) => ({ ...(c.id ? { id: c.id } : {}), text: c.text }));
    // ONE reviewer per promise, not per criterion. A promise is what the
    // person cares about; its criteria are the script the reviewer follows
    // in a single browser session. One session per criterion opened the
    // same product five times to check five things about it, and filled
    // the graph with cards that all said the same promise.
    if (criteria.length) out.push({ promise: n.sentence, criteria, ...(ask ? { ask } : {}) });
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
