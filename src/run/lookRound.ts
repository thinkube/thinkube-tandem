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
}): Promise<Finding[]> {
  const asks = asksOfDelivery(a.space, a.delivery);
  if (!asks.length) return [];
  const look = a.look ?? lookAtAsk;
  const found: Finding[] = [];

  a.log?.(`looking at ${a.url}, one worker per ask (${asks.length})`);
  for (let i = 0; i < asks.length; i += AT_ONCE) {
    const batch = await Promise.all(
      asks.slice(i, i + AT_ONCE).map(async (ask) => {
        try {
          return await look({ url: a.url, ask: ask.text, deps: a.deps, ...(a.log ? { log: a.log } : {}) });
        } catch (err) {
          return { findings: [], looked: false, why: (err as Error).message.split("\n")[0] };
        }
      }),
    );
    for (const r of batch) {
      if (!r.looked && r.why) a.log?.(`the look could not run: ${r.why}`);
      found.push(...r.findings);
    }
  }
  a.log?.(found.length ? `the look found ${found.length}` : "the look found nothing to say");
  return found;
}

/** What the look found, as the delivery carries it: the person's own ask,
 *  then what a person would notice. `Delivery.findings` renders first on the
 *  page, under a heading that says these are for weighing and not for
 *  settling — which is exactly what these are. */
export function asFindings(found: readonly Finding[]): string[] {
  return found.map((f) => `${f.where.split(" · ").slice(1).join(" · ") || f.where}: ${f.said}`);
}
