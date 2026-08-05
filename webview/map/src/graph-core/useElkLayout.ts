/**
 * The ELK layout hook: builds the elkjs input through the shared pure
 * layoutProfiles and runs the async layout, returning absolute positions
 * (island containers flattened) plus content bounds for fit-to-view.
 */
import { useEffect, useMemo, useState } from "react";
import ELK from "elkjs/lib/elk.bundled.js";
import {
  ElkInputNode,
  Profile,
  buildElkGraph,
} from "../../../../src/surfaces/graphCore/layoutProfiles";

export interface LaidOutNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  island?: number;
}

export interface Layout {
  nodes: Map<string, LaidOutNode>;
  /** Island id → absolute bounding box (for focus-on-island). */
  islands: Map<number, { x: number; y: number; w: number; h: number }>;
  bounds: { x: number; y: number; w: number; h: number };
  ready: boolean;
}

const elk = new ELK();

interface ElkOut {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  id: string;
  children?: ElkOut[];
}

export function useElkLayout(
  nodes: ElkInputNode[],
  edges: { from: string; to: string }[],
  profile: Profile,
): Layout {
  const [out, setOut] = useState<ElkOut | null>(null);
  const key = useMemo(
    () => JSON.stringify({ nodes, edges, profile }),
    [nodes, edges, profile],
  );
  useEffect(() => {
    let alive = true;
    const graph = buildElkGraph(nodes, edges, profile);
    elk
      .layout(graph as Parameters<typeof elk.layout>[0])
      .then((r) => {
        if (alive) setOut(r as ElkOut);
      })
      .catch(() => {
        if (alive) setOut(null);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return useMemo(() => {
    const placed = new Map<string, LaidOutNode>();
    const islands = new Map<number, { x: number; y: number; w: number; h: number }>();
    if (!out)
      return { nodes: placed, islands, bounds: { x: 0, y: 0, w: 1, h: 1 }, ready: false };
    const islandOf = new Map(nodes.map((n) => [n.id, n.island]));
    const walk = (container: ElkOut, ox: number, oy: number) => {
      for (const ch of container.children ?? []) {
        const x = ox + (ch.x ?? 0);
        const y = oy + (ch.y ?? 0);
        if (ch.children?.length && ch.id.startsWith("island-")) {
          walk(ch, x, y);
          islands.set(Number(ch.id.slice("island-".length)), {
            x,
            y,
            w: ch.width ?? 0,
            h: ch.height ?? 0,
          });
        } else {
          placed.set(ch.id, {
            id: ch.id,
            x,
            y,
            w: ch.width ?? 0,
            h: ch.height ?? 0,
            island: islandOf.get(ch.id),
          });
        }
      }
    };
    walk(out, 0, 0);
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of placed.values()) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    }
    const bounds =
      placed.size > 0
        ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
        : { x: 0, y: 0, w: 1, h: 1 };
    return { nodes: placed, islands, bounds, ready: placed.size > 0 };
  }, [out, nodes]);
}
