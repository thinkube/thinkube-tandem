/**
 * Every wait in a run goes through here.
 *
 * Stop was a flag, and a flag only stops what remembers to read it. A run
 * waiting on the platform slept its full patience whatever the person
 * pressed; a run inside a twenty-minute suite ran the suite to the end.
 * Both were the same defect written twice, and each was fixed alone.
 *
 * So there is one way to wait, it takes the run's stop signal, and it
 * answers the moment that signal fires. A wait written any other way is a
 * wait that will ignore the button again.
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
    // Not unref'd: a run that is waiting is a run that is working, and a
    // process that exits out from under it loses the answer it was waiting
    // for. The signal and the bound are what end it.
    const timer = setTimeout(() => done(true), ms);
    stop?.addEventListener("abort", onStop, { once: true });
  });
}
