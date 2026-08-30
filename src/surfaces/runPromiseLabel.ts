/**
 * The title a run card wears: the promise its unit is keeping, in the
 * space's own words — not the unit id, which names nothing a person asked
 * for.
 *
 * Reached only from src/surfaces/push.ts and webview/map/src/Run.tsx,
 * neither of which is the reachability gate's own entry point — declared
 * unreachable-by-design in knip.json for that reason.
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
  const rest = sentences.length - 1;
  return {
    label: rest > 0 ? `${sentences[0]} (+${rest} more)` : sentences[0],
    full: sentences.join("\n"),
  };
}
