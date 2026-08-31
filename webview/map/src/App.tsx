/**
 * The Tandem space surface: capture at the top, the units map in the
 * middle, the two gates on the right. Renders exactly what the host
 * pushes; every abstract flips to its machine face with one gesture.
 */
import { useEffect, useMemo, useState } from "react";
import { can, onSpace, post, refusalSentence, SpacePush, watchRefusals } from "./vscode";
import { RunNote, RunSection } from "./Run";
import { Implications } from "./Implications";
import { Compose } from "./Compose";
import { Analysis } from "./Analysis";
import { asksOfText } from "../../../src/derive/asks";
import { Delivery } from "./Delivery";
import { C, FS, O, SP } from "./type";
import { IntentGraph } from "./IntentGraph";
import { WorkGraph } from "./WorkGraph";
import { Rail } from "./Rail";
import { Asks } from "./Asks";
import { useWorld, ZoomControls } from "./proto/world";
import { nextView, ViewState } from "../../../src/surfaces/viewMove";
import { surfaceRegions } from "../../../src/surfaces/surfaceLayout";
import { ASKS_PAGE, drawsAskList, SurfacePage } from "../../../src/surfaces/surfaceContract";


/** Whether the Orchestration page is currently showing the delivery
 *  report rather than the workers. Read once, at the moment the reader
 *  opens the page, from whether a report exists at that instant — never
 *  recomputed while the reader stays on the page, so a delivery arriving
 *  mid-visit or `push.running` flipping cannot pull the page out from
 *  under them. `shown` is the flow view already settled on entry (or
 *  null before the page has ever been opened). */
function reportShown(push: SpacePush | null, shown: "workers" | "report" | null): boolean {
  if (shown !== null) return shown === "report";
  return !!push?.deliveries.length && !push?.running;
}

