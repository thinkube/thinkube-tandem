/**
 * The Tandem space surface: capture at the top, the units map in the
 * middle, the two gates on the right. Renders exactly what the host
 * pushes; every abstract flips to its machine face with one gesture.
 */
import { useEffect, useMemo, useState } from "react";
import { DraftPush, onDraft, onSpace, post, SpacePush} from "./vscode";
import { RunNote, RunSection } from "./Run";
import { Delivery } from "./Delivery";
import { C, FS, O, SP } from "./type";
import { IntentGraph } from "./IntentGraph";
import { WorkGraph } from "./WorkGraph";
import { Rail } from "./Rail";
import { Asks } from "./Asks";
import { useWorld, ZoomControls } from "./proto/world";


export function App(): JSX.Element {
  const [push, setPush] = useState<SpacePush | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [classifying, setClassifying] = useState(false);
  const [tag, setTag] = useState<DraftPush | null>(null);
  const [panicArmed, setPanicArmed] = useState(false);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [tab, setTab] = useState<"intent" | "work" | "flow">("intent");
  // The orchestration page has two things to show and they are wanted at
  // different moments: the workers while they run, the report once they
  // have. Neither replaces the other, so the reader keeps the switch.
  const [shown, setShown] = useState<"workers" | "report" | null>(null);
  // Which ask has its editor open. It lives here because a subject, a
  // claim that reads wrong must be able to open the ask it came
  // from, and they are drawn on another surface.
  const [editingAsk, setEditingAsk] = useState<string | null>(null);
  const [workSubject, setWorkSubject] = useState<string | null>(null);
  const unitsWorld = useWorld();
  const flowWorld = useWorld();
  useEffect(() => {
    if (push?.running) setTab("flow");
  }, [push?.running]);
  // Until the reader says otherwise: the workers while they run, and the
  // report the moment there is one to read.
  const hasReport = !!push?.deliveries.length;
  const reportShown = shown === null ? hasReport && !push?.running : shown === "report";

  useEffect(() => onSpace(setPush), []);
  useEffect(
    () =>
      onDraft((d) => {
        setClassifying(false);
        setTag(d);
      }),
    [],
  );

  if (!push) return <div style={{ padding: 24, opacity: O.dim }}>Loading the space…</div>;
  const spinStyle = (
    <style>{`@keyframes tandemSpinKf { from { transform: rotate(0) } to { transform: rotate(360deg) } } .tandem-spin { animation: tandemSpinKf 1.1s linear infinite }`}</style>
  );
  if (push.needsRepo)
    return (
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
        <div style={{ opacity: O.dim }}>Which project are you working on?</div>
        <button
          data-choose-repo
          style={{ padding: `${SP.sm}px ${SP.lg}px`, borderRadius: 6, border: "1px solid var(--vscode-input-border, #444)", background: "var(--vscode-button-background, #0e639c)", color: "var(--vscode-button-foreground, #fff)", cursor: "pointer" }}
          onClick={() => post({ action: "switch-repo" })}
        >
          Choose project…
        </button>
        {push.message ? <div style={{ fontSize: FS.body, opacity: O.dim }}>{push.message}</div> : null}
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
            background: C.raised,
            border: `1px solid ${C.focus}`,
            borderRadius: 14,
            padding: `${SP.xs}px ${SP.lg}px`,
            fontSize: FS.body,
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
          padding: `${SP.sm}px ${SP.lg}px 0`,
          fontSize: FS.body,
        }}
      >
        <span style={{ opacity: O.dim }}>Asking in</span>
        <strong style={{ fontSize: FS.body }}>{push.repoName ?? "no project chosen"}</strong>
        <span style={{ opacity: O.faint }}>— its code is read; its repository receives the delivery</span>
        <button
          data-switch-repo
          title="Switch the repository this space works on."
          style={{ marginLeft: "auto", fontSize: FS.caption, background: "none", border: "1px solid var(--vscode-input-border, #444)", borderRadius: 4, cursor: "pointer", color: "inherit", padding: `1px ${SP.sm}px` }}
          onClick={() => post({ action: "switch-repo" })}
        >
          switch
        </button>
      </div>
      <div
        data-capture
        style={{
          display: tab === "intent" ? "flex" : "none",
          flexWrap: "wrap",
          gap: 8,
          padding: `${SP.sm}px ${SP.lg}px`,
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
            padding: `${SP.sm}px ${SP.md}px`,
            fontFamily: "inherit",
            fontSize: FS.body,
            background: "var(--vscode-input-background, #222)",
            color: "var(--vscode-input-foreground, #ddd)",
            border: "1px solid var(--vscode-input-border, #444)",
            borderRadius: 6,
          }}
        />
        {classifying ? (
          <span data-classifying style={{ fontSize: FS.body, opacity: O.dim }}>⟳ reading your words…</span>
        ) : null}
        {tag && !tag.items ? (
          <div data-tag-row style={{ flexBasis: "100%", display: "flex", gap: 6, alignItems: "center", fontSize: FS.body }}>
            <span style={{ opacity: O.dim }}>This looks like — press to record:</span>
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
                  padding: `${SP.xs}px ${SP.md}px`,
                  border: tag.guessed === t.k ? `2px solid ${C.focus}` : "1px solid var(--vscode-input-border, #444)",
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
                  title="Record each line as its own ask."
                  style={{ cursor: "pointer", borderRadius: 10, padding: `${SP.xs}px ${SP.md}px`, border: "1px solid var(--vscode-input-border, #444)", background: "var(--vscode-input-background, #222)", color: "inherit" }}
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
            <span style={{ opacity: O.faint }}>nothing is saved until you press one</span>
          </div>
        ) : null}
        {tag?.items ? (
          <div data-list-preview style={{ flexBasis: "100%", fontSize: FS.body }}>
            <div style={{ opacity: O.dim, marginBottom: 4 }}>
              That looks like a list — record {tag.items.length} separate asks?
            </div>
            <ol style={{ margin: "0 0 6px 18px", padding: 0 }}>
              {tag.items.map((it, i) => (
                <li key={i} style={{ opacity: O.dim }}>{it}</li>
              ))}
            </ol>
            <button
              data-record-list
              style={{ cursor: "pointer", borderRadius: 4, padding: `${SP.xs}px ${SP.md}px` }}
              onClick={() => {
                post({ action: "capture-many", items: tag.items! });
                setTag(null);
                setDraft("");
              }}
            >
              Record {tag.items.length} asks
            </button>
            <button
              style={{ marginLeft: 8, cursor: "pointer", background: "none", border: "none", color: "inherit", opacity: O.dim }}
              onClick={() => setTag(null)}
            >
              keep editing
            </button>
          </div>
        ) : null}
        {push.activity ? (
          <div data-activity style={{ flexBasis: "100%", display: "flex", gap: 8, alignItems: "center", fontSize: FS.body }}>
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
                  background: C.live,
                  transition: "width 300ms",
                }}
              />
            </span>
            <button
              data-cancel-capture
              style={{ cursor: "pointer", background: "none", border: "1px solid var(--vscode-input-border, #444)", borderRadius: 4, color: "inherit", fontSize: FS.caption }}
              onClick={() => post({ action: "cancel-capture" })}
            >
              Cancel
            </button>
          </div>
        ) : null}
                <span data-identity style={{ fontSize: FS.caption, opacity: O.dim, whiteSpace: "nowrap" }}>
          {push.subjects.length} subject(s) · {push.cutCount} in cut · {push.signedTeps} TEP(s)
        </span>
        {!push.running && push.signedTeps === 0 && (push.subjects.length > 0 || push.questions.length > 0) ? (
          panicArmed ? (
            <button
              data-panic-confirm
              style={{ fontSize: FS.caption, color: C.bad, background: "none", border: "1px solid #f85149", borderRadius: 4, cursor: "pointer" }}
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
              style={{ fontSize: FS.caption, opacity: O.dim, background: "none", border: "none", cursor: "pointer", color: "inherit" }}
              onClick={() => setPanicArmed(true)}
            >
              Panic
            </button>
          )
        ) : null}
        {push.running ? (
          <span style={{ fontSize: FS.body, color: C.ok }}>● building…</span>
        ) : null}
        {push.message ? (
          <span style={{ fontSize: FS.body, opacity: O.dim }}>{push.message}</span>
        ) : null}
      </div>
      {tab === "intent" ? (
        <Asks
          push={push}
          selected={selected}
          onSelect={setSelected}
          editing={editingAsk}
          onEditing={setEditingAsk}
        />
      ) : null}
      {push.lastAnswer ? (
        <section data-answer style={{ margin: `${SP.sm}px ${SP.lg}px 0`, padding: 8, border: "1px solid var(--vscode-panel-border, #333)", borderRadius: 6 }}>
          <div style={{ fontSize: FS.caption, opacity: O.dim }}>You asked: {push.lastAnswer.question}</div>
          <div style={{ fontSize: FS.body, whiteSpace: "pre-wrap", marginTop: 4 }}>{push.lastAnswer.answer}</div>
        </section>
      ) : null}
      {push.legacy ? (
        <div
          data-legacy
          style={{
            margin: `${SP.sm}px ${SP.md}px 0`,
            padding: `${SP.sm}px ${SP.md}px`,
            border: "1px solid #e5c07b",
            borderRadius: 5,
            fontSize: FS.body,
          }}
        >
          {push.legacy}
        </div>
      ) : null}
      <div data-tabs style={{ display: "flex", gap: 6, padding: `${SP.sm}px ${SP.md}px 0`, alignItems: "center" }}>
        {([
          ["intent", "1 · Intent", "what you want"],
          ["work", "2 · Work", "what gets built, and what proves it"],
          ["flow", "3 · Orchestration", "the workers, in the order they run, and what they proved"],
        ] as const).map(([id, label, why]) => (
          <button
            key={id}
            data-tab={id}
            title={
              id === "work" && push.cost.subjects > 0
                ? `Work out what to build — ${push.cost.subjects} subject(s), about ${push.cost.rounds} rounds.`
                : `Show ${why}.`
            }
            onClick={() => {
              setTab(id);
              // Going to look at the work is what starts the thinking —
              // and it is the only thing that starts it. Nothing runs
              // speculatively behind a reading nobody has read.
              if (id === "work" && push.cost.subjects > 0) post({ action: "think" });
            }}
            style={{
              background: C.raised,
              color: tab === id ? C.focus : "inherit",
              border: `1px solid ${tab === id ? C.focus : C.border}`,
              padding: `${SP.sm}px ${SP.lg}px`,
              borderRadius: 4,
              cursor: "pointer",
              fontSize: FS.body,
            }}
          >
            {label}
            {id === "flow" && push.running ? " ●" : ""}
          </button>
        ))}
        {tab === "flow" && hasReport ? (
          <div data-flow-view style={{ display: "flex", gap: 6, marginLeft: SP.lg }}>
            {([
              ["workers", "Workers", "The workers this run used, in the order they ran."],
              ["report", "Delivery report", "What the run made true, and the decision left."],
            ] as const).map(([id, text, why]) => (
              <button
                key={id}
                data-flow-view={id}
                title={why}
                onClick={() => setShown(id)}
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: `2px solid ${(id === "report") === reportShown ? C.focus : "transparent"}`,
                  color: (id === "report") === reportShown ? "inherit" : C.quiet,
                  padding: `2px ${SP.xs}px`,
                  cursor: "pointer",
                  fontSize: FS.body,
                }}
              >
                {text}
              </button>
            ))}
          </div>
        ) : null}
        <span style={{ marginLeft: "auto", color: C.quiet, fontSize: FS.body }}>
          say it · see what it will build · build it
        </span>
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0, position: "relative" }}>
        {tab === "intent" ? (
          <IntentGraph
            push={push}
            selected={selected}
            onSelect={setSelected}
            onWork={() => {
              setTab("work");
              if (push.cost.subjects > 0) post({ action: "think" });
            }}
            onEditAsk={(id) => {
              setSelected(id);
              setEditingAsk(id);
            }}
            onOpenWork={(id) => {
              setWorkSubject(id);
              setTab("work");
            }}
          />
        ) : tab === "work" ? (
          <WorkGraph
            push={push}
            onEditAsk={(id) => {
              setSelected(id);
              setEditingAsk(id);
              setTab("intent");
            }}
            world={unitsWorld}
            subjectId={workSubject}
            onSubject={setWorkSubject}
            selected={selected}
            onSelect={(id) => {
              setSelected(id);
              post({ action: "select-unit", unitId: id });
            }}
            onUp={(id) => {
              setSelected(id);
              setTab("intent");
            }}
          />
        ) : reportShown ? (
          <Delivery push={push} />
        ) : push.run || push.runNote ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            {push.runNote ? <RunNote note={push.runNote} /> : null}
            {push.run ? (
              <RunSection
                run={push.run}
                live={!!push.running}
                world={flowWorld}
                openLog={push.runLog?.step}
              />
            ) : null}
          </div>
        ) : (
          <div style={{ flex: 1, padding: 24, opacity: O.dim }}>
            Nothing has been orchestrated yet — press Build on the work page and the workers
            appear here as they run.
          </div>
        )}
        {/* Only where there is something to zoom. The intent page is a
            list of cards that scrolls; drawing zoom controls over it gave
            three buttons that did nothing at all. */}
        {tab === "work" ? (
          <ZoomControls world={unitsWorld} />
        ) : tab === "flow" && push.run && !reportShown ? (
          <ZoomControls world={flowWorld} />
        ) : null}
        <Rail push={push} canBuild={tab === "work"} />
      </div>
    </div>
  );
}
