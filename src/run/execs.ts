/**
 * The run's command runners: bounded, and reached by Stop — a halted run
 * starts no probe, build or suite.
 */
import { DEFAULT_AC_TIMEOUT_MS, runBounded } from "../engine/core/closingGate";

/** The whole suite runs where a probe ran: minutes, bounded. */
const SUITE_TIMEOUT_MS = 20 * 60 * 1000;

export type HaltableExec = (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;

export function haltableExecs(
  halted: () => boolean,
  env: NodeJS.ProcessEnv,
  /** The run's stop signal. A command already running is killed by it —
   *  refusing to START one is all a flag could ever do, and a suite takes
   *  twenty minutes. */
  stop?: AbortSignal,
): { boundedExec: HaltableExec; suiteExec: HaltableExec } {
  const stopped = () => Promise.resolve({ code: 124, output: "[stopped — the run was halted]" });
  return {
    boundedExec: (cmd, cwd) =>
      halted() ? stopped() : runBounded(cmd, cwd, { timeoutMs: DEFAULT_AC_TIMEOUT_MS, env, ...(stop ? { stop } : {}) }),
    suiteExec: (cmd, cwd) =>
      halted() ? stopped() : runBounded(cmd, cwd, { timeoutMs: SUITE_TIMEOUT_MS, env, ...(stop ? { stop } : {}) }),
  };
}

/** The compiler's words, verbatim and bounded, with the verdict first. */
export function formatBuild(r: { code: number | null; output: string }): string {
  const out = r.output.trim();
  if (r.code === 0) return "BUILD GREEN" + (out ? `\n${out.slice(0, 2000)}` : "");
  return `BUILD RED (exit ${r.code ?? "null"})\n${out.slice(0, 8000) || "(the build produced no output — it may have timed out)"}`;
}
