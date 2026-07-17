/**
 * Per-space chat transcript store (2026-07-17) — the bigger fix behind the
 * missing greeting: for provider-backed session types the CONTENT PROVIDER is
 * the source of truth for the transcript; the panel does not persist those
 * locally. Ours returned history:[] unconditionally, so every reopen was
 * empty by construction.
 *
 * Turns are appended as JSONL at
 *   <sidecarRoot>/<namespace>/thinking/.chat/<space>.jsonl
 * (sidecar of the space it belongs to — deleted with the space, recoverable
 * with the store's git history like everything else).
 *
 * Pure JSONL logic is exported for tests; only fs touches the disk.
 */

import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

export interface TranscriptTurn {
  role: "user" | "assistant";
  text: string;
  ts: string;
}

export function transcriptPath(
  sidecarRoot: string,
  namespace: string,
  space: string,
): string {
  return nodePath.join(sidecarRoot, namespace, "thinking", ".chat", `${space}.jsonl`);
}

/** Parse JSONL tolerantly: bad lines are skipped, order preserved. */
export function parseTranscript(raw: string, limit = 200): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t) as Partial<TranscriptTurn>;
      if (
        (obj.role === "user" || obj.role === "assistant") &&
        typeof obj.text === "string" &&
        obj.text.trim()
      ) {
        turns.push({
          role: obj.role,
          text: obj.text,
          ts: typeof obj.ts === "string" ? obj.ts : "",
        });
      }
    } catch {
      /* torn line (crash mid-append) — skip */
    }
  }
  return turns.slice(-limit);
}

export function readTranscript(path: string, limit = 200): TranscriptTurn[] {
  try {
    return parseTranscript(nodeFs.readFileSync(path, "utf8"), limit);
  } catch {
    return [];
  }
}

export function appendTranscriptTurn(
  path: string,
  role: "user" | "assistant",
  text: string,
): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  try {
    nodeFs.mkdirSync(nodePath.dirname(path), { recursive: true });
    nodeFs.appendFileSync(
      path,
      JSON.stringify({ role, text: trimmed, ts: new Date().toISOString() }) +
        "\n",
    );
  } catch {
    /* read-only store — the session still works, just without recovery */
  }
}
