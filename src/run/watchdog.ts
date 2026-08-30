/**
 * The stall watchdog: a run that cannot move says so, and stops.
 *
 * A stalled run and a working one looked exactly alike — a last log line,
 * and then nothing. Twice in one evening a person watched a dead run for
 * half an hour, and the only way to tell the difference was to read file
 * timestamps in the worktrees from outside. Silence is not a state a
 * machine may leave a person to interpret.
 *
 * So the run watches its own pulse. Every line any actor writes is a beat.
 * When the beats stop for long enough, the watchdog writes what every
 * unfinished unit is waiting for — its state, its activity, what it needs —
 * and says the run is stalled. If nothing moves for as long again, it halts
 * the run, which drains it into a delivery record and a report instead of
 * leaving it to sit until someone gives up.
 *
 * A long run is not a broken run. This watch once also held a wall clock —
 * three hours, and then it stopped whatever was happening — which killed a
 * run that was working: thirty-three of forty-one units finished, eight
 * never started, and everything it had done was thrown away for being
 * slow. Nothing in a run is unbounded to begin with: attempts, challenges,
 * repairs and turns all have their own limits, execs time out, and the
 * plan is a finite graph. A run that keeps finishing units is progressing,
 * however long that takes, and time alone is not evidence of anything.
 *
 * So the only thing that ends a run against its will is going quiet. A
 * caller that must have a deadline can still set one; nothing sets one by
 * default.
 */
import type { RunState } from "./state";

/** How long, in words a person reads without converting units. */
const howLong = (ms: number): string =>
  ms < 90_000
    ? `${Math.round(ms / 1000)} seconds`
    : ms < 90 * 60_000
      ? `${Math.round(ms / 60_000)} minutes`
      : `${(ms / 3_600_000).toFixed(1)} hours`;

/** How long a run may be silent before the watchdog says so. */
const QUIET_BEFORE_NOTICE_MS = 8 * 60 * 1000;

/** No run has a deadline of its own: only a caller that asks for one gets
 *  one, and nothing in this codebase asks. */
const NO_DEADLINE = Number.POSITIVE_INFINITY;

export interface StallWatch {
  /** A beat: something moved. */
  beat: () => void;
  stop: () => void;
}

/**
 * Watch a run's pulse. `now` and `every` are injectable so a test drives it
 * without waiting; the run passes the clock and a one-minute tick.
 */
export function watchForStall(a: {
  st: RunState;
  units: () => { id: string; state: string; activity?: { text: string }; requires: string[] }[];
  log: (line: string, step?: string) => void;
  defect: (e: { activity: string; trigger: string; type?: string; impact: string; detail: string }) => void;
  quietMs?: number;
  /** A deadline, when a caller insists on one. Unset means no deadline:
   *  a run that is finishing units is working, whatever the clock says. */
  maxMs?: number;
  now?: () => number;
  every?: (fn: () => void, ms: number) => { stop: () => void };
}): StallWatch {
  const quiet = a.quietMs ?? QUIET_BEFORE_NOTICE_MS;
  const bound = a.maxMs ?? NO_DEADLINE;
  const now = a.now ?? (() => Date.now());
  const every =
    a.every ??
    ((fn: () => void, ms: number) => {
      const t = setInterval(fn, ms);
      if (typeof t.unref === "function") t.unref();
      return { stop: () => clearInterval(t) };
    });
  const started = now();
  let last = now();
  let noticed = false;
  // The pulse is the run's own log: every line any actor writes is a beat.
  // The watchdog listens where the lines already go, so no caller has to
  // remember to tell it anything.
  const beat = (): void => {
    last = now();
    noticed = false;
  };
  const before = a.st.sink;
  a.st.sink = (line, step) => {
    before?.(line, step);
    beat();
  };
  const stillGoing = () => a.units().filter((u) => u.state !== "done" && u.state !== "failed" && u.state !== "blocked");
  const accountOf = (): string =>
    stillGoing()
      .map((u) => `- ${u.id}: ${u.state}${u.activity ? ` — ${u.activity.text}` : ""}${u.requires.length ? ` (waits on ${u.requires.join(", ")})` : ""}`)
      .join("\n");
  const tick = (): void => {
    if (a.st.halted) return;
    const spent = now() - started;
    if (spent >= bound) {
      const account = accountOf();
      a.log(
        `⛔ the run has been going for ${howLong(spent)}, which is its bound, and is stopping itself. ` +
          `What never finished:\n${account}`,
      );
      a.defect({ activity: "run", trigger: "watchdog", type: "gate", impact: "run halted — over its bound", detail: account.slice(0, 1500) });
      a.st.halt();
      return;
    }
    const silent = now() - last;
    if (silent < quiet) return;
    const account = accountOf();
    if (!noticed) {
      noticed = true;
      a.log(
        `⏱ nothing has moved for ${howLong(silent)}. What is still open:\n${account}\n` +
          `If nothing moves for ${howLong(quiet)} more, the run stops itself and reports rather than sitting here.`,
      );
      a.defect({ activity: "run", trigger: "watchdog", type: "gate", impact: "run silent", detail: account.slice(0, 1500) });
      return;
    }
    a.log(`⛔ the run has been silent for ${howLong(silent)} and is stopping itself. What never finished:\n${account}`);
    a.defect({ activity: "run", trigger: "watchdog", type: "gate", impact: "run halted — stalled", detail: account.slice(0, 1500) });
    a.st.halt();
  };
  const timer = every(tick, Math.max(15_000, Math.min(60_000, Math.floor(quiet / 4))));
  return {
    beat,
    stop: () => {
      timer.stop();
      a.st.sink = before;
    },
  };
}
