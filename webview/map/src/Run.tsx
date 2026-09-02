/**
 * The orchestration flow view — the APPROVED PROTOTYPE's second tab: the
 * SAME HTML node cards laid out by ELK (layered, RIGHT, orthogonal
 * ELK-routed edges), run-state chips (pulsing `running`), elapsed time in
 * the chip, the log panel ANCHORED under the running node, a parked
 * worker's question shown on its own card (answered from the rail, the
 * surface's one answer box), Stop and a determinate progress header
 * above the canvas.
 */
import { useEffect, useMemo, useState } from "react";
import { can, post, refusalSentence, SpacePush } from "./vscode";
import { World } from "./proto/world";
import { CardData, Chip, NodeCard, NODE_W, useMeasuredHeights } from "./proto/nodeCard";
import { edgePath, layoutLayered, LaidOut, stackLayout } from "./proto/elkRun";
import { C, FS, O, ROLES, SP } from "./type";
import { sliceCheckTally, unpassedWorkers } from "../../../src/surfaces/auditCard";
import { stateFace } from "../../../src/surfaces/runCardFace";
import { gateTitle } from "../../../src/surfaces/runPromiseLabel";
import { proofOfPass } from "../../../src/surfaces/surfaceContract";


type RunUnits = NonNullable<SpacePush["run"]>["units"];

/** `3m 12s` — elapsed, humanly. */
function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function chipFor(u: RunUnits[number], now: number, logLines: number): Chip {
  const elapsed =
    u.startedAt && (u.state === "running" || u.state === "parked")
      ? ` · ${formatElapsed(now - u.startedAt)}`
      : "";
  const doing = u.activity ? `${u.activity.text} · ${formatElapsed(now - u.activity.since)}` : "";
  switch (u.state) {
    case "running":
      return doing
        ? { text: `${doing}`, kind: "run", why: `running for ${formatElapsed(now - (u.startedAt ?? now))}` }
        : { text: `running${elapsed}`, kind: "run" };
    case "parked":
      return { text: `needs you${elapsed}`, kind: "q" };
    case "done": {
      const proof = proofOfPass(logLines);
      return { text: proof.text, kind: proof.proven ? "pass" : "na", why: proof.why };
    }
    case "failed":
      return { text: "failed", kind: "na" };
    case "blocked":
      return {
        text: "never ran",
        kind: "plain",
        why: "The run stopped, or something this waits on failed, so this was never dispatched. It is not a failure.",
      };
    default:
      return doing ? { text: doing, kind: "plain" } : { text: "pending", kind: "plain" };
  }
}

/** The step's own log, advertised on its card — a door, not a secret. */
function logChip(id: string, run: NonNullable<SpacePush["run"]>): Chip {
  const n = run.logCounts?.[id] ?? 0;
  return { text: `${n} log line${n === 1 ? "" : "s"}`, kind: "plain", why: "Click this card to read this step's own log in the panel." };
}

