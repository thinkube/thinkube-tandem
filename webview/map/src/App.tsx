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
  const [panicArmed, setPanicArmed] = useState(false);

  useEffect(() => onSpace(setPush), []);

  if (!push) return <div style={{ padding: 24, opacity: 0.7 }}>Loading the space…</div>;
  if (push.needsRepo)
    return (
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
        <div style={{ opacity: 0.8 }}>Which project are you working on?</div>
        <button
          data-choose-repo
          style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid var(--vscode-input-border, #444)", background: "var(--vscode-button-background, #0e639c)", color: "var(--vscode-button-foreground, #fff)", cursor: "pointer" }}
          onClick={() => post({ action: "switch-repo" })}
        >
          Choose project…
        </button>
        {push.message ? <div style={{ fontSize: 12, opacity: 0.7 }}>{push.message}</div> : null}
      </div>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          padding: "8px 12px",
          borderBottom: "1px solid var(--vscode-panel-border, #333)",
          alignItems: "center",
        }}
      >
        <textarea
          data-capture
          value={draft}
          rows={Math.min(6, Math.max(2, draft.split("\n").length))}
          placeholder="Say what you want — your words are kept verbatim. Enter sends, Shift+Enter is a new line."
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && draft.trim()) {
              e.preventDefault();
              post({ action: "capture", text: draft });
              setDraft("");
            }
          }}
          style={{
            flexBasis: "100%",
            minWidth: 0,
            resize: "vertical",
            padding: "6px 10px",
            fontFamily: "inherit",
            fontSize: 13,
            background: "var(--vscode-input-background, #222)",
            color: "var(--vscode-input-foreground, #ddd)",
            border: "1px solid var(--vscode-input-border, #444)",
            borderRadius: 6,
          }}
        />
        <button
          data-switch-repo
          title="Switch the project this space works on"
          style={{ fontSize: 11, background: "none", border: "1px solid var(--vscode-input-border, #444)", borderRadius: 4, cursor: "pointer", color: "inherit", padding: "2px 8px" }}
          onClick={() => post({ action: "switch-repo" })}
        >
          {push.repoName ?? "choose project"} ▾
        </button>
        <span data-identity style={{ fontSize: 11, opacity: 0.65, whiteSpace: "nowrap" }}>
          {push.units.length} unit(s) · {push.cutCount} in cut · {push.signedTeps} TEP(s)
        </span>
        {!push.running && push.signedTeps === 0 && (push.units.length > 0 || push.questions.length > 0) ? (
          panicArmed ? (
            <button
              data-panic-confirm
              style={{ fontSize: 11, color: "#f85149", background: "none", border: "1px solid #f85149", borderRadius: 4, cursor: "pointer" }}
              onClick={() => {
                setPanicArmed(false);
                post({ action: "panic" });
              }}
            >
              Really clear derived thinking?
            </button>
          ) : (
            <button
              data-panic
              style={{ fontSize: 11, opacity: 0.6, background: "none", border: "none", cursor: "pointer", color: "inherit" }}
              onClick={() => setPanicArmed(true)}
            >
              Panic
            </button>
          )
        ) : null}
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

function Questions(props: { push: SpacePush }): JSX.Element {
  const { push } = props;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  return (
    <section data-questions style={{ marginBottom: 16 }}>
      <strong>Questions for you ({push.questions.length})</strong>
      {push.questions.map((q) => (
        <div key={q.id} data-question={q.id} style={{ margin: "6px 0", padding: 6, border: "1px solid #f59e0b", borderRadius: 6 }}>
          <div style={{ fontSize: 12 }}>{q.text}</div>
          <textarea
            data-question-text={q.id}
            disabled={push.running}
            value={drafts[q.id] ?? q.recommendation ?? ""}
            onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
            style={{ width: "100%", minHeight: 40, fontSize: 12, margin: "4px 0" }}
          />
          <button
            data-accept-question={q.id}
            disabled={push.running}
            title="Accept — this becomes a binding decision and the ask re-grounds under it"
            onClick={() =>
              post({ action: "accept-question", questionId: q.id, text: (drafts[q.id] ?? q.recommendation ?? "").trim() })
            }
          >
            Accept
          </button>
        </div>
      ))}
      {push.decisions.length ? (
        <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4 }}>
          Decisions in force: {push.decisions.join(" · ")}
        </div>
      ) : null}
    </section>
  );
}

/** Layered layout for the orchestration graph: a unit's column is one past
 *  its deepest dependency, so edges always point left → right. */
function graphLayers(units: { id: string; requires: string[] }[]): Map<string, number> {
  const depth = new Map<string, number>();
  const byId = new Map(units.map((u) => [u.id, u]));
  const of = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const u = byId.get(id);
    const d = u && u.requires.length ? Math.max(...u.requires.map((r) => of(r, seen))) + 1 : 0;
    depth.set(id, d);
    return d;
  };
  for (const u of units) of(u.id, new Set());
  return depth;
}

const STATE_COLOR: Record<string, string> = {
  ready: "#8b949e", running: "#3fb950", parked: "#d29922", done: "#58a6ff", failed: "#f85149",
};

/** The orchestration graph: units as nodes (colored by live state), the
 *  DAG's requires edges left → right, a running node pulses; click for the
 *  unit's detail beneath. */
