/**
 * The documentation duty: one rule that reads a cut's members and says
 * whether the cut is documented, waived with a reason, or unmet. The same
 * path predicate is shared by the cut-level duty and the per-slice
 * obligation check, so a path one accepts the other cannot reject.
 */
import type { Change } from "./schema";

/** Root-level ledgers that count as documentation though they sit beside
 *  `docs/`, not under it — named individually rather than by a directory
 *  rule, since the repository root is not otherwise a documentation home. */
const ROOT_LEDGERS = new Set(["ENGINE-WIRING.md"]);

/** Whether a path counts as documentation. The one definition — every
 *  reader that needs to know calls this instead of testing a prefix itself. */
export function isDocsPath(path: string): boolean {
  const p = path.replace(/\\/g, "/").replace(/^\.\//, "");
  return /^docs\//.test(p) || ROOT_LEDGERS.has(p);
}

export type DocsDuty =
  | { status: "documented"; paths: string[] }
  | { status: "waived"; reason: string }
  | { status: "unmet" };

/** A waiver: empty or whitespace-only reasons never make one. */
export function docsWaiverFrom(
  reason: string,
  at: string,
): { reason: string; at: string } | undefined {
  const trimmed = reason.trim();
  if (!trimmed) return undefined;
  return { reason: trimmed, at };
}

/**
 * The cut's documentation duty: documented when any member grounds a docs/
 * path (every such path listed), else waived when a waiver with a reason
 * was passed, else unmet.
 */
export function docsDutyOf(
  members: readonly Change[],
  waiver?: { reason: string; at: string },
): DocsDuty {
  const paths = [
    ...new Set(
      members
        .flatMap((m) => m.grounding?.touchpoints ?? [])
        .map((t) => t.path)
        .filter((p) => isDocsPath(p)),
    ),
  ];
  if (paths.length) return { status: "documented", paths };
  if (waiver?.reason.trim()) return { status: "waived", reason: waiver.reason };
  return { status: "unmet" };
}
