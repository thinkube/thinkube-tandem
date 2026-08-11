/**
 * The Tandem space surface: capture at the top, the units map in the
 * middle, the two gates on the right. Renders exactly what the host
 * pushes; every abstract flips to its machine face with one gesture.
 */
import { useEffect, useMemo, useState } from "react";
import { onSpace, post, SpacePush } from "./vscode";
import { RunNote, RunSection } from "./Run";
import { Compose } from "./Compose";
import { Analysis } from "./Analysis";
import { asksOfText } from "../../../src/derive/asks";
import { Delivery } from "./Delivery";
import { C, FS, label, O, SP } from "./type";
import { IntentGraph } from "./IntentGraph";
import { WorkGraph } from "./WorkGraph";
import { Rail } from "./Rail";
import { Asks } from "./Asks";
import { useWorld, ZoomControls } from "./proto/world";


export function App(): JSX.Element {
  const [push, setPush] = useState<SpacePush | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [panicArmed, setPanicArmed] = useState(false);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [tab, setTab] = useState<"write" | "intent" | "work" | "flow">("write");
  // The orchestration page has two things to show and they are wanted at
  // different moments: the workers while they run, the report once they
  // have. Neither replaces the other, so the reader keeps the switch.
  const [shown, setShown] = useState<"workers" | "report" | null>(null);
  // Which ask has its editor open. It lives here because a subject, a
  // claim that reads wrong must be able to open the ask it came
  // from, and they are drawn on another surface.
  const [editingAsk, setEditingAsk] = useState<string | null>(null);
  const [workSubject, setWorkSubject] = useState<string | null>(null);
  // Set when the reader asked to see the work. The move waits for the
  // thinking to finish: a page drawn while its promises are still being
  // worked out is a skeleton of empty frames that looks finished and is
  // not, and no amount of labelling makes a half-drawn page worth
  // arriving at.
  const [goingToWork, setGoingToWork] = useState(false);
  const unitsWorld = useWorld();
  const flowWorld = useWorld();
  useEffect(() => {
    if (push?.running) setTab("flow");
  }, [push?.running]);
  // Working out what to build, right now: a stage is running or subjects
  // are in flight. Not the same as having work left to think about, which
  // is what `cost` counts.
  const working = !!push?.activity || (push?.grounding?.length ?? 0) > 0;
  const allWorkedOut = !working && (push?.cost.subjects ?? 0) === 0;
  useEffect(() => {
    if (goingToWork && allWorkedOut) {
      setGoingToWork(false);
      setTab("work");
    }
  }, [goingToWork, allWorkedOut]);
  // Until the reader says otherwise: the workers while they run, and the
  // report the moment there is one to read.
  const hasReport = !!push?.deliveries.length;
  const reportShown = shown === null ? hasReport && !push?.running : shown === "report";

  // The box empties when the words are safely recorded, and not before:
  // a send that comes back as a list preview keeps them, so "keep editing"
  // has something to edit.
  // The reading is behind the words when it was read from other text.
  const written = asksOfText(push?.draft ?? "").map((a) => a.text);
  const read = push?.pendingModel?.fresh ?? [];
  const behind =
    !!push?.pendingModel &&
    (written.length !== read.length || written.some((t, i) => t !== read[i]));
  // Reading is over when a reading comes back — or a failure does.
  const readAt =
    (push?.pendingModel?.texts ?? []).join("\u0000") + (push?.modelFailure?.reason ?? "");
  useEffect(() => {
    setClassifying(false);
  }, [readAt]);
  useEffect(() => onSpace(setPush), []);

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
          display: tab === "write" ? "flex" : "none",
          flexWrap: "wrap",
          gap: 8,
          padding: `${SP.sm}px ${SP.lg}px`,
          borderBottom: "1px solid var(--vscode-panel-border, #333)",
          alignItems: "center",
        }}
      >
        <Compose
          busy={!!push.activity}
          initial={push.draft}
          onChange={(text) => post({ action: "save-draft", text })}
          onRead={() => {
            setClassifying(true);
            post({ action: "read-draft" });
          }}
        />
        {classifying ? (
          <span data-classifying style={{ fontSize: FS.body, opacity: O.dim }}>
            ⟳ reading what you wrote…
          </span>
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
          ["write", "0 · Write", "what you want, in your words"],
          ["intent", "1 · Intent", "what I understood"],
          ["work", "2 · Work", "what gets built, and what proves it"],
          ["flow", "3 · Orchestration", "the workers, in the order they run, and what they proved"],
        ] as const).map(([id, label, why]) => (
          <button
            key={id}
            data-tab={id}
            disabled={id === "work" && working}
            title={
              id === "work" && working
                ? `Still working out what to build${push.activity ? ` — ${push.activity.label} ${push.activity.current} of ${push.activity.total}` : ""}. This page opens when it is finished.`
                : id === "work" && push.cost.subjects > 0
                  ? `Work out what to build — ${push.cost.subjects} subject(s), about ${push.cost.rounds} rounds.`
                  : `Show ${why}.`
            }
            onClick={() => {
              // Going to look at the work is what starts the thinking —
              // and it is the only thing that starts it. Nothing runs
              // speculatively behind a reading nobody has read. The move
              // itself waits until there is a finished page to move to.
              if (id === "work" && !allWorkedOut) {
                setGoingToWork(true);
                post({ action: "think" });
                return;
              }
              setTab(id);
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
            {id === "work" && working ? " ⟳" : ""}
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
          write it · see what it means · see what it will build · build it
        </span>
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0, position: "relative" }}>
        {tab === "write" ? (
          <div data-write-page style={{ flex: 1, overflowY: "auto", padding: `0 ${SP.lg}px ${SP.xl}px` }}>
            {/* What is already recorded, above the empty box. Without it
                this page reads as an empty space with nothing in it, and
                the natural move is to write the same asks again. */}
            {push.sentences.length ? (
              <div data-already-recorded style={{ marginTop: SP.md, maxWidth: "56rem" }}>
                <div style={label}>
                  {push.sentences.length} ask{push.sentences.length === 1 ? "" : "s"} already
                  recorded
                </div>
                {push.sentences.map((a, i) => (
                  <div
                    key={a.id}
                    data-recorded-ask={a.id}
                    style={{
                      fontSize: FS.body,
                      padding: `${SP.xs}px ${SP.md}px`,
                      borderLeft: `3px solid ${C.border}`,
                      marginBottom: 2,
                      color: C.quiet,
                    }}
                  >
                    <span style={{ marginRight: SP.sm }}>#{i + 1}</span>
                    {a.text}
                  </div>
                ))}
                <div style={{ fontSize: FS.caption, color: C.quiet, marginTop: SP.xs }}>
                  Kept word for word. To change one, open it on 1 · Intent — writing it again here
                  records a second copy of the same ask, and is refused.
                </div>
              </div>
            ) : null}

            {push.pendingModel ? (
              <Analysis
                model={push.pendingModel}
                behind={behind}
                onRead={() => {
                  setClassifying(true);
                  post({ action: "read-draft" });
                }}
                onKeep={() => {
                  post({ action: "keep-draft" });
                  setTab("intent");
                }}
              />
            ) : (
              <div style={{ fontSize: FS.caption, color: C.quiet, marginTop: SP.lg }}>
                Nothing read yet. Write what you want above — one ask per line — and press Read.
                It costs one round and records nothing.
              </div>
            )}
          </div>
        ) : tab === "intent" ? (
          <IntentGraph
            push={push}
            selected={selected}
            onSelect={setSelected}
            onWork={() => {
              if (allWorkedOut) {
                setTab("work");
                return;
              }
              setGoingToWork(true);
              post({ action: "think" });
            }}
            working={working}
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
            {push.runNote ? <RunNote note={push.runNote} unrun={push.unrun} /> : null}
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
          <div style={{ flex: 1, padding: SP.xl }}>
            {push.unrun ? (
              <RunNote
                note="This work is signed and has not run. Nothing was delivered from it."
                unrun={push.unrun}
              />
            ) : (
              <span style={{ opacity: O.dim }}>
                Nothing has been orchestrated yet — press Build on the work page and the workers
                appear here as they run.
              </span>
            )}
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
