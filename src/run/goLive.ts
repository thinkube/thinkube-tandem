/**
 * Putting the work in front of the person.
 *
 * This is a development platform with one person on it, so there is no
 * reason to hold finished work on a branch until someone approves it.
 * The run merges, pushes, and waits until the platform has the new
 * version answering at the address the repository declares. What comes
 * back to the person is not "may I merge" but "here it is, running".
 *
 * Everything a criterion talks about exists from that moment, which is
 * what lets the pages be judged by driving them rather than by mounting
 * them in a browser that is not a browser.
 */
import type { PipelineReading } from "./harvest";

export type Step = { say: (line: string) => void; doing: (line: string) => void };

/** How the platform's own account of a run reads to a person. */
function pipelineLine(r: PipelineReading): string {
  const steps = r.stages ?? [];
  const done = steps.filter((s) => /succeed/i.test(s.status)).length;
  const now = steps.find((s) => /run|pending|progress/i.test(s.status));
  if (!steps.length) return "the platform is building it";
  return `${now ? now.name : "building"} — ${done} of ${steps.length} steps`;
}

/**
 * Wait for the platform to build the pushed commit and for the address to
 * answer. Every wait says what it is waiting on, because a person watching
 * ten minutes of nothing cannot tell a build from a hang.
 */
export async function waitUntilLive(a: {
  /** Where the repository says it is seen. */
  at: string;
  /** The app's name, as the platform knows it. */
  app: string;
  since: string;
  read: (since: string) => Promise<PipelineReading>;
  /** Does the address answer? Its status, or nothing when it does not. */
  knock: (url: string) => Promise<number | undefined>;
  step: Step;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait in all, in ticks of ten seconds. */
  patience?: number;
}): Promise<{ live: boolean; why?: string }> {
  const sleep = a.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref()));
  const patience = a.patience ?? 90;
  let built = false;
  let saidNoticed = false;
  for (let tick = 0; tick < patience; tick++) {
    if (!built) {
      const reading = await a.read(a.since);
      if (reading.unreachable && !saidNoticed) {
        a.step.doing("waiting for the platform to notice the push");
      } else if (!reading.unreachable) {
        if (!saidNoticed) {
          saidNoticed = true;
          a.step.say(`the platform is building ${a.app}`);
        }
        a.step.doing(pipelineLine(reading));
        if (reading.settled) {
          const held = (reading.phase ?? "").toLowerCase() === "succeeded";
          if (!held) {
            const broke = (reading.stages ?? []).filter((s) => /fail|error/i.test(s.status));
            const why = broke.length
              ? `${broke.map((s) => s.name + (s.said ? ` (${s.said})` : "")).join(", ")} did not pass`
              : `the platform's build ended ${reading.phase || "without succeeding"}`;
            a.step.say(`it did not go live: ${why}`);
            return { live: false, why };
          }
          built = true;
          a.step.say("the platform built it — waiting for the new version to answer");
        }
      }
    } else {
      a.step.doing(`waiting for ${a.at} to answer`);
      const code = await a.knock(a.at);
      if (code !== undefined && code < 500) {
        a.step.say(`it is live at ${a.at}`);
        return { live: true };
      }
    }
    await sleep(10_000);
  }
  const why = built
    ? `${a.at} never answered`
    : "the platform never finished building it";
  a.step.say(`it did not go live: ${why}`);
  return { live: false, why };
}
