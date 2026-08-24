/**
 * The documentation duty: one pure rule for whether a cut's members ground
 * any documentation, so the sign gate and the cut review page read the same
 * verdict instead of each re-deriving it.
 */
import type { Change } from "./schema";

/** The engine-wiring ledger is a documentation page rooted outside docs/ —
 *  named once here so every reader of the duty counts it the same way. */
const ROOT_DOC_PATH = "ENGINE-WIRING.md";

/** True when `path` is a documentation path: under docs/, or the one
 *  root-level ledger this repository keeps beside docs/. No other
 *  root-level file counts, however ledger-shaped its name reads. */
export function isDocsPath(path: string): boolean {
  return path.startsWith("docs/") || path === ROOT_DOC_PATH;
}

export type DocsDutyStatus = "documented" | "waived" | "unmet";

export type DocsDuty =
  | { status: "documented"; paths: string[] }
  | { status: "waived"; reason: string }
  | { status: "unmet" };

/** Reports whether a cut's members ground documentation, carry a waiver, or
 *  neither. Documentation wins when both are present: a waiver is only a
 *  reason for writing none, not a veto on docs/ paths actually grounded. */
export function docsDutyOf(members: readonly Change[], waiver?: { reason: string; at: string }): DocsDuty {
  const paths = new Set<string>();
  for (const member of members) {
    for (const touchpoint of member.grounding?.touchpoints ?? []) {
      if (isDocsPath(touchpoint.path)) paths.add(touchpoint.path);
    }
  }
  if (paths.size > 0) return { status: "documented", paths: [...paths] };
  if (waiver) return { status: "waived", reason: waiver.reason };
  return { status: "unmet" };
}

/** Builds a docs waiver from a reason, or undefined when the reason is
 *  empty or only whitespace — an empty reason is not a reason. */
export function docsWaiverFrom(reason: string, at: string): { reason: string; at: string } | undefined {
  const trimmed = reason.trim();
  if (!trimmed) return undefined;
  return { reason: trimmed, at };
}
