/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The run's live phase, after the hand-over: the work made live, repaired
 * when what makes it live refuses it, and judged on the running product
 * once it is.
 *
 * What makes it live differs by downstream, and is given: an app waits for
 * the platform's pipeline to notice the push; a template runs its own
 * declared deploy (src/run/templateLive.ts), because a push builds nothing
 * for it. Everything after is the same. A refusal that judged the work is
 * a red like any other: repaired from the refusal's own words, built here,
 * landed, and made live again, twice at most (src/run/tryAgain.ts). A
 * refusal that judged nothing — the machinery could not run — is not
 * repaired, because a repair after no fault changes nothing.
 */
import type { Delivery } from "../core/schema";
import { repairUntilLive, type TryAgainSteps } from "./tryAgain";

/** What making it live answered. `unjudged` says it could not be tried. */
export interface Went {
  live: boolean;
  why?: string;
  unjudged?: boolean;
}

export async function goLiveAndJudge(a: {
  /** Where the work is seen once it is live. */
  at: string;
  delivery: Delivery;
  /** What the phase says while the work is being made live. */
  waiting: string;
  /** Make the work live, or wait until it is. */
  goLive: () => Promise<Went>;
  /** Why it did not go live, in the refusal's words, with the files they name. */
  whyItFailed: TryAgainSteps["whyItFailed"];
  /** Who refused it, on the delivery's record of what happened after the merge. */
  said: string;
  /** The delivery once live, with what the settling source answered stamped on it. */
  settle: (d: Delivery) => Promise<Delivery>;
  repair: TryAgainSteps["repair"];
  buildsHere: TryAgainSteps["buildsHere"];
  /** Put the repaired work in the project again; `head` is the merge it made. */
  land: () => Promise<{ ok: boolean; why?: string; moved?: boolean; head?: string }>;
  halted: () => boolean;
  say: (line: string) => void;
  phase: (state: "running" | "done" | "failed", note: string) => void;
  /** Every reviewer of the running product is blocked, with the reason. */
  noProduct: (why: string) => void;
  /** The delivery as it now stands, for the run's outcome. */
  record: (d: Delivery) => void;
  /** Judge the live product, repairing what does not hold there. */
  judge: (alsoMerged: string[]) => Promise<void>;
}): Promise<void> {
  const d = a.delivery;
  a.phase("running", a.waiting);
  let went = await a.goLive();
  let tried = 0;
  const alsoMerged: string[] = [];
  if (!went.live && !went.unjudged && !a.halted()) {
    const again = await repairUntilLive({
      whyItFailed: a.whyItFailed,
      repair: a.repair,
      buildsHere: a.buildsHere,
      land: async () => {
        const l = await a.land();
        // Every merge this delivery made is remembered: taking the work
        // back out means reverting all of them.
        if (l.head && l.moved) alsoMerged.push(l.head);
        return l;
      },
      waitUntilLive: a.goLive,
      say: a.say,
      doing: (l) => a.phase("running", l),
      halted: a.halted,
    });
    tried = again.attempts;
    went = again.live ? { live: true } : { live: false, ...(again.why ? { why: again.why } : {}) };
  }
  a.phase(went.live ? "done" : "failed", went.live ? `live at ${a.at}` : (went.why ?? "it did not go live"));
  if (!went.live) a.noProduct(went.why ?? "the work never went live");
  const heads = alsoMerged.length && d.mergedHead ? { mergedHeads: [d.mergedHead, ...alsoMerged] } : {};
  a.record(
    went.live
      ? { ...(await a.settle(d)), ...heads, liveAt: a.at }
      : {
          ...d,
          ...heads,
          afterMerge: {
            at: new Date().toISOString(),
            outcome: went.unjudged ? "unjudged" : "broke",
            said: a.said,
            ...(went.why ? { detail: went.why } : {}),
            ...(tried ? { tried } : {}),
          },
        },
  );
  if (went.live) await a.judge(alsoMerged);
}
