/**
 * The units map on the shared graph-core: ELK islands layout, d3-zoom
 * viewport, LOD-aware unit cards with coverage and open-question badges,
 * in-canvas title expansion persisting across reflow, stale badges that
 * re-ground on press.
 */
import { useMemo } from "react";
import { post, SpacePush } from "./vscode";
import { Badge, Canvas, Edge, NodeFrame, useElkLayout, useViewport } from "./graph-core";
import { ZOOM_MIN, ZOOM_MAX, representationFor } from "../../../src/surfaces/graphCore/lod";
import { UNIT_NODE_W, UNIT_NODE_H, unitsNodeSpec } from "../../../src/surfaces/graphCore/unitsNode";
import {
  createExpansionStore,
  expandableLabel,
  wrapBody,
} from "../../../src/surfaces/graphCore/expander";

const CLAMPS = { min: ZOOM_MIN, max: ZOOM_MAX };

export function UnitsMap(props: {
  push: SpacePush;
  expansion: ReturnType<typeof createExpansionStore>;
  selected: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const { push, expansion } = props;
  const viewport = useViewport(CLAMPS);
  const TITLE_CHARS = 30;
  const heightOf = (u: { id: string; title: string }): number => {
    const label = expandableLabel({
      text: u.title,
      maxChars: TITLE_CHARS,
      expanded: expansion.isExpanded(u.id),
    });
    return label.expanded
      ? UNIT_NODE_H + (wrapBody(label.full, TITLE_CHARS).length - 1) * 14
      : UNIT_NODE_H;
  };
  const elkNodes = useMemo(
    () =>
      push.units.map((u) => ({
        id: u.id,
        w: UNIT_NODE_W,
        h: heightOf(u),
        island: u.island,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [push.units, expansion.expandedIds().join(",")],
  );
  const layout = useElkLayout(elkNodes, push.edges, "islands");
  if (push.units.length === 0)
    return (
      <div style={{ flex: 1, padding: 24, opacity: 0.7 }}>
        Nothing here yet — capture your first ask above.
      </div>
    );
  const rep = representationFor(viewport.transform.k);
  return (
    <Canvas viewport={viewport} contentBounds={layout.bounds}>
      {push.edges.map((e, i) => {
        const from = layout.nodes.get(e.from);
        const to = layout.nodes.get(e.to);
        if (!from || !to) return null;
        return (
          <Edge
            key={i}
            from={{ x: from.x + from.w, y: from.y + from.h / 2 }}
            to={{ x: to.x, y: to.y + to.h / 2 }}
          />
        );
      })}
      {push.units.map((u) => {
        const p = layout.nodes.get(u.id);
        if (!p) return null;
        const label = expandableLabel({
          text: u.title,
          maxChars: TITLE_CHARS,
          expanded: expansion.isExpanded(u.id),
        });
        const bodyLines = label.expanded ? wrapBody(label.full, TITLE_CHARS) : [label.body];
        const texts = unitsNodeSpec(
          { id: u.id, title: bodyLines[0], count: u.count, inCut: u.inCut },
          rep,
        ).map((t) => (t.role === "title" ? { ...t, text: bodyLines[0] } : t));
        return (
          <NodeFrame
            key={u.id}
            x={p.x}
            y={p.y}
            w={UNIT_NODE_W}
            h={p.h}
            accent={u.inCut ? "#c9a227" : "#14b8a6"}
            stroke={
              props.selected === u.id
                ? "var(--vscode-focusBorder, #4da6ff)"
                : undefined
            }
            title=""
            onClick={() => props.onSelect(u.id)}
            hoverTitle={u.title}
          >
            {texts.map((t, i) => (
              <text
                key={i}
                x={t.x}
                y={t.y}
                fontSize={t.fontSize}
                fontWeight={t.weight}
                fill={t.color}
                data-role={t.role}
              >
                {t.text}
              </text>
            ))}
            {label.expanded
              ? bodyLines.slice(1).map((line, i) => (
                  <text key={`x${i}`} x={14} y={22 + 14 * (i + 1)} fontSize={12} fontWeight={600} fill="var(--vscode-foreground, #ddd)">
                    {line}
                  </text>
                ))
              : null}
            {rep !== "far" && label.expander ? (
              <text
                data-expander={u.id}
                x={UNIT_NODE_W - 52}
                y={p.h - 8}
                fontSize={11}
                fill="var(--vscode-textLink-foreground, #4da6ff)"
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  expansion.toggle(u.id);
                }}
              >
                {label.expander.label}
              </text>
            ) : null}
            {rep !== "far" ? (
              <>
                <text data-coverage={u.id} x={14} y={p.h - 8} fontSize={11} fill={u.coverage.covered === u.coverage.total ? "#3fb950" : "#f59e0b"}>
                  proof {u.coverage.covered}/{u.coverage.total}
                </text>
                {u.openQuestions > 0 ? (
                  <text data-open-questions={u.id} x={80} y={p.h - 8} fontSize={11} fill="#d29922">
                    ❓ {u.openQuestions}
                  </text>
                ) : null}
              </>
            ) : null}
            {rep !== "far" && u.inCut ? (
              <Badge x={UNIT_NODE_W - 70} y={6} text="in the cut" color="#c9a227" />
            ) : null}
            {rep !== "far" && u.stale ? (
              <g
                data-stale={u.id}
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  post({ action: "reground" });
                }}
              >
                <Badge
                  x={UNIT_NODE_W - 70}
                  y={UNIT_NODE_H - 22}
                  text="stale — press to re-ground"
                  color="#f59e0b"
                />
              </g>
            ) : null}
          </NodeFrame>
        );
      })}
    </Canvas>
  );
}

