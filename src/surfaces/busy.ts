/**
 * One rule for the single line that says whether the machine is busy: which
 * thinking space, what it is doing, whether a worker needs an answer, and
 * whether the space has gone quiet. Plain functions only — no editor object
 * crosses this file; the host (extension.ts) is the only caller that knows
 * about vscode.
 */

/** A space goes quiet after this long without a recorded change. */
export const QUIET_MS = 5 * 60 * 1000;

/** Mirrors exactly the shape `heartbeat`/`pushActive` already read off a
 *  TandemSession: a run's view (units + parked) when one is live, or the
 *  grounding view when the space is thinking about asks instead. */
export interface BusySource {
  running: boolean;
  runState?: {
    view(): {
      units: { id: string; state: string }[];
      parked: { unitId: string; question: string }[];
    };
  };
  groundingView?(): { askId: string; label: string; current: number; total: number }[];
}

export interface BusySpace {
  key: string;
  label: string;
  /** true while a run is in flight or grounding is under way. */
  running: boolean;
  /** true when at least one unit is parked, waiting on a person. */
  needsAnswer: boolean;
  doneUnits: number;
  totalUnits: number;
  lastChangeMs?: number;
}

/**
 * Reads one space's business off its session-shaped source. Returns
 * undefined when the space is idle — no run, no grounding under way.
 */
export function spaceBusy(
  key: string,
  label: string,
  s: BusySource,
  lastChangeMs?: number,
): BusySpace | undefined {
  if (s.running && s.runState) {
    const v = s.runState.view();
    return {
      key,
      label,
      running: true,
      needsAnswer: v.parked.length > 0,
      doneUnits: v.units.filter((u) => u.state === "done").length,
      totalUnits: v.units.length,
      ...(lastChangeMs !== undefined ? { lastChangeMs } : {}),
    };
  }
  const grounding = s.groundingView?.() ?? [];
  if (grounding.length) {
    const running = grounding.filter((g) => g.label !== "waiting").length;
    return {
      key,
      label,
      running: true,
      needsAnswer: false,
      doneUnits: running,
      totalUnits: grounding.length,
      ...(lastChangeMs !== undefined ? { lastChangeMs } : {}),
    };
  }
  return undefined;
}

function quietSuffix(lastChangeMs: number | undefined, nowMs: number): string {
  if (lastChangeMs === undefined) return "";
  const elapsed = nowMs - lastChangeMs;
  if (elapsed < QUIET_MS) return "";
  const minutes = Math.floor(elapsed / 60000);
  return ` — quiet for ${minutes} min`;
}

/**
 * Builds the single status-bar line from every busy space. Returns
 * undefined when nothing is busy, so the caller falls back to naming the
 * chosen repository instead.
 */
export function busyLine(
  spaces: BusySpace[],
  nowMs: number,
): { text: string; detail: string; alert: boolean } | undefined {
  const busy = spaces.filter((s) => s.running);
  if (busy.length === 0) return undefined;

  const alert = busy.some((s) => s.needsAnswer);

  if (busy.length === 1) {
    const s = busy[0];
    const answerPhrase = s.needsAnswer ? " — needs an answer" : "";
    const text = `${s.label}: ${s.doneUnits}/${s.totalUnits} units${answerPhrase}${quietSuffix(
      s.lastChangeMs,
      nowMs,
    )}`;
    return { text, detail: text, alert };
  }

  const names = busy.map((s) => s.label).join(", ");
  const answerPhrase = alert ? " — a worker needs an answer" : "";
  const text = `${busy.length} spaces are busy${answerPhrase}`;
  const detail = busy
    .map((s) => {
      const answer = s.needsAnswer ? " (needs an answer)" : "";
      return `${s.label}: ${s.doneUnits}/${s.totalUnits} units${answer}${quietSuffix(s.lastChangeMs, nowMs)}`;
    })
    .join("; ");
  return { text, detail: `${names} — ${detail}`, alert };
}
