/**
 * The Tandem space surface. A strip across the top always says where the
 * space is and holds the one thing to press next; under it, the page for
 * the state the space is in. Nothing is navigated: the page follows the
 * state, and the earlier screens stay reachable as quiet links, to look
 * at. Renders exactly what the host pushes.
 */
import { useEffect, useState } from "react";
import { can, onSpace, post, refusalSentence, SpacePush, watchRefusals } from "./vscode";
import { RunNote, RunSection } from "./Run";
import { Implications } from "./Implications";
import { Compose } from "./Compose";
import { Analysis } from "./Analysis";
import { asksOfText } from "../../../src/derive/asks";
import { Delivery } from "./Delivery";
import { C, FS, O, SP } from "./type";
import { IntentGraph } from "./IntentGraph";
import { Wills } from "./Wills";
import { Rail } from "./Rail";
import { useWorld, ZoomControls } from "./proto/world";
import { surfaceRegions } from "../../../src/surfaces/surfaceLayout";
import type { SurfacePage } from "../../../src/surfaces/surfaceLayout";
import { nextAction, NextAction } from "../../../src/surfaces/nextAction";
import { flowViewFor, pageFor } from "../../../src/surfaces/pageFor";

/** The earlier screens a person may look back at, by the state's own words. */
const LOOK_BACK: { page: SurfacePage; word: string; there: (push: SpacePush) => boolean }[] = [
  { page: "write", word: "the box", there: (p) => p.sentences.length > 0 },
  { page: "intent", word: "your sentences", there: (p) => p.sentences.length > 0 },
  { page: "work", word: "what it will do", there: (p) => p.subjects.some((s) => s.claims.some((c) => c.promises.length)) },
  { page: "flow", word: "the run", there: (p) => !!p.run || p.deliveries.length > 0 },
];

