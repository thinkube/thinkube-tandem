/**
 * The orchestration flow view — the APPROVED PROTOTYPE's second tab: the
 * SAME HTML node cards laid out by ELK (layered, RIGHT, orthogonal
 * ELK-routed edges), run-state chips (pulsing `running`), elapsed time in
 * the chip, the log panel ANCHORED under the running node, a parked
 * worker's answer box inside its own card, Stop and a determinate
 * progress header above the canvas.
 */
import { useEffect, useMemo, useState } from "react";
import { post, SpacePush } from "./vscode";
import { World } from "./proto/world";
import { CardData, Chip, NodeCard, NODE_W, useMeasuredHeights } from "./proto/nodeCard";
import { edgePath, layoutLayered, LaidOut, stackLayout } from "./proto/elkRun";
import { C, FS, O, ROLES, SP } from "./type";


type RunUnits = NonNullable<SpacePush["run"]>["units"];

/** `3m 12s` — elapsed, humanly. */
function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function chipFor(u: RunUnits[number], now: number): Chip {
  const elapsed =
    u.startedAt && (u.state === "running" || u.state === "parked")
      ? ` · ${formatElapsed(now - u.startedAt)}`
      : "";
  switch (u.state) {
    case "running":
      return { text: `running${elapsed}`, kind: "run" };
    case "parked":
      return { text: `needs you${elapsed}`, kind: "q" };
    case "done":
      return { text: "passed", kind: "pass" };
    case "failed":
      return { text: "failed", kind: "na" };
    case "blocked":
      return {
        text: "never ran",
        kind: "plain",
        why: "The run stopped, or something this waits on failed, so this was never dispatched. It is not a failure.",
      };
    default:
      return { text: "pending", kind: "plain" };
  }
}

/** The step's own log, advertised on its card — a door, not a secret. */
function logChip(id: string, run: NonNullable<SpacePush["run"]>): Chip {
  const n = run.logCounts?.[id] ?? 0;
  return n
    ? { text: `${n} log lines`, kind: "plain", why: "Click this card to read this step's own log in the panel." }
    : { text: "no log yet", kind: "plain", why: "This step has not written anything yet." };
}

