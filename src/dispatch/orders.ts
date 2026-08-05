/**
 * Work-order assembly: the accumulation point of the whole analysis. Orders
 * are computed from the signed cut — grouped by unit so each order is one
 * coherent piece, footprints disjoint so workers never collide, anchors
 * resolved against the actual worktree at dispatch. Nothing here is
 * authored; an unresolvable anchor stops the order, not the worker.
 */
import { ChangeNode, Cut, Space, WorkOrder } from "../core/schema";
import { SourceStamp } from "../core/stamp";
import { formUnits } from "../core/cluster";
import { ResolvedAnchor, resolveAnchor } from "./resolve";

export type AssembledOrder =
  | { ok: true; order: WorkOrder; resolved: ResolvedAnchor[] }
  | { ok: false; nodeIds: string[]; refusals: string[] };

export function assembleWorkOrders(
  space: Space,
  cut: Cut,
  worktree: string,
  stamp: SourceStamp[],
  readFile?: (abs: string) => string | undefined,
): AssembledOrder[] {
  const byId = new Map(space.nodes.map((n) => [n.id, n]));
  const members = cut.nodeIds
    .map((id) => byId.get(id))
    .filter((n): n is ChangeNode => !!n);
  const units = formUnits(members);
  return units.map((unit, i) => {
    const nodes = unit.nodeIds.map((id) => byId.get(id)!);
    const anchors = nodes.flatMap((n) => n.grounding?.touchpoints ?? []);
    const resolved = anchors.map((a) => resolveAnchor(worktree, a, readFile));
    const refusals = resolved
      .filter((r): r is Extract<ResolvedAnchor, { ok: false }> => !r.ok)
      .map((r) => r.reason);
    if (refusals.length) return { ok: false, nodeIds: unit.nodeIds, refusals };
    return {
      ok: true,
      order: {
        id: `order-${cut.id}-${i + 1}`,
        cutId: cut.id,
        nodeIds: unit.nodeIds,
        footprint: [...new Set(anchors.map((a) => a.path))],
        anchors,
        contracts: nodes.map(
          (n) =>
            `${n.sentence}${
              n.grounding
                ? ` — lands at ${n.grounding.touchpoints
                    .map((t) => t.path + (t.symbol ? ` › ${t.symbol}` : ""))
                    .join(", ")}`
                : ""
            }`,
        ),
        probes: nodes.flatMap((n) =>
          n.checks.map((c) => c.probePath).filter((p): p is string => !!p),
        ),
        stamp,
      },
      resolved,
    };
  });
}

/**
 * The worker-facing brief: pre-verified coordinates with line numbers
 * rendered from THIS worktree, the footprint boundary, what proves done,
 * and the honesty protocol. The worker's first tool call is an edit, not a
 * search — searching for a listed path is a bug.
 */
export function renderWorkOrderBrief(
  space: Space,
  order: WorkOrder,
  resolved: ResolvedAnchor[],
): string {
  const byId = new Map(space.nodes.map((n) => [n.id, n]));
  const lines: string[] = [];
  lines.push(`WORK ORDER ${order.id}`);
  lines.push(`Deliver exactly these changes:`);
  for (const id of order.nodeIds) {
    const n = byId.get(id);
    if (!n) continue;
    lines.push(`  • ${n.sentence}`);
    for (const c of n.checks) lines.push(`      done when: ${c.text}`);
  }
  lines.push(``);
  lines.push(
    `COORDINATES (host-verified against your worktree — do NOT search for these; open them):`,
  );
  for (const r of resolved) {
    if (!r.ok) continue;
    if (r.planned)
      lines.push(`  + ${r.anchor.path} — new file, you create it`);
    else
      lines.push(
        `  ${r.anchor.path}:${r.line}${r.anchor.symbol ? ` (${r.anchor.symbol})` : ""}`,
      );
  }
  lines.push(``);
  lines.push(
    `FOOTPRINT — you may touch ONLY: ${order.footprint.join(", ")}`,
  );
  if (order.probes.length)
    lines.push(`PROOF — these must pass: ${order.probes.join(", ")}`);
  lines.push(``);
  lines.push(
    `If an obligation cannot be met, your final message starts with ` +
      `"UNDELIVERED: " naming it and the question that would unblock it. ` +
      `Never fake, never widen the footprint, never guess at a target that ` +
      `is not where this brief says it is — report it instead.`,
  );
  return lines.join("\n");
}
