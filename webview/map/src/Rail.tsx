/**
 * The right rail — the approved prototype's "Space-wide (governs every
 * unit)" panel, extended with every waiting-on-you surface in one place:
 * decisions in force, open questions (accept = decide), staged merge
 * suggestions, staged decision implications, the cut screen with Sign,
 * the selected unit's detail (cut / pins / machine-face flip), and
 * deliveries with Accept.
 */
import { useState } from "react";
import { post, SpacePush } from "./vscode";

const btn: React.CSSProperties = {
  background: "var(--vscode-button-background)",
  color: "var(--vscode-button-foreground)",
  border: "none",
  borderRadius: 4,
  padding: "4px 12px",
  cursor: "pointer",
  fontWeight: 600,
};

const chip = (color: string): React.CSSProperties => ({
  fontSize: 11,
  padding: "1px 7px",
  borderRadius: 8,
  border: `1px solid ${color}`,
  color,
});

function Questions(props: { push: SpacePush }): JSX.Element {
  const { push } = props;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  return (
    <section data-questions style={{ marginBottom: 14 }}>
      <strong style={{ fontSize: 12 }}>Questions for you ({push.questions.length})</strong>
      {push.questions.map((q) => (
        <div key={q.id} data-question={q.id} style={{ margin: "6px 0", padding: 6, border: "1px solid #e5c07b", borderRadius: 6 }}>
          <div style={{ fontSize: 12 }}>{q.text}</div>
          <textarea
            data-question-text={q.id}
            disabled={push.running}
            value={drafts[q.id] ?? q.recommendation ?? ""}
            onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
            style={{ width: "100%", minHeight: 40, fontSize: 12, margin: "4px 0", boxSizing: "border-box" }}
          />
          <button
            data-accept-question={q.id}
            disabled={push.running}
            title="Accept — this becomes a binding decision; its implications are staged for you"
            onClick={() =>
              post({ action: "accept-question", questionId: q.id, text: (drafts[q.id] ?? q.recommendation ?? "").trim() })
            }
          >
            Accept
          </button>
        </div>
      ))}
    </section>
  );
}

