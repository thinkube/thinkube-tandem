/**
 * The look, run once per ask, after the thing is deployed.
 *
 * A delivery is a set of asks, and the question a person actually has is
 * "did you do what I asked", one sentence at a time. So the deployed thing
 * is driven once per ask, by a worker carrying that ask's own words, and
 * what comes back is filed against the ask it came from. Nobody has to read
 * a report and work out which of two hundred checks the complaint belongs
 * to — the complaint arrives already knowing.
 *
 * Findings, never verdicts. Nothing here can withhold a delivery, fail a
 * promise or reopen a cut: it runs AFTER the merge, on work already
 * accepted, and its whole value is that saying something costs nothing. A
 * report that could cost a delivery is a report someone will argue with.
 *
 * Silence is the normal answer. Most asks, most of the time, produce
 * nothing, and a run that produces nothing has still done its job.
 */
import type { Change, Delivery, Space } from "../core/schema";
import type { RoundDeps } from "../derive/round";
import { lookAtAsk } from "./lookWorker";
import type { Finding } from "./theLook";

/** How many asks are driven at once. Each holds a browser and a round, so
 *  this is bounded by memory rather than by the model's throughput. */
const AT_ONCE = 3;

/** The asks a delivery answered, in their own words.
 *
 *  A cut names changes; a change names the asks it serves. The path already
 *  exists in the space, so what a delivery is about needs nothing recorded
 *  for the look's benefit. */
export function asksOfDelivery(space: Space, delivery: Pick<Delivery, "cutId">): { id: string; text: string }[] {
  const cut = space.cuts.find((c) => c.id === delivery.cutId);
  if (!cut) return [];
  const inCut = new Set(cut.changeIds);
  const served = new Set(
    space.nodes.filter((n: Change) => inCut.has(n.id)).flatMap((n) => n.serves),
  );
  return space.asks.filter((a) => served.has(a.id)).map((a) => ({ id: a.id, text: a.text }));
}

/**
 * What the machine could not verify about this ask — the look's actual work.
 *
 * These effects need the running product, so grounding declines to write a
 * check for them and the gate never grades them. Until now that was the end
 * of it: they landed on the delivery as observations, and one delivery
 * carried twenty-one that nobody was ever going to certify. A list nobody
 * works through is not a record of anything; it is a way of not deciding.
 *
 * The deployed thing exists now, and a worker can drive it. So the effect
 * stops being an item on a report and becomes a line in that worker's
 * brief. Its normal outcome is silence.
 */
export function toExercise(space: Space, delivery: Pick<Delivery, "cutId">, askId: string): string[] {
  const cut = space.cuts.find((c) => c.id === delivery.cutId);
  if (!cut) return [];
  const inCut = new Set(cut.changeIds);
  return [
    ...new Set(
      space.nodes
        .filter((n: Change) => inCut.has(n.id) && n.serves.includes(askId))
        .flatMap((n) => (n.unverified ?? []).map((u) => u.text)),
    ),
  ];
}

/** The observations a look has now exercised, so they stop standing on the
 *  delivery as though someone still owed an answer. What was wrong came
 *  back as a finding; what was right needs no entry. */
export function exercised(delivery: Delivery, driven: readonly string[]): Delivery {
  if (!driven.length || !delivery.observations?.length) return delivery;
  const done = new Set(driven);
  const left = delivery.observations.filter((o) => ![...done].some((d) => o.includes(d)));
  return left.length === delivery.observations.length ? delivery : { ...delivery, observations: left };
}

/**
 * Drive the deployed thing once per ask and return what was found.
 *
 * Fail-soft: an ask whose look could not run contributes nothing. The
 * reason goes to the log, where a developer can act on it, and not to the
 * findings, where it would read to the person as a complaint about their
 * product.
 */
export async function lookAfterDeploy(a: {
  url: string;
  space: Space;
  delivery: Pick<Delivery, "cutId">;
  deps: RoundDeps;
  look?: typeof lookAtAsk;
  log?: (line: string) => void;
}): Promise<{ findings: Finding[]; driven: string[] }> {
  const asks = asksOfDelivery(a.space, a.delivery);
  if (!asks.length) return { findings: [], driven: [] };
  const look = a.look ?? lookAtAsk;
  const found: Finding[] = [];
  const driven: string[] = [];

  a.log?.(`looking at ${a.url}, one worker per ask (${asks.length})`);
  for (let i = 0; i < asks.length; i += AT_ONCE) {
    const batch = await Promise.all(
      asks.slice(i, i + AT_ONCE).map(async (ask) => {
        const exercise = toExercise(a.space, a.delivery, ask.id);
        try {
          const r = await look({
            url: a.url,
            ask: ask.text,
            deps: a.deps,
            ...(exercise.length ? { exercise } : {}),
            ...(a.log ? { log: a.log } : {}),
          });
          return { ...r, exercise };
        } catch (err) {
          return { findings: [], looked: false, why: (err as Error).message.split("\n")[0], exercise };
        }
      }),
    );
    for (const r of batch) {
      if (!r.looked) {
        if (r.why) a.log?.(`the look could not run: ${r.why}`);
        continue;
      }
      found.push(...r.findings);
      driven.push(...r.exercise);
    }
  }
  a.log?.(found.length ? `the look found ${found.length}` : "the look found nothing to say");
  return { findings: found, driven };
}

/** What the look found, as the delivery carries it: the person's own ask,
 *  then what a person would notice. `Delivery.findings` renders first on the
 *  page, under a heading that says these are for weighing and not for
 *  settling — which is exactly what these are. */
export function asFindings(found: readonly Finding[]): string[] {
  return found.map((f) => `${f.where.split(" · ").slice(1).join(" · ") || f.where}: ${f.said}`);
}
