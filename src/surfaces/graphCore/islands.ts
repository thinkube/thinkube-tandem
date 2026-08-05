/**
 * Islands: connected components (undirected) over unit-dependency edges.
 * Every node gets an island id; disconnected groups get different ids, so
 * a layout can keep them visually separated.
 */

export interface IslandEdge {
  from: string;
  to: string;
}

export function islandsOf(
  nodeIds: string[],
  edges: IslandEdge[],
): Map<string, number> {
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    if (!adj.has(e.from) || !adj.has(e.to)) continue;
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }
  const island = new Map<string, number>();
  let next = 0;
  for (const start of nodeIds) {
    if (island.has(start)) continue;
    const id = next++;
    const queue = [start];
    island.set(start, id);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const nb of adj.get(cur) ?? [])
        if (!island.has(nb)) {
          island.set(nb, id);
          queue.push(nb);
        }
    }
  }
  return island;
}
