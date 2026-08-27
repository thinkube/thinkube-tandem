/**
 * The approved prototype's ELK invocation, ported: layered layout over
 * MEASURED node sizes with ORTHOGONAL edge routing — positions AND edge
 * sections (bend points) come from elkjs; nothing hand-routes.
 */
import ELK from "elkjs/lib/elk.bundled.js";

const elk = new ELK();

export interface LaidOut {
  width: number;
  height: number;
  nodes: Map<string, { x: number; y: number; w: number; h: number }>;
  edges: { points: { x: number; y: number }[]; label?: string }[];
}

export async function layoutLayered(args: {
  nodes: { id: string; w: number; h: number }[];
  edges: { from: string; to: string; label?: string }[];
  direction: "DOWN" | "RIGHT";
}): Promise<LaidOut> {
  const g = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": args.direction,
      "elk.spacing.nodeNode": "28",
      "elk.layered.spacing.nodeNodeBetweenLayers": args.direction === "DOWN" ? "44" : "60",
      "elk.edgeRouting": "ORTHOGONAL",
    },
    children: args.nodes.map((n) => ({ id: n.id, width: n.w, height: n.h })),
    edges: args.edges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
  };
  const out = (await elk.layout(g as Parameters<typeof elk.layout>[0])) as {
    width?: number;
    height?: number;
    children?: { id: string; x?: number; y?: number; width?: number; height?: number }[];
    edges?: { sections?: { startPoint: { x: number; y: number }; endPoint: { x: number; y: number }; bendPoints?: { x: number; y: number }[] }[] }[];
  };
  const nodes = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const c of out.children ?? [])
    nodes.set(c.id, { x: c.x ?? 0, y: c.y ?? 0, w: c.width ?? 0, h: c.height ?? 0 });
  const edges = (out.edges ?? []).flatMap((e, i) =>
    (e.sections ?? []).map((s) => ({
      points: [s.startPoint, ...(s.bendPoints ?? []), s.endPoint],
      label: args.edges[i]?.label,
    })),
  );
  return { width: out.width ?? 0, height: out.height ?? 0, nodes, edges };
}

/** The SVG path for one orthogonal edge section, offset into the world. */
export function edgePath(points: { x: number; y: number }[], ox: number, oy: number): string {
  return "M " + points.map((p) => `${ox + p.x},${oy + p.y}`).join(" L ");
}

/** A plain vertical stack — the layout any graph can always have: no
 *  engine, no waiting, and cards that can never overlap. */
export function stackLayout(nodes: { id: string; w: number; h: number }[]): LaidOut {
  const placed = new Map<string, { x: number; y: number; w: number; h: number }>();
  let y = 0;
  for (const n of nodes) {
    placed.set(n.id, { x: 0, y, w: n.w, h: n.h });
    y += n.h + 18;
  }
  return { nodes: placed, edges: [], width: nodes[0]?.w ?? 0, height: Math.max(y - 18, 0) };
}