export function RunNote(props: { note: string; unrun?: { id: string; tepId?: string } }): JSX.Element {
  return (
    <div data-run-note style={{ margin: SP.xl, padding: SP.lg, border: `1px solid ${C.bad}`, borderRadius: 6, maxWidth: 560 }}>
      <strong>The build did not start.</strong>
      <div style={{ marginTop: SP.sm, whiteSpace: "pre-wrap" }}>{props.note}</div>
      {/* Signing happens once, so a run that refused itself would leave the
          work sealed and unreachable — the button that starts it is already
          spent. This is the way back in. */}
      {props.unrun ? (
        <div style={{ marginTop: SP.md, display: "flex", gap: SP.md, alignItems: "center", flexWrap: "wrap" }}>
          <button
            data-rerun
            style={{ fontWeight: 600 }}
            title="Start the signed work again. Nothing is signed twice and nothing you wrote changes."
            onClick={() => post({ action: "rerun" })}
          >
            Run {props.unrun.tepId ?? "it"} again
          </button>
          <span style={{ fontSize: FS.caption, color: C.quiet }}>
            already signed — this starts the workers, nothing is decided again
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function RunSection(props: {
  run: NonNullable<SpacePush["run"]>;
  /** Live, or read back from disk after the fact — a finished run has
   *  nothing left to stop. */
  live: boolean;
  world: World;
  /** The step whose log is open, so its card reads as selected. */
  openLog?: string;
}): JSX.Element {
  const { run, world } = props;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // The slices this run builds, each with an auditor that grades it — the
  // steps the engine really runs, not only the ones that write code.
  const slices = useMemo(
    () => [...new Set(run.units.filter((u) => u.role === "code").map((u) => u.slice))],
    [run.units],
  );
  const graded = (slice: string): boolean =>
    run.units.filter((u) => u.slice === slice && u.role === "code").every((u) => u.state === "done");
  const anyFailed = run.units.some((u) => u.state === "failed");
  const blocked = run.units.filter((u) => u.state === "blocked").length;
  const allDone = run.units.length > 0 && run.units.every((u) => u.state === "done");

  const cards: CardData[] = useMemo(
    () => [
      ...run.units.map((u) => ({
        id: u.id,
        band: u.role === "test" ? ROLES.test : ROLES.code,
        title: u.sliceTitle ?? u.slice,
        titleFull: `worker ${u.id}`,
        // What it is here to build comes first, and stays there whatever
        // happens to it; what happened is said under it.
        abs: [
          u.what,
          u.note,
          !u.what && !u.note && u.requires.length
            ? `waits for ${u.requires.length} other unit${u.requires.length === 1 ? "" : "s"}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n") || undefined,
        chips: [chipFor(u, now), logChip(u.id, run)],
      })),
      ...slices.map((slice) => ({
        id: `audit:${slice}`,
        band: ROLES.audit,
        title: slice,
        abs: "grades the checks against the real state",
        chips: [
          graded(slice)
            ? ({ text: "green", kind: "pass", why: "Every check for this slice passed against the real state." } as Chip)
            : ({ text: "waiting", kind: "plain", why: "It grades once the slice's workers finish." } as Chip),
        ],
      })),
      {
        id: "gate",
        band: { ...ROLES.audit, text: "Audit — everything together" },
        title: "The closing gate",
        abs: "runs every check on the real state and grades each promise",
        chips: [
          allDone
            ? ({ text: "green", kind: "pass", why: "Every check ran green at the gate." } as Chip)
            : anyFailed
              ? ({ text: "some undelivered", kind: "na", why: "A failed unit leaves its promises undelivered — the gate names them." } as Chip)
              : ({ text: "waiting", kind: "plain", why: "The gate runs when every unit has finished." } as Chip),
        ],
        ...(run.logCounts?.run ? { children: undefined } : {}),
      },
    ],
    [run.units, now, slices],
  );
  const edges = useMemo(
    () => [
      ...run.units.flatMap((u) => u.requires.map((r) => ({ from: r, to: u.id }))),
      // Every code unit reports to its slice's auditor; auditors to the gate.
      ...run.units
        .filter((u) => u.role === "code")
        .map((u) => ({ from: u.id, to: `audit:${u.slice}` })),
      ...slices.map((slice) => ({ from: `audit:${slice}`, to: "gate" })),
    ],
    [run.units, slices],
  );
  const { heights, probe } = useMeasuredHeights(cards, "", world.far);
  const [layout, setLayout] = useState<LaidOut | null>(null);
  const shape = cards
    .map((c) => `${c.id}@${heights.get(c.id) ?? 0}`)
    .join("|") + "#" + edges.map((e) => `${e.from}>${e.to}`).join(",");
  useEffect(() => {
    let alive = true;
    void layoutLayered({
      nodes: cards.map((c) => ({ id: c.id, w: NODE_W, h: heights.get(c.id) ?? 70 })),
      edges,
      direction: "RIGHT",
    })
      .catch(() => stackLayout(cards.map((c) => ({ id: c.id, w: NODE_W, h: heights.get(c.id) ?? 70 }))))
      .then((l) => {
        if (alive) setLayout(l);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  // Every worker is drawn, always — never a pile in the corner while the
  // engine works.
  const drawn =
    layout && cards.every((c) => layout.nodes.has(c.id))
      ? layout
      : stackLayout(cards.map((c) => ({ id: c.id, w: NODE_W, h: heights.get(c.id) ?? 70 })));

  const done = run.units.filter((u) => u.state === "done").length;
  const total = run.units.length || 1;
  const running = run.units.find((u) => u.state === "running");
  const failed = run.units.filter((u) => u.state === "failed");
  const anchor = running && drawn.nodes.get(running.id);

  return (
    <section data-run-view style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: SP.md, padding: `${SP.xs}px ${SP.lg}px` }}>
        <span data-run-progress-text style={{ fontSize: FS.body, opacity: O.dim }}>
          {done} of {run.units.length} workers done
          {blocked ? ` · ${blocked} never ran` : ""}
        </span>
        <span style={{ flex: 1, height: 5, background: "var(--vscode-input-background, #222)", borderRadius: 3, overflow: "hidden" }}>
          <span
            data-run-progress
            style={{
              display: "block",
              height: "100%",
              width: `${Math.round((done / total) * 100)}%`,
              background: C.live,
              transition: "width 400ms",
            }}
          />
        </span>
        {props.live ? (
        <button
          data-stop-run
          title="Stop the run — aborts every live worker; the run drains and reports."
          style={{ background: C.bad, color: "#fff", border: "none", borderRadius: 4, padding: `${SP.xs}px ${SP.md}px`, cursor: "pointer" }}
          onClick={() => post({ action: "stop-run" })}
        >
          ■ Stop
        </button>
        ) : (
          <span data-run-over style={{ fontSize: FS.body, opacity: O.dim }}>
            {allDone ? "finished" : anyFailed ? "finished, with failures" : "not running"}
          </span>
        )}
      </div>
      <div
        data-flow-canvas
        style={{ position: "relative", flex: 1, overflow: "hidden", cursor: "grab", minHeight: 300 }}
        ref={world.ref}
      >
        {probe}
        <style>{`@keyframes tandemPulse { 50% { opacity: O.faint } }`}</style>
        <div
          style={{
            position: "absolute",
            transformOrigin: "0 0",
            transform: `translate(${world.tx}px, ${world.ty}px) scale(${world.k})`,
          }}
        >
          <svg style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}>
            <defs>
              <marker id="arrflow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
                <path d="M0,0L6,3L0,6" fill="none" stroke={C.quiet} />
              </marker>
            </defs>
            {drawn.edges.map((e, i) => (
              <path
                key={i}
                d={edgePath(e.points, 0, 0)}
                stroke={C.quiet}
                strokeWidth={1.5}
                fill="none"
                markerEnd="url(#arrflow)"
              />
            ))}
          </svg>
          {cards.map((card) => {
            const u = run.units.find((x) => x.id === card.id);
            const c = drawn.nodes.get(card.id);
            const parked = u && run.parked.find((p) => p.unitId === u.id);
            return (
              <NodeCard
                key={card.id}
                card={card}
                far={world.far}
                expanded={false}
                selected={props.openLog === card.id}
                onClick={(id) => post({ action: "read-log", stepId: id })}
                style={{ left: c?.x ?? 0, top: c?.y ?? 0 }}
              >
                {parked && !world.far ? (
                  <div data-parked={u.id} style={{ marginTop: 6, borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
                    <div style={{ fontSize: FS.body, marginBottom: 4, color: C.ask }}>❓ {parked.question}</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        data-answer-input={u.id}
                        value={answers[u.id] ?? ""}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setAnswers((a) => ({ ...a, [u.id]: e.target.value }))}
                        style={{ flex: 1, fontSize: FS.body, minWidth: 0 }}
                      />
                      <button
                        data-answer-send={u.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          const text = (answers[u.id] ?? "").trim();
                          if (text) post({ action: "answer-worker", unitId: u.id, text });
                        }}
                      >
                        Send
                      </button>
                    </div>
                  </div>
                ) : null}
              </NodeCard>
            );
          })}
          {anchor && !world.far ? (
            <div
              data-anchored-log
              style={{
                position: "absolute",
                left: anchor.x,
                top: anchor.y + anchor.h + 10,
                width: 300,
                background: C.raised,
                border: `1px solid ${C.focus}`,
                borderRadius: 6,
                padding: `${SP.sm}px ${SP.md}px`,
                font: "11px/1.5 monospace",
                whiteSpace: "pre-wrap",
                maxHeight: 140,
                overflowY: "auto",
              }}
            >
              <div style={{ color: C.focus, fontFamily: "system-ui", fontSize: FS.body, marginBottom: 2 }}>
                {running!.id} — live log
              </div>
              {run.logs.slice(-8).join("\n")}
            </div>
          ) : null}
        </div>
      </div>
      {!running && run.logs.length ? (
        <div
          data-run-log
          style={{
            borderTop: `1px solid ${C.border}`,
            padding: `${SP.sm}px ${SP.lg}px`,
            font: "11px/1.5 monospace",
            whiteSpace: "pre-wrap",
            maxHeight: 160,
            overflowY: "auto",
            flexShrink: 0,
          }}
        >
          <div style={{ fontFamily: "system-ui", fontSize: FS.body, marginBottom: 3, opacity: O.dim }}>
            {failed.length
              ? `The run stopped with ${failed.length} unit${failed.length === 1 ? "" : "s"} failed — what it reported:`
              : "What the run reported:"}
          </div>
          {run.logs.slice(-14).join("\n")}
        </div>
      ) : null}
    </section>
  );
}