export function Rail(props: {
  push: SpacePush;
  selected: string | null;
  flipped: Set<string>;
  onFlip: (id: string) => void;
}): JSX.Element {
  const { push } = props;
  const unit = push.units.find((u) => u.id === props.selected);
  return (
    <div
      data-rail
      style={{
        width: 300,
        borderLeft: "1px solid var(--vscode-panel-border, #3c3c3c)",
        padding: 10,
        overflowY: "auto",
        fontSize: 12,
        flexShrink: 0,
      }}
    >
      <h4 style={{ margin: "2px 0 8px", fontSize: 12, color: "var(--vscode-descriptionForeground, #9d9d9d)", textTransform: "uppercase" }}>
        Space-wide (governs every unit)
      </h4>
      {push.decisions.length === 0 ? (
        <div style={{ opacity: 0.6, marginBottom: 10 }}>No decisions yet.</div>
      ) : (
        push.decisions.map((d, i) => (
          <div
            key={i}
            data-decision={i}
            style={{ border: "1px solid var(--vscode-panel-border, #3c3c3c)", borderRadius: 5, padding: "6px 8px", marginBottom: 8 }}
          >
            {d} <span style={chip("#4ec9b0")}>decision</span>
          </div>
        ))
      )}

      {push.questions.length ? <Questions push={push} /> : null}

      {push.proposals.length ? (
        <section data-proposals style={{ marginBottom: 14 }}>
          <strong style={{ fontSize: 12 }}>The machine suggests merging</strong>
          {push.proposals.map((p) => (
            <div key={p.id} data-proposal={p.id} style={{ padding: "4px 0" }}>
              <div style={{ opacity: 0.85 }}>
                “{p.aTitle}” + “{p.bTitle}” look like one slice
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 3 }}>
                <button data-merge-accept={p.id} onClick={() => post({ action: "accept-merge", proposalId: p.id })}>
                  Merge
                </button>
                <button data-merge-reject={p.id} style={{ opacity: 0.75 }} onClick={() => post({ action: "reject-merge", proposalId: p.id })}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {push.impacts.length ? (
        <section data-impacts style={{ marginBottom: 14 }}>
          <strong style={{ fontSize: 12 }}>Your decisions imply changes</strong>
          {push.impacts.map((im) => (
            <div key={im.id} data-impact={im.id} style={{ padding: "4px 0" }}>
              <div style={{ opacity: 0.85 }}>
                “{im.decision}” implies re-deriving {im.affected} change(s) of “
                {im.askText.length > 40 ? im.askText.slice(0, 39) + "…" : im.askText}” — nothing changed yet
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 3 }}>
                <button data-impact-accept={im.id} onClick={() => post({ action: "accept-impact", impactId: im.id })}>
                  Re-derive
                </button>
                <button data-impact-dismiss={im.id} style={{ opacity: 0.75 }} onClick={() => post({ action: "dismiss-impact", impactId: im.id })}>
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {push.cutCount > 0 ? (
        <section data-cut-screen style={{ marginBottom: 14 }}>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, overflowX: "auto" }}>{push.cutScreen}</pre>
          <button data-sign style={btn} onClick={() => post({ action: "sign-cut" })}>
            Sign
          </button>
        </section>
      ) : null}

      {unit ? (
        <section data-unit-panel style={{ marginBottom: 14 }}>
          <h4 style={{ margin: "2px 0 8px", fontSize: 12, color: "var(--vscode-descriptionForeground, #9d9d9d)", textTransform: "uppercase" }}>
            Selected unit
          </h4>
          <strong style={{ fontSize: 12 }}>{unit.title}</strong>
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
            <button data-toggle-cut style={btn} onClick={() => post({ action: "toggle-cut", changeIds: unit.changeIds })}>
              {unit.inCut ? "Remove from cut" : "Add to cut"}
            </button>
          </div>
          {unit.nodes.map((n) => (
            <div key={n.id} style={{ padding: "3px 0" }}>
              <div>
                • {n.sentence}{" "}
                {unit.changeIds.length > 1 ? (
                  <button
                    data-pin-apart={n.id}
                    title="This change is not part of this unit — split it out"
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
                <pre data-machine-face style={{ fontSize: 11, opacity: 0.85, margin: "3px 0 3px 12px", whiteSpace: "pre-wrap" }}>
                  {`lands at: ${n.touchpoints.join(", ") || "(not grounded)"}\nproven by: ${n.acceptance.join("; ") || "(nothing yet)"}`}
                </pre>
              ) : null}
            </div>
          ))}
        </section>
      ) : (
        <section data-unit-panel style={{ marginBottom: 14 }}>
          <h4 style={{ margin: "2px 0 8px", fontSize: 12, color: "var(--vscode-descriptionForeground, #9d9d9d)", textTransform: "uppercase" }}>
            Selected unit
          </h4>
          <div style={{ opacity: 0.55 }}>Click a unit card for its detail.</div>
        </section>
      )}

      {push.deliveries.map((d) => (
        <section key={d.id} data-delivery={d.id} style={{ marginBottom: 14 }}>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, overflowX: "auto" }}>{d.page}</pre>
          {d.undelivered?.length ? (
            <div style={{ color: "#f59e0b", margin: "4px 0" }}>
              {d.undelivered.map((u, i) => (
                <div key={i}>UNDELIVERED: {u}</div>
              ))}
            </div>
          ) : null}
          {d.url ? (
            <div style={{ margin: "4px 0" }}>
              <a href={d.url}>{d.url}</a>
            </div>
          ) : null}
          {d.accepted ? (
            <span style={{ opacity: 0.7 }}>accepted</span>
          ) : (
            <button data-accept style={btn} onClick={() => post({ action: "accept-delivery", deliveryId: d.id })}>
              Accept
            </button>
          )}
        </section>
      ))}
    </div>
  );
}