function RunGraph(props: {
  units: { id: string; slice: string; role: string; state: string; requires: string[] }[];
  selected: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const { units } = props;
  const layers = graphLayers(units);
  const cols = new Map<number, string[]>();
  for (const u of units) {
    const c = layers.get(u.id) ?? 0;
    if (!cols.has(c)) cols.set(c, []);
    cols.get(c)!.push(u.id);
  }
  const W = 150, H = 34, GX = 46, GY = 12;
  const pos = new Map<string, { x: number; y: number }>();
  for (const [c, ids] of cols) ids.forEach((id, i) => pos.set(id, { x: c * (W + GX), y: i * (H + GY) }));
  const width = (Math.max(...[...cols.keys()], 0) + 1) * (W + GX) - GX;
  const height = Math.max(...[...cols.values()].map((ids) => ids.length), 1) * (H + GY) - GY;
  return (
    <svg
      data-run-graph
      viewBox={`-4 -4 ${width + 8} ${height + 8}`}
      style={{ width: "100%", maxWidth: width + 8, height: "auto", margin: "6px 0" }}
    >
      <style>{`@keyframes tandemPulse { 0%,100% { opacity: 1 } 50% { opacity: 0.45 } }`}</style>
      {units.flatMap((u) =>
        u.requires.map((r) => {
          const a = pos.get(r), b = pos.get(u.id);
          if (!a || !b) return null;
          return (
            <line
              key={`${r}->${u.id}`}
              x1={a.x + W} y1={a.y + H / 2} x2={b.x} y2={b.y + H / 2}
              stroke="var(--vscode-panel-border, #555)" strokeWidth={1.2}
            />
          );
        }),
      )}
      {units.map((u) => {
        const p = pos.get(u.id)!;
        const color = STATE_COLOR[u.state] ?? "#8b949e";
        return (
          <g
            key={u.id}
            data-graph-node={u.id}
            transform={`translate(${p.x},${p.y})`}
            style={{ cursor: "pointer" }}
            onClick={() => props.onSelect(u.id)}
          >
            <rect
              width={W} height={H} rx={7}
              fill="var(--vscode-editorWidget-background, #1e1e1e)"
              stroke={color} strokeWidth={props.selected === u.id ? 2.5 : 1.5}
              style={u.state === "running" ? { animation: "tandemPulse 1.2s ease-in-out infinite" } : undefined}
            />
            <circle cx={12} cy={H / 2} r={4.5} fill={color} />
            <text x={22} y={H / 2 - 2} fontSize={9.5} fill="var(--vscode-foreground, #ccc)">
              {u.id.length > 20 ? u.id.slice(0, 19) + "…" : u.id}
            </text>
            <text x={22} y={H / 2 + 10} fontSize={8.5} fill="var(--vscode-descriptionForeground, #888)">
              {u.role} · {u.state}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function RunSection(props: { run: NonNullable<SpacePush["run"]> }): JSX.Element {
  const { run } = props;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string | null>(null);
  const pickedUnit = run.units.find((u) => u.id === picked);
  return (
    <section data-run-view style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong>The run</strong>
        <button
          data-stop-run
          title="Stop the run — aborts every live worker; the run drains and reports"
          style={{ marginLeft: "auto", background: "var(--vscode-statusBarItem-errorBackground, #c72e2e)", color: "#fff", border: "none", borderRadius: 4, padding: "2px 10px", cursor: "pointer" }}
          onClick={() => post({ action: "stop-run" })}
        >
          ■ Stop
        </button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <RunGraph units={run.units} selected={picked} onSelect={setPicked} />
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
          <div style={{ margin: "6px 0", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(() => {
              const cutUnits = push.units.filter((u) => u.inCut);
              return cutUnits.length >= 2 && unit.inCut ? (
                <button
                  data-pin-together
                  title="These units are one thing — pin them into one slice; the pin outranks the computed grouping"
                  onClick={() => {
                    for (let i = 1; i < cutUnits.length; i++)
                      post({ action: "pin", pinKind: "together", changeIds: [cutUnits[0].changeIds[0], cutUnits[i].changeIds[0]] });
                  }}
                >
                  Merge {cutUnits.length} into one slice
                </button>
              ) : null;
            })()}
            <button
              data-toggle-cut
              style={btn}
              onClick={() => post({ action: "toggle-cut", changeIds: unit.changeIds })}
            >
              {unit.inCut ? "Remove from cut" : "Add to cut"}
            </button>
          </div>
          {unit.nodes.map((n) => (
            <div key={n.id} style={{ padding: "4px 0" }}>
              <div>
                • {n.sentence}{" "}
                {unit.changeIds.length > 1 ? (
                  <button
                    data-pin-apart={n.id}
                    title="This change is not part of this unit — split it out; the pin outranks the computed grouping"
                    style={{ fontSize: 10, marginRight: 4 }}
                    onClick={() => {
                      const other = unit.changeIds.find((id) => id !== n.id);
                      if (other) post({ action: "pin", pinKind: "apart", changeIds: [n.id, other] });
                    }}
                  >
                    Split out
                  </button>
                ) : null}{" "}
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
                  {`lands at: ${n.touchpoints.join(", ") || "(not grounded)"}\nproven by: ${n.acceptance.join("; ") || "(nothing yet)"}`}
                </pre>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
      {push.asks.length ? (
        <section data-asks style={{ margin: "8px 12px" }}>
          <strong style={{ fontSize: 12 }}>You asked</strong>
          <ol style={{ margin: "4px 0 0 18px", padding: 0 }}>
            {push.asks.map((a) => (
              <li key={a.id} data-ask={a.id} style={{ fontSize: 12, opacity: 0.85 }}>
                {a.text}
              </li>
            ))}
          </ol>
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
      {push.questions.length ? <Questions push={push} /> : null}
      {push.run ? <RunSection run={push.run} /> : null}
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