export function App(props: {
  /** A first push and page, for rendering the surface outside the host
   *  (the button table is checked this way on every build). `flowView`
   *  settles the orchestration page's switch the way a reader opening the
   *  page would, so the delivery report can be rendered and proved rather
   *  than only described. */
  initial?: { push: SpacePush; tab: SurfacePage; flowView?: "workers" | "report" };
} = {}): JSX.Element {
  const [push, setPush] = useState<SpacePush | null>(props.initial?.push ?? null);
  // The sentence for the last press the surface refused itself, if any —
  // read fresh from every push, since a new push means a new allowed list
  // and the sentence held for the press before it no longer applies.
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [panicArmed, setPanicArmed] = useState(false);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  // The one rule that decides which page is shown: a push from the host
  // never moves it (except to land a move the reader already asked for),
  // only a reader gesture does. Every tab/flow-view change in this file
  // goes through nextView().
  const [view, setView] = useState<ViewState>({
    tab: props.initial?.tab ?? "write",
    flowView: props.initial?.flowView ?? "workers",
    awaited: null,
  });
  const tab = view.tab;
  // Which ask has its editor open. It lives here because a subject, a
  // claim that reads wrong must be able to open the ask it came
  // from, and they are drawn on another surface.
  const [editingAsk, setEditingAsk] = useState<string | null>(null);
  const [workSubject, setWorkSubject] = useState<string | null>(null);
  const unitsWorld = useWorld();
  const flowWorld = useWorld();
  // Working out what to build, right now: a stage is running or subjects
  // are in flight. Not the same as having work left to think about, which
  // is what `cost` counts.
  const working = !!push?.activity || (push?.grounding?.length ?? 0) > 0;
  const allWorkedOut = !working && (push?.cost.subjects ?? 0) === 0;
  // A push never moves the page on its own — it only lands a move the
  // reader already asked for (reader-awaits-work), and only once the work
  // is worked out.
  useEffect(() => {
    setView((v) => nextView(v, { kind: "push", workedOut: allWorkedOut }));
  }, [allWorkedOut]);
  const hasReport = !!push?.deliveries.length;
  // The orchestration page has two things to show and they are wanted at
  // different moments: the workers while they run, the report once they
  // have. Neither replaces the other, so the reader keeps the switch —
  // set once, at the moment the reader opens the page (the reader-tab
  // event below), and only changed again by the reader's own flow-view
  // switch.
  const reportIsShown = reportShown(push, view.flowView);
  // The fixed top-to-bottom order of the surface's regions for this page —
  // "asking-in" and "tabs" always come first, at the same index, so the
  // tab row's place never depends on which page is showing.
  const regionOrder = surfaceRegions(tab);

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
  // A refused press puts its sentence in front of the person instead of
  // being swallowed. The next push clears it — noteAllowed (run for every
  // push, before this component re-renders) already dropped the held
  // sentence, so a fresh push means a clean message line.
  useEffect(() => watchRefusals(setRefusal), []);
  useEffect(() => {
    setRefusal(undefined);
  }, [push]);

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
          disabled={!can("switch-repo")}
          title={can("switch-repo") ? "Switch the repository this space works on." : refusalSentence("switch-repo", push.phase)}
          style={{ marginLeft: "auto", fontSize: FS.caption, background: "none", border: "1px solid var(--vscode-input-border, #444)", borderRadius: 4, cursor: "pointer", color: "inherit", padding: `1px ${SP.sm}px` }}
          onClick={() => post({ action: "switch-repo" })}
        >
          switch
        </button>
      </div>
      {regionOrder.map((region) => {
        if (region === "tabs") return (
      <div key="tabs" data-tabs style={{ display: "flex", gap: 6, padding: `${SP.sm}px ${SP.md}px 0`, alignItems: "center" }}>
        {([
          ["write", "0 · Write", "what you want, in your words"],
          ["intent", "1 · Intent", "what I understood"],
          ["work", "2 · Work", "what gets built, and what proves it"],
          ["flow", "3 · Orchestration", "the workers, in the order they run, and what they proved"],
        ] as const).map(([id, label, why]) => (
          <button
            key={id}
            data-tab={id}
            title={
              id === "work" && working
                ? `Still working out what to build${push.activity ? ` — ${push.activity.label} ${push.activity.current} of ${push.activity.total}` : ""}.`
                : `Show ${why}.`
            }
            // A tab only moves. What starts thinking is the page's own
            // button, and the phase says whether that button is on.
            onClick={() => setView((v) => nextView(v, { kind: "reader-tab", tab: id, hasReport }))}
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
                onClick={() => setView((v) => nextView(v, { kind: "reader-flow-view", view: id }))}
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: `2px solid ${(id === "report") === reportIsShown ? C.focus : "transparent"}`,
                  color: (id === "report") === reportIsShown ? "inherit" : C.quiet,
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
        );
        if (region === "capture") return (
      <div
        key="capture"
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
          busy={!!push.activity || push.phase === "running"}
          canRead={can("read-draft")}
          whyNotRead={refusalSentence("read-draft", push.phase)}
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
        {can("panic") && (push.subjects.length > 0 || push.questions.length > 0) ? (
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
        {refusal ? (
          <span data-refusal style={{ fontSize: FS.body, color: C.ask }}>{refusal}</span>
        ) : push.message ? (
          <span style={{ fontSize: FS.body, opacity: O.dim }}>{push.message}</span>
        ) : null}
      </div>
        );
        if (region === "asks") return drawsAskList(tab) ? (
          <Asks
            key="asks"
            push={push}
            selected={selected}
            onSelect={setSelected}
            editing={editingAsk}
            onEditing={setEditingAsk}
          />
        ) : null;
        if (region === "legacy") return (
          <span key="legacy">
            <Implications push={push} />
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
          </span>
        );
        return null;
      })}
      <div style={{ display: "flex", flex: 1, minHeight: 0, position: "relative" }}>
        {tab === "write" ? (
          <div data-write-page style={{ flex: 1, overflowY: "auto", padding: `0 ${SP.lg}px ${SP.xl}px` }}>
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
                  setView((v) => nextView(v, { kind: "reader-tab", tab: "intent", hasReport }));
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
          <div data-intent-page style={{ display: "flex", flex: 1, minHeight: 0 }}>
            <IntentGraph
              push={push}
              selected={selected}
              onSelect={setSelected}
              onWork={() => {
                if (allWorkedOut) {
                  setView((v) => nextView(v, { kind: "reader-tab", tab: "work", hasReport }));
                  return;
                }
                setView((v) => nextView(v, { kind: "reader-awaits-work" }));
                post({ action: "think" });
              }}
              working={working}
              canWork={allWorkedOut || can("think")}
              onEditAsk={(id) => {
                setSelected(id);
                setEditingAsk(id);
              }}
              onOpenWork={(id) => {
                setWorkSubject(id);
                setView((v) => nextView(v, { kind: "reader-tab", tab: "work", hasReport }));
              }}
            />
          </div>
        ) : tab === "work" ? (
          <div data-work-page style={{ display: "flex", flex: 1, minHeight: 0 }}>
            <WorkGraph
              push={push}
              onEditAsk={(id) => {
                setSelected(id);
                setEditingAsk(id);
                setView((v) => nextView(v, { kind: "reader-tab", tab: ASKS_PAGE, hasReport }));
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
                setView((v) => nextView(v, { kind: "reader-tab", tab: "intent", hasReport }));
              }}
              // The signed-idle link promises the run page's notice, so it
              // lands on the workers view and never on a past delivery's
              // report: a link that shows something other than what it names
              // is a link the reader stops trusting.
              onGoToRun={() =>
                setView((v) => nextView(v, { kind: "reader-tab", tab: "flow", hasReport: false }))
              }
            />
          </div>
        ) : (
          <div data-flow-page style={{ display: "flex", flex: 1, minHeight: 0 }}>
            {reportIsShown ? (
              <Delivery push={push} />
            ) : push.run || push.runNote ? (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                {/* The way back in rides signed-undelivered work itself, not the
                    note from a refusal — the note dies with the window, and a
                    refused run leaves a record whose page would otherwise show
                    an empty graph with the only restart button unreachable. The
                    notice — heading, sentence, and which ways back in ride with
                    it — comes from the push; this page never words it again. */}
                {push.signedIdle ? <RunNote notice={push.signedIdle} phase={push.phase} /> : null}
                {push.run ? (
                  <RunSection
                    run={push.run}
                    live={!!push.running}
                    world={flowWorld}
                    openLog={push.runLog?.step}
                    phase={push.phase}
                  />
                ) : null}
              </div>
            ) : (
              <div style={{ flex: 1, padding: SP.xl }}>
                {push.signedIdle ? (
                  <RunNote notice={push.signedIdle} phase={push.phase} />
                ) : (
                  <span style={{ opacity: O.dim }}>
                    Nothing has been orchestrated yet — press Build on the work page and the workers
                    appear here as they run.
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        {/* Only where there is something to zoom. The intent page is a
            list of cards that scrolls; drawing zoom controls over it gave
            three buttons that did nothing at all. */}
        {tab === "work" ? (
          <ZoomControls world={unitsWorld} />
        ) : tab === "flow" && push.run && !reportIsShown ? (
          <ZoomControls world={flowWorld} />
        ) : null}
        {regionOrder.includes("rail") ? <Rail push={push} canBuild={tab === "work"} /> : null}
      </div>
    </div>
  );
}
