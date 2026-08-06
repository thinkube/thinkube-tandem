/**
 * The orchestration flow view — on the SAME shared graph-core as the units
 * map (TEP-22: one graph-core; no surface carries its own graph
 * infrastructure): layered ELK profile, d3-zoom viewport, LOD-aware run
 * nodes with live state colors and elapsed time, a pulsing running node,
 * a determinate progress header, parked workers answerable in place, Stop,
 * and the log tail.
 */
import { useEffect, useMemo, useState } from "react";
import { post, SpacePush } from "./vscode";
import { Canvas, Edge, NodeFrame, useElkLayout, useViewport } from "./graph-core";
import { ZOOM_MIN, ZOOM_MAX, representationFor } from "../../../src/surfaces/graphCore/lod";
import {
  RUN_NODE_H,
  RUN_NODE_W,
  RUN_STATE_COLOR,
  runNodeSpec,
} from "../../../src/surfaces/graphCore/runNode";

const CLAMPS = { min: ZOOM_MIN, max: ZOOM_MAX };

function FlowGraph(props: {
  units: NonNullable<SpacePush["run"]>["units"];
  selected: string | null;
  onSelect: (id: string) => void;
  now: number;
}): JSX.Element {
  const { units } = props;
  const viewport = useViewport(CLAMPS);
  const edges = useMemo(
    () => units.flatMap((u) => u.requires.map((r) => ({ from: r, to: u.id }))),
    [units],
  );
  const elkNodes = useMemo(
    () => units.map((u) => ({ id: u.id, w: RUN_NODE_W, h: RUN_NODE_H })),
    [units],
  );
  const layout = useElkLayout(elkNodes, edges, "layered");
  const rep = representationFor(viewport.transform.k);
  return (
    <Canvas viewport={viewport} contentBounds={layout.bounds}>
      <style>{`@keyframes tandemPulse { 0%,100% { opacity: 1 } 50% { opacity: 0.45 } }`}</style>
      {edges.map((e, i) => {
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
      {units.map((u) => {
        const p = layout.nodes.get(u.id);
        if (!p) return null;
        const color = RUN_STATE_COLOR[u.state] ?? RUN_STATE_COLOR.ready;
        const texts = runNodeSpec(
          {
            id: u.id,
            slice: u.slice,
            role: u.role,
            state: u.state,
            elapsedMs: u.startedAt ? props.now - u.startedAt : undefined,
          },
          rep,
        );
        return (
          <g
            key={u.id}
            data-run-node={u.id}
            style={u.state === "running" ? { animation: "tandemPulse 1.2s ease-in-out infinite" } : undefined}
          >
            <NodeFrame
              x={p.x}
              y={p.y}
              w={RUN_NODE_W}
              h={RUN_NODE_H}
              accent={color}
              stroke={props.selected === u.id ? "var(--vscode-focusBorder, #4da6ff)" : undefined}
              title=""
              onClick={() => props.onSelect(u.id)}
              hoverTitle={`${u.id} — ${u.role}, ${u.state}`}
            >
              <circle cx={RUN_NODE_W - 14} cy={14} r={5} fill={color} />
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
            </NodeFrame>
          </g>
        );
      })}
    </Canvas>
  );
}

export function RunSection(props: { run: NonNullable<SpacePush["run"]> }): JSX.Element {
  const { run } = props;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const done = run.units.filter((u) => u.state === "done").length;
  const total = run.units.length || 1;
  const pickedUnit = run.units.find((u) => u.id === picked);
  return (
    <section data-run-view style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <strong>The run</strong>
        <span data-run-progress-text style={{ fontSize: 12, opacity: 0.8 }}>
          {done} of {run.units.length} units done
        </span>
        <span style={{ flex: 1, height: 5, background: "var(--vscode-input-background, #222)", borderRadius: 3, overflow: "hidden" }}>
          <span
            data-run-progress
            style={{
              display: "block",
              height: "100%",
              width: `${Math.round((done / total) * 100)}%`,
              background: "var(--vscode-progressBar-background, #3794ff)",
              transition: "width 400ms",
            }}
          />
        </span>
        <button
          data-stop-run
          title="Stop the run — aborts every live worker; the run drains and reports"
          style={{ background: "var(--vscode-statusBarItem-errorBackground, #c72e2e)", color: "#fff", border: "none", borderRadius: 4, padding: "2px 10px", cursor: "pointer" }}
          onClick={() => post({ action: "stop-run" })}
        >
          ■ Stop
        </button>
      </div>
      <div style={{ height: 260, margin: "6px 0" }}>
        <FlowGraph units={run.units} selected={picked} onSelect={setPicked} now={now} />
      </div>
      {pickedUnit ? (
        <div data-graph-detail style={{ fontSize: 12, opacity: 0.85, margin: "2px 0 6px" }}>
          {pickedUnit.id} — {pickedUnit.role} unit of {pickedUnit.slice}, {pickedUnit.state}
          {pickedUnit.requires.length ? ` · waits on ${pickedUnit.requires.join(", ")}` : ""}
          {pickedUnit.question ? ` · ❓ ${pickedUnit.question}` : ""}
        </div>
      ) : null}
      {run.parked.map((p) => (
        <div key={p.unitId} data-parked={p.unitId} style={{ margin: "6px 0", padding: 6, border: "1px solid #d29922", borderRadius: 6 }}>
          <div style={{ fontSize: 12, marginBottom: 4 }}>❓ {p.unitId}: {p.question}</div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              data-answer-input={p.unitId}
              value={answers[p.unitId] ?? ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [p.unitId]: e.target.value }))}
              style={{ flex: 1, fontSize: 12 }}
            />
            <button
              data-answer-send={p.unitId}
              onClick={() => {
                const text = (answers[p.unitId] ?? "").trim();
                if (text) post({ action: "answer-worker", unitId: p.unitId, text });
              }}
            >
              Send
            </button>
          </div>
        </div>
      ))}
      <pre style={{ fontSize: 11, opacity: 0.8, whiteSpace: "pre-wrap", maxHeight: 160, overflowY: "auto" }}>{run.logs.join("\n")}</pre>
    </section>
  );
}