export function App(props: {
  /** A first push and page, for rendering the surface outside the host. */
  initial?: { push: SpacePush; tab?: SurfacePage; flowView?: "workers" | "report" };
} = {}): JSX.Element {
  const [push, setPush] = useState<SpacePush | null>(props.initial?.push ?? null);
  // The sentence for the last press the surface refused itself, if any —
  // read fresh from every push, since a new push means a new allowed list
  // and the sentence held for the press before it no longer applies.
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  // A press was sent and no push has answered yet. The strip says so at
  // once: a press that changes nothing on screen for a second reads as a
  // press that did nothing.
  const [pressed, setPressed] = useState<string | null>(null);
  // Looking back at an earlier screen. It lasts until the state moves.
  const [lookingAt, setLookingAt] = useState<SurfacePage | null>(props.initial?.tab ?? null);
  // Which ask has its editor open.
  const [editingAsk, setEditingAsk] = useState<string | null>(null);
  const flowWorld = useWorld();
  const working = !!push?.activity || (push?.grounding?.length ?? 0) > 0;

  const auto: SurfacePage = push ? pageFor(push) : "write";
  useEffect(() => {
    setLookingAt(null);
  }, [auto]);
  const tab: SurfacePage = lookingAt ?? auto;
  const regionOrder = surfaceRegions(tab);

  // The reading is behind the words when it was read from other text.
  const written = asksOfText(push?.draft ?? "").map((a) => a.text);
  const read = push?.pendingModel?.fresh ?? [];
  const behind =
    !!push?.pendingModel &&
    (written.length !== read.length || written.some((t, i) => t !== read[i]));
  // Reading is over when a reading comes back — or a failure does.
  const readAt =
    (push?.pendingModel?.texts ?? []).join(" ") + (push?.modelFailure?.reason ?? "");
  useEffect(() => {
    setClassifying(false);
  }, [readAt]);
  useEffect(() => onSpace(setPush), []);
  useEffect(() => watchRefusals(setRefusal), []);
  useEffect(() => {
    setRefusal(undefined);
    setPressed(null);
  }, [push]);

  if (!push) return <div style={{ padding: 24, opacity: O.dim }}>Loading the space…</div>;
  const next: NextAction = nextAction(push, { behind, allowed: can });
  const press = (n: NextAction): void => {
    if (n.move.kind !== "post") return;
    if (n.move.action.action === "read-draft") setClassifying(true);
    setPressed(n.label);
    setLookingAt(null);
    post(n.move.action);
  };
  const moving = next.busy || (pressed !== null && !refusal);
  const reportIsShown = flowViewFor(push) === "report";
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
  const back = LOOK_BACK.filter((l) => l.page !== tab && l.there(push));
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
      {/* The strip: where you are, and the one thing to press. Always here,
          whatever the state, so the answer to "what do I press" never
          depends on finding the right page first. */}
      <div
        data-asking-in
        data-strip
        style={{
          display: "flex",
          gap: SP.lg,
          alignItems: "center",
          flexWrap: "wrap",
          padding: `${SP.md}px ${SP.lg}px`,
          fontSize: FS.body,
          background: C.raised,
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <span data-where style={{ fontWeight: 600 }}>
          {push.repoName ?? "no project chosen"}
          <span style={{ fontWeight: 400, color: C.quiet }}>
            {" — "}
            {moving ? <span className="tandem-spin" style={{ display: "inline-block", marginRight: 4 }}>⟳</span> : null}
            {pressed && !next.busy ? `${pressed} — starting…` : next.where}
          </span>
        </span>
        {(() => {
          const here = (push.specs ?? []).find((sp) => sp.chosen);
          return here ? (
            <span data-set-in-hand style={{ fontSize: FS.caption, color: C.quiet }}>
              in hand: {here.name}
            </span>
          ) : null;
        })()}
        <button
          data-switch-repo
          disabled={!can("switch-repo")}
          title={can("switch-repo") ? "Switch the repository this space works on." : refusalSentence("switch-repo", push.phase)}
          style={{ fontSize: FS.caption, background: "none", border: `1px solid ${C.border}`, borderRadius: 4, cursor: "pointer", color: C.quiet, padding: `1px ${SP.sm}px` }}
          onClick={() => post({ action: "switch-repo" })}
        >
          switch
        </button>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: SP.md }}>
          <span data-next-hint style={{ fontSize: FS.caption, color: C.quiet }}>{next.hint}</span>
          {/* One press, once. The run draws its own Stop beside the
              progress it stops; repeating it here put two Stops on the
              same screen, in two colours, for one act. The strip still
              says where you are, and it keeps the press whenever that
              view is not the one being read. */}
          {next.move?.kind === "post" && next.move.action.action === "stop-run" && tab === "flow" && push.run ? null : (
          <button
            data-next
            data-busy={moving ? "1" : undefined}
            disabled={!next.enabled || moving}
            title={next.hint}
            onClick={() => press(next)}
            style={{
              fontSize: FS.body,
              fontWeight: 600,
              padding: `${SP.sm}px ${SP.lg}px`,
              borderRadius: 6,
              border: "1px solid var(--vscode-button-background, #0e639c)",
              background: "var(--vscode-button-background, #0e639c)",
              color: "var(--vscode-button-foreground, #fff)",
              cursor: next.enabled ? "pointer" : "default",
              opacity: next.enabled ? 1 : 0.45,
            }}
          >
            {moving && !next.busy ? "Starting…" : next.label}
          </button>
          )}
        </span>
      </div>
      {regionOrder.map((region) => {
        if (region === "notice") return (
      <div key="notice" data-notice style={{ display: "flex", gap: SP.md, alignItems: "baseline", padding: `${SP.xs}px ${SP.lg}px`, fontSize: FS.caption, minHeight: 22 }}>
        {/* Looking back: the earlier screens, by name, to read. The state's
            own page comes back on its own when the state moves. */}
        {lookingAt ? (
          <span data-looking-back style={{ color: C.quiet }}>
            looking back ·{" "}
            <button data-go={auto} onClick={() => setLookingAt(null)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: C.focus, fontSize: FS.caption }}>
              back to now
            </button>
          </span>
        ) : null}
        {back.map((l) => (
          <button
            key={l.page}
            data-go={l.page}
            onClick={() => setLookingAt(l.page)}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: C.quiet, fontSize: FS.caption, textDecoration: "underline dotted" }}
          >
            {l.word}
          </button>
        ))}
        {/* A refused press says why, on whatever page you pressed it. */}
        {refusal ? (
          <span data-refusal style={{ marginLeft: "auto", fontSize: FS.body, color: C.ask }}>{refusal}</span>
        ) : push.message ? (
          <span style={{ marginLeft: "auto", color: C.quiet }}>{push.message}</span>
        ) : null}
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
        {push.running ? (
          <span style={{ fontSize: FS.body, color: C.ok }}>● building…</span>
        ) : null}
      </div>
        );
        if (region === "asks") return null;
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
            {push.pendingModel ? <Analysis model={push.pendingModel} behind={behind} /> : null}
          </div>
        ) : tab === "intent" ? (
          <div data-intent-page style={{ display: "flex", flex: 1, minHeight: 0 }}>
            <IntentGraph
              push={push}
              selected={selected}
              onSelect={setSelected}
              editing={editingAsk}
              onEditing={setEditingAsk}
              working={working}
            />
          </div>
        ) : tab === "work" ? (
          <div data-work-page style={{ display: "flex", flex: 1, minHeight: 0 }}>
            <Wills
              push={push}
              selected={selected}
              onSelect={(id) => {
                setSelected(id);
                post({ action: "select-unit", unitId: id });
              }}
              onGoToRun={() => setLookingAt("flow")}
            />
          </div>
        ) : (
          <div data-flow-page style={{ display: "flex", flex: 1, minHeight: 0 }}>
            {reportIsShown ? (
              <Delivery push={push} onGoToWork={() => setLookingAt("work")} />
            ) : push.run || push.runNote ? (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
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
                    Nothing has run yet — press Build in the strip and the workers appear here as they run.
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        {tab === "flow" && push.run && !reportIsShown ? <ZoomControls world={flowWorld} /> : null}
        {regionOrder.includes("rail") ? <Rail push={push} canBuild={false} /> : null}
      </div>
    </div>
  );
}
