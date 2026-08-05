/**
 * The Tandem space surface: capture at the top, the units map in the
 * middle, the two gates on the right. Renders exactly what the host
 * pushes; every abstract flips to its machine face with one gesture.
 */
import { useEffect, useMemo, useState } from "react";
import { onSpace, post, SpacePush, UnitVM } from "./vscode";
import {
  Badge,
  Canvas,
  Edge,
  NodeFrame,
  useElkLayout,
  useViewport,
} from "./graph-core";
import {
  ZOOM_MIN,
  ZOOM_MAX,
  representationFor,
} from "../../../src/surfaces/graphCore/lod";
import {
  UNIT_NODE_H,
  UNIT_NODE_W,
  unitsNodeSpec,
} from "../../../src/surfaces/graphCore/unitsNode";

const CLAMPS = { min: ZOOM_MIN, max: ZOOM_MAX };

export function App(): JSX.Element {
  const [push, setPush] = useState<SpacePush | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");

  useEffect(() => onSpace(setPush), []);

  if (!push) return <div style={{ padding: 24, opacity: 0.7 }}>Loading the space…</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "8px 12px",
          borderBottom: "1px solid var(--vscode-panel-border, #333)",
          alignItems: "center",
        }}
      >
        <input
          data-capture
          value={draft}
          placeholder="Say what you want — your words are kept verbatim"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              post({ action: "capture", text: draft });
              setDraft("");
            }
          }}
          style={{
            flex: 1,
            padding: "6px 10px",
            background: "var(--vscode-input-background, #222)",
            color: "var(--vscode-input-foreground, #ddd)",
            border: "1px solid var(--vscode-input-border, #444)",
            borderRadius: 6,
          }}
        />
        {push.running ? (
          <span style={{ fontSize: 12, color: "#3fb950" }}>● building…</span>
        ) : null}
        {push.message ? (
          <span style={{ fontSize: 12, opacity: 0.75 }}>{push.message}</span>
        ) : null}
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <UnitsMap
          push={push}
          selected={selected}
          onSelect={(id) => {
            setSelected(id);
            post({ action: "select-unit", unitId: id });
          }}
        />
        <SidePanel
          push={push}
          selected={selected}
          flipped={flipped}
          onFlip={(id) =>
            setFlipped((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
        />
      </div>
    </div>
  );
}

function UnitsMap(props: {
  push: SpacePush;
  selected: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const { push } = props;
  const viewport = useViewport(CLAMPS);
  const elkNodes = useMemo(
    () =>
      push.units.map((u) => ({
        id: u.id,
        w: UNIT_NODE_W,
        h: UNIT_NODE_H,
        island: u.island,
      })),
    [push.units],
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
        const texts = unitsNodeSpec(
          { id: u.id, title: u.title, count: u.count, inCut: u.inCut },
          rep,
        );
        return (
          <NodeFrame
            key={u.id}
            x={p.x}
            y={p.y}
            w={UNIT_NODE_W}
            h={UNIT_NODE_H}
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

function SidePanel(props: {
  push: SpacePush;
  selected: string | null;
  flipped: Set<string>;
  onFlip: (id: string) => void;
}): JSX.Element {
  const { push } = props;
  const unit = push.units.find((u) => u.id === props.selected);
  const btn: React.CSSProperties = {
    background: "var(--vscode-button-background)",
    color: "var(--vscode-button-foreground)",
    border: "none",
    borderRadius: 4,
    padding: "4px 12px",
    cursor: "pointer",
    fontWeight: 600,
  };
  return (
    <div
      style={{
        width: 360,
        borderLeft: "1px solid var(--vscode-panel-border, #333)",
        padding: 12,
        overflowY: "auto",
        fontSize: 13,
      }}
    >
      {unit ? (
        <section data-unit-panel style={{ marginBottom: 16 }}>
          <strong>{unit.title}</strong>
          <div style={{ margin: "6px 0" }}>
            <button
              data-toggle-cut
              style={btn}
              onClick={() => post({ action: "toggle-cut", nodeIds: unit.nodeIds })}
            >
              {unit.inCut ? "Remove from cut" : "Add to cut"}
            </button>
          </div>
          {unit.nodes.map((n) => (
            <div key={n.id} style={{ padding: "4px 0" }}>
              <div>
                • {n.sentence}{" "}
                <span
                  data-flip={n.id}
                  title="Open the machine face"
                  style={{ cursor: "pointer", opacity: 0.6 }}
                  onClick={() => props.onFlip(n.id)}
                >
                  ⌄
                </span>
              </div>
              {props.flipped.has(n.id) ? (
                <pre
                  data-machine-face
                  style={{
                    fontSize: 11,
                    opacity: 0.85,
                    margin: "4px 0 4px 12px",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {`lands at: ${n.touchpoints.join(", ") || "(not grounded)"}\nproven by: ${n.checks.join("; ") || "(nothing yet)"}`}
                </pre>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
      {push.cutCount > 0 ? (
        <section data-cut-screen style={{ marginBottom: 16 }}>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{push.cutScreen}</pre>
          <button data-sign style={btn} onClick={() => post({ action: "sign-cut" })}>
            Sign
          </button>
        </section>
      ) : null}
      {push.deliveries.map((d) => (
        <section key={d.id} data-delivery={d.id} style={{ marginBottom: 16 }}>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{d.page}</pre>
          {d.undelivered?.length ? (
            <div style={{ color: "#f59e0b", fontSize: 12, margin: "4px 0" }}>
              {d.undelivered.map((u, i) => (
                <div key={i}>UNDELIVERED: {u}</div>
              ))}
            </div>
          ) : null}
          {d.url ? (
            <div style={{ fontSize: 12, margin: "4px 0" }}>
              <a href={d.url}>{d.url}</a>
            </div>
          ) : null}
          {d.accepted ? (
            <span style={{ opacity: 0.7 }}>accepted</span>
          ) : (
            <button
              data-accept
              style={btn}
              onClick={() => post({ action: "accept-delivery", deliveryId: d.id })}
            >
              Accept
            </button>
          )}
        </section>
      ))}
    </div>
  );
}
