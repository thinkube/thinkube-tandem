/**
 * The title a run card wears: the promise its unit is keeping, in the
 * space's own words — not the unit id, which names nothing a person asked
 * for.
 *
 * Reached from src/surfaces/push.ts, which the extension's own entry point
 * loads, and from webview/map/src/Run.tsx.
 */
import { Change, Unit } from "../core/schema";

/** The slice a unit belongs to is the left segment of its id, up to the
 *  first "#" — the same convention execution-unit ids use everywhere. */
function sliceOf(unitId: string): string {
  const i = unitId.indexOf("#");
  return i < 0 ? unitId : unitId.slice(0, i);
}

export function promiseLabelOf(a: {
  nodes: Change[];
  units: Unit[];
  slice: string;
}): { label: string; full: string } | undefined {
  const unit = a.units.find((u) => sliceOf(u.id) === a.slice);
  if (!unit) return undefined;
  const byId = new Map(a.nodes.map((n) => [n.id, n]));
  const sentences = unit.changeIds
    .map((id) => byId.get(id)?.sentence)
    .filter((s): s is string => !!s);
  if (!sentences.length) return undefined;
  return labelOf(sentences);
}

/** One promise names itself; several are named by the first and a count.
 *  The shape every card's title wears, so a gate over many promises and a
 *  worker over many changes read the same way. */
function labelOf(sentences: readonly string[]): { label: string; full: string } {
  const rest = sentences.length - 1;
  return {
    label: rest > 0 ? `${sentences[0]} (+${rest} more)` : sentences[0],
    full: sentences.join("\n"),
  };
}

/**
 * The closing gate's title: the promises of the whole cut, because that is
 * what the gate is keeping — every check, on the real state.
 *
 * The gate is not a unit, so it has no promise of its own to read; it takes
 * the promises its run's units carry, in order and without repeats. When no
 * unit carries one there is nothing truer to say than what the gate is, so
 * the card keeps its plain name rather than inventing a promise.
 */
export function gateTitle(
  units: readonly { promiseLabel?: { label: string; full: string } }[],
): { title: string; titleFull?: string } {
  const seen = new Set<string>();
  const fulls: string[] = [];
  for (const u of units) {
    const full = u.promiseLabel?.full;
    if (full && !seen.has(full)) {
      seen.add(full);
      fulls.push(full);
    }
  }
  if (!fulls.length) return { title: "The closing gate" };
  const { label, full } = labelOf(fulls.flatMap((f) => f.split("\n")));
  return { title: label, titleFull: `the closing gate — ${full}` };
}
