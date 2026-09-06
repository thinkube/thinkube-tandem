/**
 * Every wait in a run goes through here.
 *
 * One way to wait, taking the run's stop signal, so Stop reaches every
 * wait rather than only the ones that remember to read a flag. It answers
 * the moment the signal fires, and says which of the two ended it.
 */
export interface Waited {
  /** False when the run was stopped while waiting. */
  waited: boolean;
}

export function waitOrStop(ms: number, stop?: AbortSignal): Promise<Waited> {
  if (stop?.aborted) return Promise.resolve({ waited: false });
  return new Promise<Waited>((resolve) => {
    const done = (waited: boolean): void => {
      clearTimeout(timer);
      stop?.removeEventListener("abort", onStop);
      resolve({ waited });
    };
    const onStop = (): void => done(false);
    // Not unref'd: a waiting run is working, and the process must stay
    // alive for its answer. The signal and the bound are what end it.
    const timer = setTimeout(() => done(true), ms);
    stop?.addEventListener("abort", onStop, { once: true });
  });
}