export function RunNote(props: {
  notice: { heading: string; sentence: string; canRerun: boolean; canThinkAgain: boolean };
  /** The phase the push carried, so a control the phase has turned off can
   *  say why. `disabled` swallows the click, so `post()`'s refusal path
   *  never runs and the tooltip is the only place the sentence reaches. */
  phase: SpacePush["phase"];
}): JSX.Element {
  const { notice } = props;
  return (
    <div data-run-note style={{ margin: SP.xl, padding: SP.lg, border: `1px solid ${C.bad}`, borderRadius: 6, maxWidth: 560 }}>
      <strong>{notice.heading}</strong>
      <div style={{ marginTop: SP.sm, whiteSpace: "pre-wrap" }}>{notice.sentence}</div>
      {/* Signing happens once, so a run that refused itself would leave the
          work sealed and unreachable — the button that starts it is already
          spent. This is the way back in. */}
      {notice.canRerun || notice.canThinkAgain ? (
        <div style={{ marginTop: SP.md, display: "flex", gap: SP.md, alignItems: "center", flexWrap: "wrap" }}>
          {notice.canRerun ? (
            <>
              <button
                data-rerun
                disabled={!can("rerun")}
                style={{ fontWeight: 600 }}
                title={
                  can("rerun")
                    ? "Start the signed work again. Nothing is signed twice and nothing you wrote changes."
                    : refusalSentence("rerun", props.phase)
                }
                onClick={() => post({ action: "rerun" })}
              >
                Run it again
              </button>
              <span style={{ fontSize: FS.caption, color: C.quiet }}>
                already signed — this starts the workers, nothing is decided again
              </span>
            </>
          ) : null}
          {notice.canThinkAgain ? (
            <>
              <button
                data-think-again
                disabled={!can("think-again")}
                title={
                  can("think-again")
                    ? "Withdraw this signed work and think its promises through again under everything decided since. Nothing delivered is touched."
                    : refusalSentence("think-again", props.phase)
                }
                onClick={() => post({ action: "think-again" })}
              >
                Think it again
              </button>
              <span style={{ fontSize: FS.caption, color: C.quiet }}>
                withdraws the signature — the promises are derived anew and signed as new work
              </span>
            </>
          ) : null}
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
  /** The phase the push carried, so a control the phase has turned off can
   *  say why. `disabled` swallows the click, so `post()`'s refusal path
   *  never runs and the tooltip is the only place the sentence reaches. */
  phase: SpacePush["phase"];
}): JSX.Element {
  const { run, world } = props;
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
  const graded = (slice: string): boolean => unpassedWorkers(run.units, slice).length === 0;
  const anyFailed = run.units.some((u) => u.state === "failed");
  const blocked = run.units.filter((u) => u.state === "blocked").length;
  const allDone = run.units.length > 0 && run.units.every((u) => u.state === "done");

  const cards: CardData[] = useMemo(
    () => [
      // A NODE CARRIES ITS TITLE. What it builds and what it did are read
      // on the right, when it is chosen — a graph whose every node holds a
      // paragraph is a graph nobody can take in, and this one was drawing
      // the same slice title on three different nodes, so no card said
      // which one it was.
      ...run.units.map((u) => {
        // A maintainer is named for the slice it serves, not as a slice of its own.
        const fallback = u.role === "maintain" ? `${u.slice.replace(/-tests$/, "")} · tests` : (u.sliceTitle ?? u.slice);
        const fallbackFull = `${u.id} — ${u.role === "maintain" ? `brings ${u.slice.replace(/-tests$/, "")}'s tests under` : (u.sliceTitle ?? u.slice)}`;
        // What the unit builds: the promise, and where it lands, read from
        // the unit's own brief when the space cannot name the promise.
        const said = u.what?.split(/\s+—\s+lands at\s+/);
        const lands =
          said && said.length > 1 ? `lands at ${said.slice(1).join(" ").split(/\s+—\s+|\n/)[0].trim()}` : undefined;
        const spoken = u.promiseLabel?.label ?? (said?.[0]?.trim() || undefined);
        return {
          id: u.id,
          band: u.role === "test" ? ROLES.test : u.role === "maintain" ? ROLES.maintain : ROLES.code,
          title: spoken ?? fallback,
          said: !!spoken,
          titleFull: u.promiseLabel ? `${u.id} — ${u.promiseLabel.full}` : spoken ? `${u.id} — ${u.what}` : fallbackFull,
          ...(lands ? { abs: lands } : {}),
          chips: [chipFor(u, now, run.logCounts?.[u.id] ?? 0), logChip(u.id, run)],
          face: stateFace(u.state),
        };
      }),
      ...slices.map((slice) => {
        const u = run.units.find((x) => x.slice === slice);
        const isGraded = graded(slice);
        const tally = sliceCheckTally(run.sliceChecks?.[slice]);
        const chips: Chip[] = tally.graded
          ? [
              {
                text: `${tally.passed}/${tally.total} checks passed`,
                kind: tally.passed === tally.total ? "pass" : "na",
                why: "How many of this slice's acceptance criteria passed against the real state.",
              },
              ...tally.failed.map(
                (f): Chip => ({
                  text: `AC-${f.ac} failed`,
                  kind: "na",
                  why: f.text ?? "This check did not pass.",
                }),
              ),
            ]
          : [
              isGraded
                ? ({ text: "green", kind: "pass", why: "Every check for this slice passed against the real state." } as Chip)
                : ({ text: "waiting", kind: "plain", why: "It grades once the slice's workers finish." } as Chip),
            ];
        return {
          id: `audit:${slice}`,
          band: ROLES.audit,
          title: u?.promiseLabel?.label ?? u?.what?.split(/\s+—\s+lands at\s+/)[0]?.trim() ?? u?.sliceTitle ?? slice,
          said: !!(u?.promiseLabel ?? u?.what),
          titleFull: u?.promiseLabel ? `audit:${slice} — ${u.promiseLabel.full}` : undefined,
          abs: "every check of this piece, on the real state",
          chips,
          face: stateFace(isGraded ? "done" : "running"),
        };
      }),
      // No workers, no gate: a run that never seeded a unit (it refused
      // itself before dispatch) has nothing to grade, and a lone closing
      // gate card over an empty graph claims a run that never happened.
      ...(run.units.length
        ? [
            {
              id: "gate",
              band: { ...ROLES.audit, text: "audit — everything together" },
              // The gate keeps the whole cut's promise, so it is titled the
              // way every other card is: by the promise, in the person's own
              // words, with the full sentences on hover. One promise names
              // itself; several are named by the first and a count, the same
              // shape a worker card uses when its unit carries more than one.
              ...gateTitle(run.units),
              abs: "every check, on the real state",
              chips: [
                allDone
                  ? ((proof) => ({ text: proof.text, kind: proof.proven ? "pass" : "na", why: proof.why }) as Chip)(
                      proofOfPass(run.logCounts?.["gate"] ?? 0),
                    )
                  : anyFailed
                    ? ({ text: "some undelivered", kind: "na", why: "A failed unit leaves its promises undelivered — the gate names them." } as Chip)
                    : ({ text: "waiting", kind: "plain", why: "The gate runs when every unit has finished." } as Chip),
                // The gate's own account, one click away like every worker's —
                // its opening line and the reason it withheld or kept a
                // delivery are filed under this same step name.
                logChip("gate", run),
              ],
              face: stateFace(allDone ? "done" : anyFailed ? "failed" : "running"),
            },
          ]
        : []),
    ],
    [run.units, now, slices],
  );
  // Why each arrow is there, looked up when it is drawn. An arrow that
  // says only THAT a unit waits leaves the reader unable to tell a
  // coupling between slices — worth questioning — from the method
  // working: a coder waiting for its own probes.
  const why = useMemo(() => {
    const m = new Map<string, { kind: "needs" | "probes"; what?: string }>();
    for (const u of run.units)
      for (const w of u.waits ?? []) m.set(`${w.on}>${u.id}`, { kind: w.kind, ...(w.what ? { what: w.what } : {}) });
    return m;
  }, [run.units]);
  const edges = useMemo(
    () => [
      ...run.units.flatMap((u) =>
        u.requires.map((r) => ({ from: r, to: u.id, label: `${r}>${u.id}` })),
      ),
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

  return (
    <section data-run-view style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: SP.md, padding: `${SP.xs}px ${SP.lg}px` }}>
        <span data-edge-key style={{ fontSize: FS.caption, color: C.quiet }}>
          <span style={{ color: C.live }}>──</span> needs what it produces ·{" "}
          <span style={{ color: C.quiet }}>╌╌</span> waits for its own probes
        </span>
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
          disabled={!can("stop-run")}
          title={
            can("stop-run")
              ? "Stop the run — aborts every live worker; the run drains and reports."
              : refusalSentence("stop-run", props.phase)
          }
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
            {drawn.edges.map((e, i) => {
              const w = e.label ? why.get(e.label) : undefined;
              const needs = w?.kind === "needs";
              return (
                <path
                  key={i}
                  data-edge={w?.kind ?? "flow"}
                  d={edgePath(e.points, 0, 0)}
                  stroke={needs ? C.live : C.quiet}
                  strokeWidth={needs ? 2 : 1.5}
                  strokeDasharray={w?.kind === "probes" ? "4 3" : undefined}
                  fill="none"
                  markerEnd="url(#arrflow)"
                >
                  <title>
                    {needs
                      ? `waits for what it needs${w?.what ? `: ${w.what}` : ""}`
                      : w?.kind === "probes"
                        ? "waits for its own probes — the checks are written before the code"
                        : "waits"}
                  </title>
                </path>
              );
            })}
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
                  // Display only: the one place an answer is given is the
                  // rail's parked-question box, so this card names the
                  // question and offers no second box to type into.
                  <div data-parked={u.id} style={{ marginTop: 6, borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
                    <div style={{ fontSize: FS.body, color: C.ask }}>❓ {parked.question}</div>
                    <div style={{ fontSize: FS.caption, color: C.quiet, marginTop: 2 }}>
                      Answer this in the rail.
                    </div>
                  </div>
                ) : null}
              </NodeCard>
            );
          })}
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
            overscrollBehavior: "none",
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
