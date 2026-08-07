/**
 * The Tandem space surface: capture at the top, the units map in the
 * middle, the two gates on the right. Renders exactly what the host
 * pushes; every abstract flips to its machine face with one gesture.
 */
import { useEffect, useMemo, useState } from "react";
import { DraftPush, onDraft, onSpace, post, SpacePush, UnitVM } from "./vscode";
import { RunNote, RunSection } from "./Run";
import { UnitsMap } from "./UnitsMap";
import { Rail } from "./Rail";
import { useWorld, ZoomControls } from "./proto/world";


export function App(): JSX.Element {
  const [push, setPush] = useState<SpacePush | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const [classifying, setClassifying] = useState(false);
  const [tag, setTag] = useState<DraftPush | null>(null);
  const [panicArmed, setPanicArmed] = useState(false);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [tab, setTab] = useState<"units" | "flow">("units");
  const unitsWorld = useWorld();
  const flowWorld = useWorld();
  useEffect(() => {
    if (push?.running) setTab("flow");
  }, [push?.running]);

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
      {push.activity && !push.grounding?.length ? (
        <div
          data-thinking
          style={{
            position: "fixed",
            top: 8,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 50,
            display: "flex",
            gap: 8,
            alignItems: "center",
            background: "var(--vscode-editorWidget-background, #252526)",
            border: "1px solid var(--vscode-focusBorder, #3794ff)",
            borderRadius: 14,
            padding: "4px 14px",
            fontSize: 12,
            boxShadow: "0 2px 8px #0008",
          }}
        >
          <span className="tandem-spin" style={{ display: "inline-block" }}>⟳</span>
          <span>
            The machine is {push.activity.label}… ({push.activity.current}/{push.activity.total})
          </span>
        </div>
      ) : null}
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
            {(() => {
              const lines = tag.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
              if (lines.length < 2) return null;
              return (
                <button
                  data-tag-lines
                  title="Your paste has several lines — record each line as its own ask."
                  style={{ cursor: "pointer", borderRadius: 10, padding: "2px 10px", border: "1px solid var(--vscode-input-border, #444)", background: "var(--vscode-input-background, #222)", color: "inherit" }}
                  onClick={() => {
                    post({ action: "capture-many", items: lines });
                    setTag(null);
                    setDraft("");
                  }}
                >
                  {lines.length} asks — one per line
                </button>
              );
            })()}
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
      {push.asks.length ? (
        <section data-asks style={{ margin: "6px 12px 0" }}>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {push.asks.map((a) => (
              <li key={a.id} data-ask={a.id} style={{ fontSize: 12, opacity: 0.85 }}>
                {a.text}
                {(() => {
                  const g = push.grounding?.find((x) => x.askId === a.id);
                  if (!g) return null;
                  if (g.label === "waiting")
                    return (
                      <span data-ask-progress={a.id} style={{ marginLeft: 6, opacity: 0.55 }}>waiting…</span>
                    );
                  return (
                    <span data-ask-progress={a.id} style={{ marginLeft: 6, color: "var(--vscode-progressBar-background, #3794ff)" }}>
                      <span className="tandem-spin" style={{ display: "inline-block" }}>⟳</span> {g.label}… ({g.current}/{g.total})
                      <span style={{ display: "inline-block", width: 60, height: 4, background: "#3c3c3c", borderRadius: 2, marginLeft: 6, verticalAlign: "middle" }}>
                        <span style={{ display: "block", width: `${Math.round((g.current / Math.max(1, g.total)) * 100)}%`, height: 4, background: "var(--vscode-progressBar-background, #3794ff)", borderRadius: 2 }} />
                      </span>
                    </span>
                  );
                })()}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {push.lastAnswer ? (
        <section data-answer style={{ margin: "6px 12px 0", padding: 8, border: "1px solid var(--vscode-panel-border, #333)", borderRadius: 6 }}>
          <div style={{ fontSize: 11, opacity: 0.6 }}>You asked: {push.lastAnswer.question}</div>
          <div style={{ fontSize: 13, whiteSpace: "pre-wrap", marginTop: 4 }}>{push.lastAnswer.answer}</div>
        </section>
      ) : null}
      <div data-tabs style={{ display: "flex", gap: 6, padding: "8px 10px 0", alignItems: "center" }}>
        <button
          data-tab-units
          onClick={() => setTab("units")}
          style={{
            background: "var(--vscode-editorWidget-background, #252526)",
            color: tab === "units" ? "var(--vscode-textLink-foreground, #3794ff)" : "inherit",
            border: `1px solid ${tab === "units" ? "var(--vscode-focusBorder, #3794ff)" : "var(--vscode-panel-border, #3c3c3c)"}`,
            padding: "5px 12px",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Units map
        </button>
        <button
          data-tab-flow
          onClick={() => setTab("flow")}
          style={{
            background: "var(--vscode-editorWidget-background, #252526)",
            color: tab === "flow" ? "var(--vscode-textLink-foreground, #3794ff)" : "inherit",
            border: `1px solid ${tab === "flow" ? "var(--vscode-focusBorder, #3794ff)" : "var(--vscode-panel-border, #3c3c3c)"}`,
            padding: "5px 12px",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Orchestration flow{push.running ? " ●" : ""}
        </button>
        <span style={{ marginLeft: "auto", color: "var(--vscode-descriptionForeground, #9d9d9d)", fontSize: 12 }}>
          drag to move · scroll to zoom · cards always show everything · zoomed far out, only titles
        </span>
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0, position: "relative" }}>
        {tab === "units" ? (
          <UnitsMap
            push={push}
            world={unitsWorld}
            expandedIds={expandedIds}
            onToggle={(id) =>
              setExpandedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
            }
            selected={selected}
            onSelect={(id) => {
              setSelected(id);
              post({ action: "select-unit", unitId: id });
            }}
          />
        ) : push.run || push.runNote ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            {push.runNote ? <RunNote note={push.runNote} /> : null}
            {push.run ? <RunSection run={push.run} world={flowWorld} /> : null}
          </div>
        ) : (
          <div style={{ flex: 1, padding: 24, opacity: 0.7 }}>
            No build yet — sign a cut on the Units map and it appears here.
          </div>
        )}
        <ZoomControls world={tab === "units" ? unitsWorld : flowWorld} />
        <Rail
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
