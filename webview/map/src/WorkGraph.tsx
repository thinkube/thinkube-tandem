/**
 * Graph 2 — work: what gets built, and what proves it. Boxes are promises,
 * framed by the claim they make true; ELK places them and routes the real
 * dependency arrows (this promise needs that one). The boxes stay HTML
 * because they carry the cut checkbox and the check gestures.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { post, SpacePush } from "./vscode";
import { C, FS, O, SP, label, labelIn, raised } from "./type";
import { World } from "./proto/world";
import { NODE_W } from "./proto/nodeCard";
import { layoutLayered, LaidOut, stackLayout } from "./proto/elkRun";

/** Only until a card has been measured once. Nothing is laid out on it. */
const UNMEASURED_H = 120;

/** Every band on a card says what it is — colour is not a vocabulary. */
const cap: React.CSSProperties = label;

export function WorkGraph(props: {
  push: SpacePush;
  world: World;
  subjectId: string | null;
  onSubject: (id: string | null) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  onUp: (subjectId: string) => void;
  /** The way back: your asks are not on this page, so a claim that reads
   *  wrong opens the ask it came from where you write them. */
  onEditAsk: (askId: string) => void;
}): JSX.Element {
  const { push } = props;
  const subjects = useMemo(
    () => push.subjects.filter((s) => !props.subjectId || s.id === props.subjectId),
    [push.subjects, props.subjectId],
  );
  const claims = useMemo(
    () => subjects.flatMap((s) => s.claims.map((c) => ({ subject: s, claim: c }))),
    [subjects],
  );

  // Cards are laid out at their REAL height, read from the page after
  // they render. A promise's sentence, the files it lands in and the
  // checks that prove it are all as long as they are — nothing is cut —
  // and a guessed height put a 390px card where 118px had been reserved,
  // so everything below it was drawn underneath. Width is fixed, so a
  // measured height never changes with position: measure once, settle.
  //
  // The run view measures a hidden copy instead, because its cards come
  // from one shared component. These are measured in place: the labelled
  // bands here are their own shape, and a probe would be a second one.
  const boxes = useRef(new Map<string, HTMLDivElement>());
  const [heights, setHeights] = useState<Map<string, number>>(new Map());
  useLayoutEffect(() => {
    setHeights((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [id, el] of boxes.current) {
        const h = Math.ceil(el.getBoundingClientRect().height);
        if (h > 0 && next.get(id) !== h) {
          next.set(id, h);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  });
  const heightOf = (id: string): number => heights.get(id) ?? UNMEASURED_H;

  // One layout per claim: the claim is the frame, its promises the nodes.
  const [layouts, setLayouts] = useState<Map<string, LaidOut>>(new Map());
  const shape = claims
    .map(
      ({ claim }) =>
        `${claim.id}:${claim.promises.map((p) => `${p.id}@${heightOf(p.id)}`).join(",")}`,
    )
    .join("|");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void Promise.all(
      claims.map(async ({ claim }) => {
        const nodes = claim.promises.map((p) => ({ id: p.id, w: NODE_W, h: heightOf(p.id) }));
        const ids = new Set(claim.promises.map((p) => p.id));
        const edges = claim.promises.flatMap((p) =>
          p.needs.filter((n) => ids.has(n)).map((n) => ({ from: n, to: p.id })),
        );
        const laid = await layoutLayered({ nodes, edges, direction: "RIGHT" }).catch(() =>
          stackLayout(nodes),
        );
        if (alive.current) setLayouts((prev) => new Map(prev).set(claim.id, laid));
      }),
    );
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  if (!push.subjects.length)
    return (
      <div style={{ flex: 1, padding: 24, opacity: O.dim }}>
        Nothing derived yet — accept a model on the intent graph and I will think about each subject.
      </div>
    );

  return (
    <div
      data-work-graph
      ref={props.world.ref}
      style={{ position: "relative", flex: 1, overflow: "hidden", cursor: "grab", minHeight: 300 }}
    >
      <div
        style={{
          position: "absolute",
          transformOrigin: "0 0",
          transform: `translate(${props.world.tx}px, ${props.world.ty}px) scale(${props.world.k})`,
          // Room at the foot so the zoom controls never sit on top of a
          // card the reader is trying to read.
          padding: `0 ${SP.lg}px 56px`,
        }}
      >
      {push.outOfDate.promises ? (
        <div
          data-out-of-date
          style={{
            ...raised,
            borderColor: C.ask,
            padding: `${SP.sm}px ${SP.md}px`,
            marginBottom: SP.md,
            maxWidth: "44rem",
            display: "flex",
            alignItems: "center",
            gap: SP.md,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: FS.body }}>
            The code moved under {push.outOfDate.promises} promise
            {push.outOfDate.promises === 1 ? "" : "s"}: a file they land in changed since I read
            it, so where they land and what would prove them may no longer be right.
          </span>
          <button
            data-reground
            style={{ fontWeight: 600 }}
            title="Read the code again and work out these subjects from what is there now. Nothing you wrote changes."
            onClick={() => post({ action: "reground" })}
          >
            Read the code again
          </button>
          <span style={{ fontSize: FS.caption, color: C.quiet }}>
            {push.outOfDate.subjects} subject{push.outOfDate.subjects === 1 ? "" : "s"} read again —
            about {push.outOfDate.rounds} rounds
          </span>
        </div>
      ) : null}

      {props.subjectId ? (
        <div style={{ fontSize: FS.caption, opacity: O.dim, marginBottom: 8 }}>
          showing only {push.subjects.find((s) => s.id === props.subjectId)?.name}{" "}
          <button data-show-all title="Show every subject's promises." onClick={() => props.onSubject(null)}>
            show every subject
          </button>
        </div>
      ) : null}

      {claims.map(({ subject, claim }) => {
        const laid =
          layouts.get(claim.id) ??
          stackLayout(claim.promises.map((p) => ({ id: p.id, w: NODE_W, h: heightOf(p.id) })));
        return (
          <section
            key={claim.id}
            data-claim-frame={claim.id}
            style={{
              border: `1px dashed ${C.border}`,
              borderRadius: 6,
              padding: 8,
              marginBottom: 10,
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginBottom: 6 }}>
              <a
                data-up-to-subject={subject.id}
                title="Go up to this subject in the intent graph."
                style={{ fontSize: FS.caption, textDecoration: "underline", cursor: "pointer" }}
                onClick={() => props.onUp(subject.id)}
              >
                {subject.name}
              </a>
              <span style={{ fontSize: FS.body }}>{claim.text}</span>
              <button
                data-edit-from={claim.fromAskId}
                title={`Say ask #${claim.fromAskN} differently — I will read it again: ${claim.fromAsk}`}
                aria-label={`say ask ${claim.fromAskN} differently`}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "inherit",
                  opacity: O.dim,
                  fontSize: FS.body,
                  padding: 0,
                }}
                onClick={() => props.onEditAsk(claim.fromAskId)}
              >
                #{claim.fromAskN} ✎
              </button>
            </div>
            {claim.promises.length === 0 ? (
              <div style={{ fontSize: FS.caption, opacity: O.dim }}>nothing derived for this claim yet</div>
            ) : (
              <div style={{ position: "relative", height: laid.height, width: laid.width }}>
                <svg
                  style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}
                >
                  <defs>
                    <marker id="wg-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
                      <path d="M0,0L6,3L0,6" fill="none" stroke={C.quiet} />
                    </marker>
                  </defs>
                  {laid.edges.map((e, i) => (
                    <path
                      key={i}
                      d={"M " + e.points.map((p) => `${p.x},${p.y}`).join(" L ")}
                      stroke={C.quiet}
                      strokeWidth={1.4}
                      fill="none"
                      markerEnd="url(#wg-arrow)"
                    />
                  ))}
                </svg>
                {claim.promises.map((p) => {
                  const at = laid.nodes.get(p.id);
                  return (
                    <div
                      key={p.id}
                      data-promise={p.id}
                      ref={(el) => {
                        if (el) boxes.current.set(p.id, el);
                        else boxes.current.delete(p.id);
                      }}
                      onClick={() => props.onSelect(p.id)}
                      title="Select this promise."
                      style={{
                        position: "absolute",
                        left: at?.x ?? 0,
                        top: at?.y ?? 0,
                        width: NODE_W,
                        boxSizing: "border-box",
                        padding: `${SP.sm}px ${SP.md}px`,
                        borderRadius: 5,
                        cursor: "pointer",
                        background: C.raised,
                        border: `1px solid ${
                          props.selected === p.id
                            ? C.focus
                            : C.border
                        }`,
                      }}
                    >
                      <div style={cap}>Promise</div>
                      <div style={{ fontSize: FS.body }}>{p.text}</div>
                      <div style={{ ...cap, marginTop: 6 }}>
                        Lands in <span style={{ textTransform: "none" }}>— where the change goes</span>
                      </div>
                      <div style={{ fontSize: FS.caption }}>
                        {p.file
                          ? p.file.split(", ").map((f) => <div key={f}>{f}</div>)
                          : "nowhere yet — this promise is not grounded"}
                      </div>
                      <div style={{ ...cap, marginTop: 6, color: p.checks.length ? undefined : C.bad }}>
                        {p.checks.length ? (
                          <>
                            Checks{" "}
                            <span style={{ textTransform: "none" }}>— what will prove it</span>
                          </>
                        ) : (
                          "No check — nothing would prove this"
                        )}
                      </div>
                      {p.checks.map((c, i) => (
                        <div key={i} style={{ fontSize: FS.caption, color: C.ok }}>
                          {c}
                        </div>
                      ))}
                      {p.stale ? (
                        <div
                          data-stale={p.id}
                          title="A file this promise lands in changed since I last read the code, so where it lands and what would prove it may no longer be right."
                          style={{
                            ...labelIn(C.ask),
                            marginTop: SP.sm,
                          }}
                        >
                          Out of date
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
      </div>
    </div>
  );
}
