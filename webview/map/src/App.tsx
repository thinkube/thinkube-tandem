/**
 * The Tandem space surface: capture at the top, the units map in the
 * middle, the two gates on the right. Renders exactly what the host
 * pushes; every abstract flips to its machine face with one gesture.
 */
import { useEffect, useMemo, useState } from "react";
import { DraftPush, onDraft, onSpace, post, SpacePush, UnitVM } from "./vscode";
import { RunSection } from "./Run";
import { UnitsMap } from "./UnitsMap";
import {
  createExpansionStore,
  expandableLabel,
  wrapBody,
} from "../../../src/surfaces/graphCore/expander";
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
  const [classifying, setClassifying] = useState(false);
  const [tag, setTag] = useState<DraftPush | null>(null);
  const [panicArmed, setPanicArmed] = useState(false);
  const expansion = useMemo(() => createExpansionStore(), []);
  const [, forceRender] = useState(0);
  useEffect(() => expansion.subscribe(() => forceRender((n) => n + 1)), [expansion]);

  useEffect(() => onSpace(setPush), []);
  useEffect(
    () =>
      onDraft((d) => {
        setClassifying(false);
        setTag(d);
      }),
    [],
  );

  if (!push) return <div style={{ padding: 24, opacity: 0.7 }}>Loading the space…</div>;
  const spinStyle = (
    <style>{`@keyframes tandemSpinKf { from { transform: rotate(0) } to { transform: rotate(360deg) } } .tandem-spin { animation: tandemSpinKf 1.1s linear infinite }`}</style>
  );
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
      {spinStyle}
      <div
        data-asking-in
        style={{
          display: "flex",
          gap: 8,
          alignItems: "baseline",
          padding: "6px 12px 0",
          fontSize: 12,
        }}
      >
        <span style={{ opacity: 0.7 }}>Asking in</span>
        <strong style={{ fontSize: 13 }}>{push.repoName ?? "no project chosen"}</strong>
        <span style={{ opacity: 0.5 }}>— its code is read; its repository receives the delivery</span>
        <button
          data-switch-repo
          title="Switch the project this space works on"
          style={{ marginLeft: "auto", fontSize: 11, background: "none", border: "1px solid var(--vscode-input-border, #444)", borderRadius: 4, cursor: "pointer", color: "inherit", padding: "1px 8px" }}
          onClick={() => post({ action: "switch-repo" })}
        >
          switch
        </button>
      </div>
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
          onChange={(e) => {
            setDraft(e.target.value);
            setTag(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && draft.trim() && !classifying) {
              e.preventDefault();
              setClassifying(true);
              post({ action: "classify", text: draft });
            }
          }}
          disabled={!!push.activity}
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
        {classifying ? (
          <span data-classifying style={{ fontSize: 12, opacity: 0.75 }}>⟳ reading your words…</span>
        ) : null}
        {tag && !tag.items ? (
          <div data-tag-row style={{ flexBasis: "100%", display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
            <span style={{ opacity: 0.7 }}>This looks like — press to record:</span>
            {[
              { k: "ask", label: "Ask (build it)" },
              { k: "question", label: "Question (just answer)" },
              { k: "statement", label: "Rule (build under it)" },
            ].map((t) => (
              <button
                key={t.k}
                data-tag={t.k}
                style={{
                  cursor: "pointer",
                  borderRadius: 10,
                  padding: "2px 10px",
                  border: tag.guessed === t.k ? "2px solid var(--vscode-focusBorder, #3794ff)" : "1px solid var(--vscode-input-border, #444)",
                  background: "var(--vscode-input-background, #222)",
                  color: "inherit",
                  fontWeight: tag.guessed === t.k ? 600 : 400,
                }}
                onClick={() => {
                  post({ action: "capture", text: tag.text, kind: t.k });
                  setTag(null);
                  setDraft("");
                }}
              >
                {tag.guessed === t.k ? "✓ " : ""}{t.label}
              </button>
            ))}
            <span style={{ opacity: 0.55 }}>nothing is saved until you press one</span>
          </div>
        ) : null}
        {tag?.items ? (
          <div data-list-preview style={{ flexBasis: "100%", fontSize: 12 }}>
            <div style={{ opacity: 0.8, marginBottom: 4 }}>
              That looks like a list — record {tag.items.length} separate asks?
            </div>
            <ol style={{ margin: "0 0 6px 18px", padding: 0 }}>
              {tag.items.map((it, i) => (
                <li key={i} style={{ opacity: 0.85 }}>{it}</li>
              ))}
            </ol>
            <button
              data-record-list
              style={{ cursor: "pointer", borderRadius: 4, padding: "2px 10px" }}
              onClick={() => {
                post({ action: "capture-many", items: tag.items! });
                setTag(null);
                setDraft("");
              }}
            >
              Record {tag.items.length} asks
            </button>
            <button
              style={{ marginLeft: 8, cursor: "pointer", background: "none", border: "none", color: "inherit", opacity: 0.7 }}
              onClick={() => setTag(null)}
            >
              keep editing
            </button>
          </div>
        ) : null}
        {push.activity ? (
          <div data-activity style={{ flexBasis: "100%", display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
            <span className="tandem-spin" style={{ display: "inline-block" }}>⟳</span>
            <span>
              {push.activity.label}… ({push.activity.current}/{push.activity.total})
            </span>
            <span style={{ flex: 1, height: 4, background: "var(--vscode-input-background, #222)", borderRadius: 2, overflow: "hidden" }}>
              <span
                style={{
                  display: "block",
                  height: "100%",
                  width: `${Math.round((push.activity.current / push.activity.total) * 100)}%`,
                  background: "var(--vscode-progressBar-background, #3794ff)",
                  transition: "width 300ms",
                }}
              />
            </span>
            <button
              data-cancel-capture
              style={{ cursor: "pointer", background: "none", border: "1px solid var(--vscode-input-border, #444)", borderRadius: 4, color: "inherit", fontSize: 11 }}
              onClick={() => post({ action: "cancel-capture" })}
            >
              Cancel
            </button>
          </div>
        ) : null}
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
          expansion={expansion}
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
      {(() => {
        const uncovered = push.units.filter((u) => u.coverage.covered < u.coverage.total);
        const staleUnits = push.units.filter((u) => u.stale);
        const chips: { key: string; label: string; color: string; unitId?: string }[] = [
          ...push.questions.map((q, i) => ({
            key: `q${i}`,
            label: `❓ ${q.text.length > 40 ? q.text.slice(0, 39) + "…" : q.text}`,
            color: "#d29922",
            unitId: push.units.find((u) =>
              u.nodes.some((n) => push.questions.some((x) => x.id === q.id)),
            )?.id,
          })),
          ...uncovered.map((u) => ({
            key: `c${u.id}`,
            label: `⚠ nothing proves: ${u.title.length > 32 ? u.title.slice(0, 31) + "…" : u.title}`,
            color: "#f59e0b",
            unitId: u.id,
          })),
          ...staleUnits.map((u) => ({
            key: `s${u.id}`,
            label: `stale: ${u.title.length > 32 ? u.title.slice(0, 31) + "…" : u.title}`,
            color: "#8b949e",
            unitId: u.id,
          })),
        ];
        return chips.length ? (
          <div data-next-actions style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "6px 12px 0", alignItems: "center" }}>
            <span style={{ fontSize: 11, opacity: 0.6 }}>needs you:</span>
            {chips.map((c) => (
              <button
                key={c.key}
                data-next-action={c.key}
                style={{ fontSize: 11, border: `1px solid ${c.color}`, color: c.color, background: "none", borderRadius: 10, padding: "1px 8px", cursor: c.unitId ? "pointer" : "default" }}
                onClick={() => c.unitId && setSelected(c.unitId)}
              >
                {c.label}
              </button>
            ))}
          </div>
        ) : null;
      })()}
      {push.asks.length ? (
        <section data-asks style={{ margin: "8px 12px" }}>
          <strong style={{ fontSize: 12 }}>You asked</strong>
          <ol style={{ margin: "4px 0 0 18px", padding: 0 }}>
            {push.asks.map((a) => (
              <li key={a.id} data-ask={a.id} style={{ fontSize: 12, opacity: 0.85 }}>
                {a.text}
                {push.activity?.askId === a.id ? (
                  <span style={{ marginLeft: 6, color: "var(--vscode-progressBar-background, #3794ff)" }}>
                    ⟳ {push.activity.label}… ({push.activity.current}/{push.activity.total})
                  </span>
                ) : null}
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
      {push.lastAnswer ? (
        <section data-answer style={{ margin: "8px 12px", padding: 8, border: "1px solid var(--vscode-panel-border, #333)", borderRadius: 6 }}>
          <div style={{ fontSize: 11, opacity: 0.6 }}>You asked: {push.lastAnswer.question}</div>
          <div style={{ fontSize: 13, whiteSpace: "pre-wrap", marginTop: 4 }}>{push.lastAnswer.answer}</div>
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
