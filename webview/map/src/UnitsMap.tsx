/**
 * The units map — the APPROVED PROTOTYPE ported
 * (store-v1 …/articles/mockups/graph-core-mockup.html): HTML node cards
 * (wrapping title, clamped abstract, `more…` grows the node and ELK
 * reflows neighbors, chip badges in the kind palette), dashed ask-island
 * frames with labels, per-island layered ELK layout over MEASURED sizes,
 * ELK-routed orthogonal edges with arrowheads and `needs` labels, drag =
 * pan, wheel = zoom, `far` simplification below the legibility floor.
 */
import { useEffect, useMemo, useState } from "react";
import { post, SpacePush, UnitVM } from "./vscode";
import { World } from "./proto/world";
import { CardData, Chip, NodeCard, NODE_W, useMeasuredHeights } from "./proto/nodeCard";
import { edgePath, layoutLayered, LaidOut } from "./proto/elkRun";

const PAD = 22;
const GAP = 46;

function chipsFor(u: UnitVM): Chip[] {
  const chips: Chip[] = [
    { text: `${u.count} change${u.count === 1 ? "" : "s"}`, kind: "el" },
    {
      text: `proof ${u.coverage.covered}/${u.coverage.total}${u.coverage.covered === u.coverage.total ? "" : " missing"}`,
      kind: u.coverage.covered === u.coverage.total ? "ac" : "na",
    },
  ];
  if (u.openQuestions > 0) chips.push({ text: `${u.openQuestions} open question${u.openQuestions === 1 ? "" : "s"}`, kind: "q" });
  if (u.inCut) chips.push({ text: "in cut", kind: "cut" });
  if (u.stale) chips.push({ text: "stale — click to re-ground", kind: "stale" });
  return chips;
}

interface Island {
  label: string;
  units: UnitVM[];
  edges: { from: string; to: string; label?: string }[];
}

function islandsByAsk(push: SpacePush): Island[] {
  const groups = new Map<string, UnitVM[]>();
  for (const u of push.units) {
    if (!groups.has(u.askLabel)) groups.set(u.askLabel, []);
    groups.get(u.askLabel)!.push(u);
  }
  return [...groups.entries()].map(([label, units]) => {
    const ids = new Set(units.map((u) => u.id));
    return {
      label,
      units,
      edges: push.edges
        .filter((e) => ids.has(e.from) && ids.has(e.to))
        .map((e) => ({ ...e, label: "needs" })),
    };
  });
}

export function UnitsMap(props: {
  push: SpacePush;
  world: World;
  expandedIds: string[];
  onToggle: (id: string) => void;
  selected: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const { push, world } = props;
  const islands = useMemo(() => islandsByAsk(push), [push]);
  const cards: CardData[] = useMemo(
    () =>
      push.units.map((u) => ({
        id: u.id,
        title: u.title,
        abs: u.abs,
        chips: chipsFor(u),
      })),
    [push.units],
  );
  const expandedKey = props.expandedIds.join(",");
  const { heights, probe } = useMeasuredHeights(cards, expandedKey, world.far);
  const [layouts, setLayouts] = useState<Map<string, LaidOut>>(new Map());

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = new Map<string, LaidOut>();
      for (const isl of islands) {
        next.set(
          isl.label,
          await layoutLayered({
            nodes: isl.units.map((u) => ({ id: u.id, w: NODE_W, h: heights.get(u.id) ?? 90 })),
            edges: isl.edges,
            direction: "DOWN",
          }),
        );
      }
      if (alive) setLayouts(next);
    })();
    return () => {
      alive = false;
    };
  }, [islands, heights]);

  if (push.units.length === 0)
    return (
      <div style={{ flex: 1, padding: 24, opacity: 0.7 }}>
        Nothing here yet — capture your first ask above.
        {probe}
      </div>
    );

  // Islands side by side, exactly like the prototype's renderUnits().
  let ox = 0;
  const placed = islands.map((isl) => {
    const g = layouts.get(isl.label);
    const w = (g?.width ?? NODE_W) + 2 * PAD;
    const h = (g?.height ?? 120) + 2 * PAD;
    const at = { isl, g, ox, w, h };
    ox += w + GAP;
    return at;
  });

  return (
    <div
      data-units-map
      style={{ position: "relative", flex: 1, overflow: "hidden", cursor: "grab", minHeight: 320 }}
      ref={world.ref}
    >
      {probe}
      <div
        style={{
          position: "absolute",
          transformOrigin: "0 0",
          transform: `translate(${world.tx}px, ${world.ty}px) scale(${world.k})`,
        }}
      >
        <svg style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}>
          <defs>
            <marker id="arr" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
              <path d="M0,0L6,3L0,6" fill="none" stroke="#9d9d9d" />
            </marker>
          </defs>
          {placed.flatMap(({ g, ox: x, isl }) =>
            (g?.edges ?? []).map((e, i) => (
              <g key={`${isl.label}${i}`}>
                <path
                  d={edgePath(e.points, x + PAD, PAD)}
                  stroke="var(--vscode-descriptionForeground, #9d9d9d)"
                  strokeWidth={1.5}
                  fill="none"
                  markerEnd="url(#arr)"
                />
                {e.label ? (
                  <text
                    x={x + PAD + e.points[0].x + 6}
                    y={PAD + (e.points[0].y + e.points[e.points.length - 1].y) / 2}
                    fill="var(--vscode-descriptionForeground, #9d9d9d)"
                    fontSize={11}
                  >
                    {e.label}
                  </text>
                ) : null}
              </g>
            )),
          )}
        </svg>
        {placed.map(({ isl, ox: x, w, h }) => (
          <div
            key={isl.label}
            data-island={isl.label}
            style={{
              position: "absolute",
              left: x,
              top: 0,
              width: w,
              height: h,
              border: "1px dashed var(--vscode-panel-border, #3c3c3c)",
              borderRadius: 10,
            }}
          >
            <label
              style={{
                position: "absolute",
                top: -9,
                left: 14,
                background: "var(--vscode-editor-background, #1f1f1f)",
                padding: "0 6px",
                color: "var(--vscode-descriptionForeground, #9d9d9d)",
                fontSize: 12,
              }}
            >
              {isl.label}
            </label>
          </div>
        ))}
        {placed.flatMap(({ isl, g, ox: x }) =>
          isl.units.map((u) => {
            const c = g?.nodes.get(u.id);
            const card = cards.find((k) => k.id === u.id)!;
            return (
              <NodeCard
                key={u.id}
                card={card}
                far={world.far}
                expanded={props.expandedIds.includes(u.id)}
                onToggle={props.onToggle}
                selected={props.selected === u.id}
                onClick={(id) => {
                  props.onSelect(id);
                  if (u.stale) post({ action: "reground" });
                }}
                style={{ left: x + PAD + (c?.x ?? 0), top: PAD + (c?.y ?? 0) }}
              />
            );
          }),
        )}
      </div>
    </div>
  );
}
