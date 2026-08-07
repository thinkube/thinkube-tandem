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

function Questions(props: { push: SpacePush; onSelect: (id: string) => void }): JSX.Element {
  const { push } = props;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  return (
    <section data-questions style={{ marginBottom: 14 }}>
      <strong style={{ fontSize: 12 }}>Questions for you ({push.questions.length})</strong>
      {push.questions.map((q) => (
        <div key={q.id} data-question={q.id} style={{ margin: "6px 0", padding: 6, border: "1px solid #e5c07b", borderRadius: 6 }}>
          {q.askLabel ? (
            <div style={{ fontSize: 11, opacity: 0.7 }}>{q.askLabel}</div>
          ) : null}
          <div style={{ fontSize: 12 }}>{q.text}</div>
          {q.cards.length ? (
            <div style={{ fontSize: 11, opacity: 0.8, marginTop: 3 }}>
              On {q.cards.length === 1 ? "this card" : "these cards"}:{" "}
              {q.cards.map((c, i) => (
                <span key={c.id}>
                  {i ? ", " : ""}
                  <a
                    data-question-card={c.id}
                    title="Select this card on the map."
                    style={{ cursor: "pointer", textDecoration: "underline" }}
                    onClick={() => props.onSelect(c.id)}
                  >
                    {c.title}
                  </a>
                </span>
              ))}
            </div>
          ) : null}
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
            title="Record this answer as a decision in force — its implications are staged for you."
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
  onSelect: (id: string) => void;
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

      {push.questions.length ? <Questions push={push} onSelect={props.onSelect} /> : null}

      {push.proposals.length ? (
        <section data-proposals style={{ marginBottom: 14 }}>
          <strong style={{ fontSize: 12 }}>The machine suggests merging</strong>
          <div style={{ fontSize: 11, opacity: 0.7, margin: "2px 0 4px" }}>
            Units it found strongly coupled. Merged units are built together as one slice.
          </div>
          {push.proposals.map((p) => (
            <div key={p.id} data-proposal={p.id} style={{ padding: "4px 0" }}>
              <div style={{ opacity: 0.85 }}>
                Fold {p.joiners.length === 1 ? "this" : `these ${p.joiners.length}`} into “{p.anchor.title}”
                {" "}({p.anchor.count} promise{p.anchor.count === 1 ? "" : "s"})?
              </div>
              <ul style={{ margin: "3px 0 0 0", paddingLeft: 18, fontSize: 11, opacity: 0.8 }}>
                {p.joiners.map((j, i) => (
                  <li key={i} title={j.members.join("\n")}>
                    {j.title} ({j.count} promise{j.count === 1 ? "" : "s"})
                  </li>
                ))}
              </ul>
              <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                One slice of {p.resultCount} promises.
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 3 }}>
                <button
                  data-merge-accept={p.id}
                  title="Fold every listed unit into this one — they will be built as one slice."
                  onClick={() => post({ action: "accept-merge", unitId: p.id })}
                >
                  Merge {p.joiners.length === 1 ? "" : `all ${p.joiners.length} `}into one
                </button>
                <button
                  data-merge-reject={p.id}
                  title="Keep them separate — these pairs are never suggested again."
                  style={{ opacity: 0.75 }}
                  onClick={() => post({ action: "reject-merge", unitId: p.id })}
                >
                  Keep separate
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {push.impacts.length ? (
        <section data-impacts style={{ marginBottom: 14 }}>
          <strong style={{ fontSize: 12 }}>Your decisions imply changes</strong>
          {push.impacts.length > 1 ? (
            <div style={{ margin: "4px 0" }}>
              <button
                data-impacts-apply-all
                title="Apply every implication at once — each affected ask re-thinks ONCE under all your decisions, five at a time."
                onClick={() => post({ action: "apply-all-impacts" })}
              >
                Apply all {push.impacts.length} — each ask re-thinks once
              </button>
            </div>
          ) : null}
          {push.impacts.map((im) => (
            <div key={im.id} data-impact={im.id} style={{ padding: "4px 0" }}>
              <div style={{ opacity: 0.85 }}>
                “{im.decision}” implies re-deriving {im.affected} promise(s) of “
                {im.askText.length > 40 ? im.askText.slice(0, 39) + "…" : im.askText}” — nothing changed yet
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 3 }}>
                <button data-impact-accept={im.id} title="Re-derive the affected promises under this decision now." onClick={() => post({ action: "accept-impact", impactId: im.id })}>
                  Re-derive
                </button>
                <button data-impact-dismiss={im.id} title="Leave everything as it is — the decision stays in force." style={{ opacity: 0.75 }} onClick={() => post({ action: "dismiss-impact", impactId: im.id })}>
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {(() => {
        const ready = push.units.filter(
          (u) => !u.inCut && !u.tep && !u.stale && u.openQuestions === 0 && u.coverage.covered === u.coverage.total,
        );
        return ready.length ? (
          <button
            data-cut-ready
            style={{ ...btn, marginBottom: 10 }}
            title="Add every ready unit to the cut — those with all checks written, no open questions, and not out of date."
            onClick={() => post({ action: "toggle-cut", changeIds: ready.flatMap((u) => u.changeIds) })}
          >
            Add everything that is ready ({ready.length} unit{ready.length === 1 ? "" : "s"})
          </button>
        ) : null;
      })()}
      {push.cutCount > 0 ? (
        <section data-cut-screen style={{ marginBottom: 14 }}>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, overflowX: "auto" }}>{push.cutScreen}</pre>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              data-review-cut
              title="Open the cut review — every promise, where it lands, and the exact checks."
              onClick={() => post({ action: "open-cut-review" })}
            >
              Read it first
            </button>
            <button data-sign style={btn} title="Sign this cut — approves exactly what the review shows and starts the build." onClick={() => post({ action: "sign-cut" })}>
              Sign
            </button>
          </div>
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
                  title="Pin these units into one slice — your pin outranks the machine's grouping."
                  onClick={() => {
                    for (let i = 1; i < cutUnits.length; i++)
                      post({ action: "pin", pinKind: "together", changeIds: [cutUnits[0].changeIds[0], cutUnits[i].changeIds[0]] });
                  }}
                >
                  Merge {cutUnits.length} into one slice
                </button>
              ) : null;
            })()}
            <button data-toggle-cut style={btn} title="Add or remove this unit's promises from the batch you will sign. Dependencies ride along automatically." onClick={() => post({ action: "toggle-cut", changeIds: unit.changeIds })}>
              {unit.inCut ? "Remove from cut" : "Add to cut"}
            </button>
          </div>
          <div style={{ fontSize: 11, opacity: 0.7, margin: "8px 0 2px" }}>
            Promises in this unit ({unit.nodes.length}) — each is one provable
            thing to build, with the check that will prove it.
          </div>
          {unit.nodes.map((n) => (
            <div
              key={n.id}
              style={{
                padding: "5px 0",
                borderTop: "1px solid var(--vscode-panel-border, #3c3c3c)",
              }}
            >
              <div>
                {n.sentence}{" "}
                <span
                  data-flip={n.id}
                  title="Show where this promise lands in the code."
                  style={{ cursor: "pointer", opacity: 0.6 }}
                  onClick={() => props.onFlip(n.id)}
                >
                  ⌄
                </span>
              </div>
              {props.flipped.has(n.id) ? (
                <pre data-machine-face style={{ fontSize: 11, opacity: 0.85, margin: "3px 0 3px 12px", whiteSpace: "pre-wrap" }}>
                  {`lands at: ${n.touchpoints.join(", ") || "(not grounded)"}`}
                </pre>
              ) : null}
              {n.acceptance.length ? (
                <div style={{ fontSize: 11, marginTop: 2, marginLeft: 12, color: "var(--ok, #89d185)" }}>
                  {n.acceptance.map((a, i) => (
                    <div key={i}>✓ proved by: {a}</div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 11, marginTop: 2, marginLeft: 12, opacity: 0.75 }}>
                  no check yet — nothing would prove this promise
                </div>
              )}
              <div style={{ display: "flex", gap: 6, marginTop: 3, marginLeft: 12 }}>
                {n.acceptance.length === 0 && push.pendingCheck?.changeId !== n.id ? (
                  <button
                    data-write-check={n.id}
                    disabled={!!push.activity}
                    style={{ fontSize: 11 }}
                    title="Write a check for this promise — you accept or reword it; your wording wins."
                    onClick={() => post({ action: "propose-check", changeIds: [n.id] })}
                  >
                    {push.activity?.label.includes("check") ? "⟳ writing the check…" : "Write a check"}
                  </button>
                ) : null}
                {unit.changeIds.length > 1 ? (
                  <button
                    data-pin-apart={n.id}
                    title="Move this promise into a unit of its own."
                    style={{ fontSize: 11, opacity: 0.75 }}
                    onClick={() => {
                      const other = unit.changeIds.find((id) => id !== n.id);
                      if (other) post({ action: "pin", pinKind: "apart", changeIds: [n.id, other] });
                    }}
                  >
                    Move out of this unit
                  </button>
                ) : null}
              </div>
              {push.pendingCheck?.changeId === n.id ? (
                <PendingCheck changeId={n.id} text={push.pendingCheck.text} kind={push.pendingCheck.kind} />
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

function PendingCheck(props: { changeId: string; text: string; kind: "probe" | "assessment" }): JSX.Element {
  const [text, setText] = useState(props.text);
  return (
    <div data-pending-check style={{ margin: "4px 0 4px 12px", border: "1px solid var(--vscode-focusBorder, #3794ff)", borderRadius: 5, padding: 6 }}>
      <div style={{ fontSize: 11, opacity: 0.7 }}>
        {props.kind === "assessment"
          ? "No runnable test fits this — an independent reviewer will grade it at delivery."
          : "This becomes a runnable test at delivery."}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ width: "100%", minHeight: 40, fontSize: 12, marginTop: 4 }}
      />
      <button
        data-accept-check
        style={{ fontSize: 11, marginTop: 3 }}
        onClick={() => post({ action: "accept-check", changeIds: [props.changeId], text, kind: props.kind })}
      >
        Accept — your wording wins
      </button>
    </div>
  );
}
