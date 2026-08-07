/**
 * The units map — the APPROVED PROTOTYPE ported
 * (store-v1 …/articles/mockups/graph-core-mockup.html): HTML node cards
 * (wrapping title, clamped abstract, `more…` grows the node and ELK
 * reflows neighbors, chip badges in the kind palette), dashed ask-island
 * frames with labels, per-island layered ELK layout over MEASURED sizes,
 * ELK-routed orthogonal edges with arrowheads and `needs` labels, drag =
 * pan, wheel = zoom, `far` simplification below the legibility floor.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { post, SpacePush, UnitVM } from "./vscode";
import { World } from "./proto/world";
import { CardData, Chip, NodeCard, NODE_W, useMeasuredHeights } from "./proto/nodeCard";
import { edgePath, layoutLayered, LaidOut } from "./proto/elkRun";

const PAD = 22;
const GAP = 46;

function chipsFor(u: UnitVM): Chip[] {
  const chips: Chip[] = [
    {
      text: `${u.count} promise${u.count === 1 ? "" : "s"}`,
      kind: "el",
      why: "How many promises this unit bundles — each one small, provable thing to build.",
    },
    u.coverage.covered === u.coverage.total
      ? { text: "every promise has its check", kind: "ac", why: "Each promise carries a check that will prove it was kept." }
      : {
          text: `${u.coverage.total - u.coverage.covered} without a check`,
          kind: "na",
          why: "Some promises have no check yet — nothing would prove them. Open the unit and press 'Write a check'.",
        },
  ];
  if (u.openQuestions > 0)
    chips.push({
      text: `${u.openQuestions} open question${u.openQuestions === 1 ? "" : "s"}`,
      kind: "q",
      why: "The machine needs your answer — it is waiting in the panel on the right.",
    });

  if (u.tep)
    chips.push({
      text: `signed — ${u.tep}`,
      kind: "pass",
      why: "These promises are in a signed work order — being built or already delivered. They cannot be cut again.",
    });
  if (u.stale)
    chips.push({
      text: "out of date — click to re-check",
      kind: "stale",
      why: "The code changed underneath this unit since the machine read it. Clicking re-reads the code.",
    });
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

/** Every unit's position in world coordinates — the same island-row math
 *  the renderer uses, factored so anchoring reads it before and after a
 *  reflow. */
function positionsOf(islands: Island[], layouts: Map<string, LaidOut>): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  let ox = 0;
  for (const isl of islands) {
    const g = layouts.get(isl.label);
    for (const u of isl.units) {
      const c = g?.nodes.get(u.id);
      if (c) out.set(u.id, { x: ox + PAD + c.x, y: PAD + c.y });
    }
    ox += (g?.width ?? NODE_W) + 2 * PAD + GAP;
  }
  return out;
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
        inCut: u.inCut,
      })),
    [push.units],
  );
  const expandedKey = props.expandedIds.join(",");
  const { heights, probe } = useMeasuredHeights(cards, expandedKey, world.far);
  const [layouts, setLayouts] = useState<Map<string, LaidOut>>(new Map());
  // Relayout only when the STRUCTURE changes (ids/heights), not on every
  // liveness push — the churn the human saw as cards merging.
  const layoutKey = useMemo(
    () =>
      islands
        .map((i) => `${i.label}:${i.units.map((x) => `${x.id}@${heights.get(x.id) ?? 0}`).join(",")}`)
        .join("|"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [islands, heights],
  );

  // A reflow never moves the card you are touching: the card's position is
  // recorded before the layout recomputes, and the viewport shifts by the
  // delta after — the neighbors move, the anchor stays pixel-fixed.
  const anchor = useRef<{ id: string; x: number; y: number } | null>(null);
  const handleToggle = (id: string): void => {
    const p = positionsOf(islands, layouts).get(id);
    if (p) anchor.current = { id, ...p };
    props.onToggle(id);
  };
  // Crossing the legibility floor reflows every card; anchor on the one
  // nearest the middle of the view so the map does not jump under the zoom.
  const prevFar = useRef(world.far);
  useEffect(() => {
    if (prevFar.current === world.far) return;
    prevFar.current = world.far;
    const el = world.element;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = (r.width / 2 - world.tx) / world.k;
    const cy = (r.height / 2 - world.ty) / world.k;
    let best: { id: string; x: number; y: number } | null = null;
    let bd = Infinity;
    for (const [id, p] of positionsOf(islands, layouts)) {
      const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
      if (d < bd) {
        bd = d;
        best = { id, ...p };
      }
    }
    if (best) anchor.current = best;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.far]);
  useEffect(() => {
    const a = anchor.current;
    if (!a) return;
    anchor.current = null;
    const p = positionsOf(islands, layouts).get(a.id);
    if (p) world.shiftBy((a.x - p.x) * world.k, (a.y - p.y) * world.k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layouts]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = new Map<string, LaidOut>();
      for (const isl of islands) {
        const nodes = isl.units.map((u) => ({ id: u.id, w: NODE_W, h: heights.get(u.id) ?? 90 }));
        try {
          next.set(isl.label, await layoutLayered({ nodes, edges: isl.edges, direction: "DOWN" }));
        } catch (err) {
          // The layout engine refused this island — stack vertically so
          // cards can NEVER overlap, and say so instead of freezing.
          console.error("tandem: layout failed for island", isl.label, err);
          let y = 0;
          const stacked = new Map<string, { x: number; y: number; w: number; h: number }>();
          for (const n of nodes) {
            stacked.set(n.id, { x: 0, y, w: n.w, h: n.h });
            y += n.h + 18;
          }
          next.set(isl.label, { nodes: stacked, edges: [], width: NODE_W, height: y });
        }
      }
      if (alive) setLayouts(next);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

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
            // A card with no coordinates yet stays unrendered — never a
            // pile at the island origin while the layout computes.
            if (!c) return null;
            return (
              <NodeCard
                key={u.id}
                card={card}
                far={world.far}
                expanded={props.expandedIds.includes(u.id)}
                onToggle={handleToggle}
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
