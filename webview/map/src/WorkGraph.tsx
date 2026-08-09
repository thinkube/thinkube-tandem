/**
 * Graph 2 — work: what gets built, and what proves it. Boxes are promises,
 * framed by the claim they make true; ELK places them and routes the real
 * dependency arrows (this promise needs that one). The boxes stay HTML
 * because they carry the cut checkbox and the check gestures.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { post, SpacePush } from "./vscode";
import { World } from "./proto/world";
import { NODE_W } from "./proto/nodeCard";
import { layoutLayered, LaidOut, stackLayout } from "./proto/elkRun";

const PBOX_H = 118;

export function WorkGraph(props: {
  push: SpacePush;
  world: World;
  subjectId: string | null;
  onSubject: (id: string | null) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  onUp: (subjectId: string) => void;
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

  // One layout per claim: the claim is the frame, its promises the nodes.
  const [layouts, setLayouts] = useState<Map<string, LaidOut>>(new Map());
  const shape = claims
    .map(({ claim }) => `${claim.id}:${claim.promises.map((p) => p.id).join(",")}`)
    .join("|");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void Promise.all(
      claims.map(async ({ claim }) => {
        const nodes = claim.promises.map((p) => ({ id: p.id, w: NODE_W, h: PBOX_H }));
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
      <div style={{ flex: 1, padding: 24, opacity: 0.7 }}>
        Nothing derived yet — accept a model on the intent graph and I will think about each subject.
      </div>
    );

  return (
    <div data-work-graph style={{ flex: 1, overflow: "auto", padding: 12 }}>
      {props.subjectId ? (
        <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 8 }}>
          showing only {push.subjects.find((s) => s.id === props.subjectId)?.name}{" "}
          <button data-show-all title="Show every subject's promises." onClick={() => props.onSubject(null)}>
            show every subject
          </button>
        </div>
      ) : null}

      {claims.map(({ subject, claim }) => {
        const laid =
          layouts.get(claim.id) ??
          stackLayout(claim.promises.map((p) => ({ id: p.id, w: NODE_W, h: PBOX_H })));
        return (
          <section
            key={claim.id}
            data-claim-frame={claim.id}
            style={{
              border: "1px dashed var(--vscode-panel-border, #3c3c3c)",
              borderRadius: 6,
              padding: 8,
              marginBottom: 10,
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginBottom: 6 }}>
              <a
                data-up-to-subject={subject.id}
                title="Go up to this subject in the intent graph."
                style={{ fontSize: 11, textDecoration: "underline", cursor: "pointer" }}
                onClick={() => props.onUp(subject.id)}
              >
                {subject.name}
              </a>
              <span style={{ fontSize: 12 }}>{claim.text}</span>
            </div>
            {claim.promises.length === 0 ? (
              <div style={{ fontSize: 11, opacity: 0.7 }}>nothing derived for this claim yet</div>
            ) : (
              <div style={{ position: "relative", height: laid.height, width: laid.width }}>
                <svg
                  style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}
                >
                  <defs>
                    <marker id="wg-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
                      <path d="M0,0L6,3L0,6" fill="none" stroke="var(--vscode-descriptionForeground, #9d9d9d)" />
                    </marker>
                  </defs>
                  {laid.edges.map((e, i) => (
                    <path
                      key={i}
                      d={"M " + e.points.map((p) => `${p.x},${p.y}`).join(" L ")}
                      stroke="var(--vscode-descriptionForeground, #9d9d9d)"
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
                      onClick={() => props.onSelect(p.id)}
                      title="Select this promise."
                      style={{
                        position: "absolute",
                        left: at?.x ?? 0,
                        top: at?.y ?? 0,
                        width: NODE_W,
                        boxSizing: "border-box",
                        padding: "6px 8px",
                        borderRadius: 5,
                        cursor: "pointer",
                        background: "var(--vscode-editorWidget-background, #252526)",
                        border: `1px solid ${
                          props.selected === p.id
                            ? "var(--vscode-focusBorder, #3794ff)"
                            : "var(--vscode-panel-border, #3c3c3c)"
                        }`,
                      }}
                    >
                      <div style={{ fontSize: 12 }}>{p.text}</div>
                      <div style={{ fontSize: 10, opacity: 0.65, marginTop: 2 }}>{p.file || "(not grounded)"}</div>
                      {p.checks.length ? (
                        <div style={{ fontSize: 10, color: "#89d185", marginTop: 2 }}>
                          proved by: {p.checks.join("; ")}
                        </div>
                      ) : (
                        <div style={{ fontSize: 10, color: "#f14c4c", marginTop: 2 }}>
                          no check yet — nothing would prove this
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 6, marginTop: 4, fontSize: 11 }}>
                        {p.stale ? (
                          <button
                            data-reground={p.id}
                            title="Re-read the code for this promise — it changed since the machine last read it."
                            onClick={(e) => {
                              e.stopPropagation();
                              post({ action: "reground" });
                            }}
                          >
                            out of date
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
