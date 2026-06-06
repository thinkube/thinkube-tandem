/**
 * Pure id helpers — no vscode, so the minting + parsing are unit-testable
 * (ThinkubeStore itself imports vscode and can't run under node:test).
 *
 * Spec and TEP ids share one scheme (SP-7 / TEP-0009): a zero-padded base36
 * encoding of epoch-seconds. Independent writers on a shared sidecar don't
 * collide (the id IS the timestamp), and an in-process monotonic guard keeps a
 * single writer from reusing a second across mints. The id parser accepts both
 * this epoch form and the legacy sequential form (`SP-3` / `TEP-0009`).
 */

/** `TEP-<id>` handle → its opaque id, or undefined. Accepts both the legacy
 *  sequential form (`TEP-0009`) and the base36-epoch form (`TEP-tg7y99`). */
export function parseTepId(handle: string): string | undefined {
  const m = /^TEP-([A-Za-z0-9]+)$/.exec(handle.trim());
  return m ? m[1] : undefined;
}

/**
 * Mint the next base36-epoch id, monotonic against `lastEpoch`. Pure: returns
 * the id plus the new epoch the caller must store back as its guard. Same logic
 * for specs and TEPs so they never collide within a process.
 */
export function mintEpochId(
  nowMs: number,
  lastEpoch: number,
): { id: string; epoch: number } {
  let epoch = Math.floor(nowMs / 1000);
  if (epoch <= lastEpoch) epoch = lastEpoch + 1;
  return { id: epoch.toString(36).padStart(6, "0"), epoch };
}
