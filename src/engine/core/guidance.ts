// ── Judge guidance on the slice card (2026-07-12): the auditable rework channel ─────
//
// When the closing gate goes red and the judge routes the fault to one role, the judge's
// diagnosis (rationale + failing evidence) is APPENDED to the slice card as a round-stamped
// `## ⚖ Judge guidance` section addressed to that role — never overwritten, so the card
// carries the full history of what each rework round was told (the audit trail a human
// reads on the board). The re-dispatched worker's prompt renders the sections addressed to
// its role with an explicit PRIORITIZE instruction. This replaces the old
// `buildTestReworkContext` seam, which handed the diagnosis to the test-author only and
// left the code-author blind (the 2026-07-11 repair's principle applies to every fixer:
// grading independence lives in the judge, never in hiding the failure from the fixer).

/**
 * Summarize a stream-json event into a one-line session-log string, or null to skip.
 * Event shapes verified against claude v2.1.178: system/init, assistant (text + tool_use),
 * result.
 */
export const clip = (x: string, n: number): string =>
  x.length > n ? x.slice(0, n - 1) + "…" : x;
