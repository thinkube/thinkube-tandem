/**
 * ELK layout profiles: 'layered' for the orchestration flow (a left-to-right
 * DAG) and 'islands' for the units map (one nested container per connected
 * component, so islands stay visually separated). This module only builds
 * the elkjs input JSON; the async layout call lives in the webview hook.
 */

export type Profile = "layered" | "islands";

export function elkOptions(p: Profile): Record<string, string> {
  if (p === "layered")
    return {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
      "elk.spacing.nodeNode": "24",
      "elk.padding": "[top=24,left=24,bottom=24,right=24]",
    };
  return {
    "elk.algorithm": "box",
    "elk.spacing.nodeNode": "48",
    "elk.padding": "[top=24,left=24,bottom=24,right=24]",
  };
}

export interface ElkInputNode {
  id: string;
  w: number;
  h: number;
  island?: number;
}

export function buildElkGraph(
  nodes: ElkInputNode[],
  edges: { from: string; to: string }[],
  p: Profile,
): unknown {
  const child = (n: ElkInputNode) => ({ id: n.id, width: n.w, height: n.h });
  const edge = (e: { from: string; to: string }, i: number) => ({
    id: `e${i}-${e.from}-${e.to}`,
    sources: [e.from],
    targets: [e.to],
  });
  if (p === "layered")
    return {
      id: "root",
      layoutOptions: elkOptions("layered"),
      children: nodes.map(child),
      edges: edges.map(edge),
    };
  // Islands: nodes grouped into one container per island id; each container
  // lays out its own dependency DAG; the box algorithm packs the containers
  // apart. Edges are intra-island by construction (connected components).
  const byIsland = new Map<number, ElkInputNode[]>();
  for (const n of nodes) {
    const id = n.island ?? 0;
    if (!byIsland.has(id)) byIsland.set(id, []);
    byIsland.get(id)!.push(n);
  }
  const memberIsland = new Map<string, number>();
  for (const n of nodes) memberIsland.set(n.id, n.island ?? 0);
  return {
    id: "root",
    layoutOptions: elkOptions("islands"),
    children: [...byIsland.entries()].map(([islandId, members]) => ({
      id: `island-${islandId}`,
      layoutOptions: elkOptions("layered"),
      children: members.map(child),
      edges: edges
        .filter((e) => memberIsland.get(e.from) === islandId)
        .map(edge),
    })),
  };
}
