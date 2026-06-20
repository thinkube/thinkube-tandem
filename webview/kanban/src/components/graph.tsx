/**
 * Control-center graph view (SP-tgs8nz SL-4): the slice-DAG rendered as status-coloured
 * nodes + dependency edges, with a running-session tag on live nodes. Clicking a running
 * node floats its session out (postToHost `float-out`). Pure presentation over the board the
 * host already sends — tasks carry `columnId` → status colour, `dependsOn` → edges, `running`.
 */
import { useMemo } from "react";
import { useGlobalState } from "../utils/context";
import { postToHost } from "../utils/vscode";
import { lookupPalette } from "../utils/palette";
import { TaskCard } from "../types";

const STATUS_SLUG: Record<string, string> = {
  "column-ready": "indigo",
  "column-doing": "azure",
  "column-attention": "amber",
  "column-done": "lime",
};

function colorFor(columnId: string): string {
  return lookupPalette(STATUS_SLUG[columnId] ?? "slate").accent;
}

const NODE_W = 210;
const NODE_H = 56;
const COL_GAP = 80;
const ROW_GAP = 22;

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function GraphView(): JSX.Element {
  const { state } = useGlobalState();

  const { nodes, edges, width, height } = useMemo(() => {
    // Slice cards only — exclude the auto-derived acceptance close-cards.
    const cards = Object.values(state.tasks).filter((t) => !t.isAcceptance);
    const byId = new Map(cards.map((c) => [c.id, c]));

    // Layer each node by its longest dependency chain (topological depth).
    const depthCache = new Map<string, number>();
    const depthOf = (id: string, seen: Set<string> = new Set()): number => {
      const cached = depthCache.get(id);
      if (cached != null) return cached;
      if (seen.has(id)) return 0; // cycle guard
      seen.add(id);
      const deps = (byId.get(id)?.dependsOn ?? []).filter((d) => byId.has(d));
      const d = deps.length
        ? 1 + Math.max(...deps.map((x) => depthOf(x, new Set(seen))))
        : 0;
      depthCache.set(id, d);
      return d;
    };

    const layers = new Map<number, TaskCard[]>();
    for (const c of cards) {
      const d = depthOf(c.id);
      const arr = layers.get(d) ?? [];
      arr.push(c);
      layers.set(d, arr);
    }

    const pos = new Map<string, { x: number; y: number }>();
    let maxRows = 0;
    for (const [d, arr] of layers) {
      arr.forEach((c, i) =>
        pos.set(c.id, {
          x: d * (NODE_W + COL_GAP),
          y: i * (NODE_H + ROW_GAP),
        }),
      );
      maxRows = Math.max(maxRows, arr.length);
    }
    const maxDepth = layers.size ? Math.max(...layers.keys()) : 0;

    const placed = cards.map((c) => {
      const p = pos.get(c.id) ?? { x: 0, y: 0 };
      return { card: c, x: p.x, y: p.y };
    });
    const lines = cards.flatMap((c) =>
      (c.dependsOn ?? [])
        .filter((d) => byId.has(d))
        .map((d) => ({
          key: `${d}->${c.id}`,
          from: pos.get(d) ?? { x: 0, y: 0 },
          to: pos.get(c.id) ?? { x: 0, y: 0 },
        })),
    );
    return {
      nodes: placed,
      edges: lines,
      width: (maxDepth + 1) * (NODE_W + COL_GAP),
      height: maxRows * (NODE_H + ROW_GAP) + ROW_GAP,
    };
  }, [state.tasks]);

  if (nodes.length === 0) {
    return (
      <div style={{ padding: 24, opacity: 0.7 }}>No slices to graph yet.</div>
    );
  }

  const edgeColor = "var(--vscode-editorIndentGuide-background, #888)";

  return (
    <div style={{ overflow: "auto", padding: 16, height: "100%" }}>
      <svg width={Math.max(width, 1)} height={Math.max(height, 1)}>
        <defs>
          <marker
            id="tk-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={edgeColor} />
          </marker>
        </defs>
        {edges.map((e) => (
          <line
            key={e.key}
            x1={e.from.x + NODE_W}
            y1={e.from.y + NODE_H / 2}
            x2={e.to.x}
            y2={e.to.y + NODE_H / 2}
            stroke={edgeColor}
            strokeWidth={1.5}
            markerEnd="url(#tk-arrow)"
          />
        ))}
        {nodes.map(({ card, x, y }) => {
          const accent = colorFor(card.columnId);
          return (
            <g key={card.id} transform={`translate(${x},${y})`}>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill="var(--vscode-editor-background)"
                stroke={accent}
                strokeWidth={2}
              />
              <rect width={6} height={NODE_H} rx={3} fill={accent} />
              <text
                x={16}
                y={23}
                fill="var(--vscode-foreground)"
                fontSize={12}
                fontWeight={600}
              >
                {truncate(card.id, 24)}
              </text>
              <text
                x={16}
                y={41}
                fill="var(--vscode-descriptionForeground, #aaa)"
                fontSize={11}
              >
                {truncate(card.description, 28)}
              </text>
              {/* A node per running worker (SP-tgs8nz_SL-4): one pulsing dot per execution-unit
                  session on this slice; click it to float out that worker's live JSON-log. */}
              {(card.runningWorkers ?? []).length > 0 && (
                <>
                  <text
                    x={16}
                    y={NODE_H - 6}
                    fill="#3fb950"
                    fontSize={9}
                  >
                    {card.runningWorkers!.length} worker
                    {card.runningWorkers!.length > 1 ? "s" : ""} running
                  </text>
                  {card.runningWorkers!.map((w, i) => (
                    <circle
                      key={w}
                      cx={NODE_W - 14 - i * 14}
                      cy={16}
                      r={5}
                      fill="#3fb950"
                      style={{ cursor: "pointer" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        postToHost({ kind: "float-out", handle: w });
                      }}
                    >
                      <title>{`${w} — click to open its live log`}</title>
                      <animate
                        attributeName="opacity"
                        values="1;0.3;1"
                        dur="1.2s"
                        repeatCount="indefinite"
                      />
                    </circle>
                  ))}
                </>
              )}
              {/* A parked (needs-input) worker (SP-tgs8nz_SL-3): an amber dot; click it to
                  answer the question and resume the resident session via /attend. */}
              {(card.parkedWorkers ?? []).length > 0 && (
                <>
                  <text x={16} y={NODE_H - 6} fill="#d29922" fontSize={9}>
                    {card.parkedWorkers!.length} awaiting answer
                  </text>
                  {card.parkedWorkers!.map((w, i) => (
                    <circle
                      key={w}
                      cx={NODE_W - 14 - i * 14}
                      cy={NODE_H - 14}
                      r={5}
                      fill="#d29922"
                      style={{ cursor: "pointer" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        postToHost({ kind: "attend", handle: card.id });
                      }}
                    >
                      <title>{`${w} asked a question — click to answer (/attend)`}</title>
                    </circle>
                  ))}
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
