/**
 * The audit card's own verdict: a slice is green only when every worker
 * that serves it — its coders, its tester, and the maintainer of its
 * `<slice>-tests` — has finished.
 *
 * Reached only from webview/map/src/Run.tsx, not from either CLI or the
 * extension's own entry — declared unreachable-by-design in knip.json's
 * root workspace for that reason; the webview workspace reaches it fine.
 */

export interface RunUnitLike {
  id: string;
  slice: string;
  role: "code" | "test" | "maintain";
  state: string;
}

/** The workers of `slice` — coders, tester, and its `-tests` maintainer —
 *  that have not yet finished. Empty means the slice is done, in full. */
export function unpassedWorkers(units: readonly RunUnitLike[], slice: string): RunUnitLike[] {
  const testsSlice = `${slice}-tests`;
  return units.filter((u) => (u.slice === slice || u.slice === testsSlice) && u.state !== "done");
}

/** The audit card's count: how many of a slice's graded criteria passed,
 *  and which did not — named, not folded into one "waiting" chip.
 *  `graded: false` when the slice has not been graded at all (`undefined`
 *  or an empty list), so an ungraded slice is never read as one that
 *  passed everything. */
export function sliceCheckTally(
  checks: readonly { ac: number; pass: boolean; text?: string }[] | undefined,
): { graded: boolean; passed: number; total: number; failed: { ac: number; pass: boolean; text?: string }[] } {
  if (!checks?.length) return { graded: false, passed: 0, total: 0, failed: [] };
  return {
    graded: true,
    passed: checks.filter((c) => c.pass).length,
    total: checks.length,
    failed: checks.filter((c) => !c.pass),
  };
}
