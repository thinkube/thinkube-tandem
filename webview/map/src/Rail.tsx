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

/** One step's own log, paged. The evidence a step failed lives with that
 *  step, not in a shared ring that has already dropped it. */
function StepLog(props: { log: NonNullable<SpacePush["runLog"]> }): JSX.Element {
  const { log } = props;
  const from = log.page * log.pageSize;
  return (
    <section data-step-log style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong style={{ fontSize: 12 }}>{log.step} — its own log</strong>
        <button
          data-close-log
          title="Close this log."
          style={{ fontSize: 11, opacity: 0.7 }}
          onClick={() => post({ action: "read-log" })}
        >
          ✕
        </button>
      </div>
      <pre
        data-log-lines
        style={{
          font: "11px/1.6 var(--vscode-editor-font-family, monospace)",
          background: "var(--vscode-textCodeBlock-background, #1e1e1e)",
          border: "1px solid var(--vscode-panel-border, #3c3c3c)",
          borderRadius: 4,
          padding: "6px 8px",
          margin: "4px 0",
          maxHeight: 260,
          overflowY: "auto",
          whiteSpace: "pre-wrap",
        }}
      >
        {log.lines.join("\n") || "(nothing yet)"}
      </pre>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, opacity: 0.75 }}>
        <button
          data-log-older
          disabled={log.page === 0}
          title="Show the lines before these."
          onClick={() => post({ action: "read-log", stepId: log.step, page: log.page - 1 })}
        >
          ← older
        </button>
        <span>
          {log.total ? `${from + 1}–${Math.min(from + log.pageSize, log.total)} of ${log.total}` : "no lines"}
        </span>
        <button
          data-log-newer
          disabled={log.page >= log.pages - 1}
          title="Show the lines after these."
          onClick={() => post({ action: "read-log", stepId: log.step, page: log.page + 1 })}
        >
          newer →
        </button>
      </div>
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

      {push.runLog ? <StepLog log={push.runLog} /> : null}

      {push.questions.length ? <Questions push={push} onSelect={props.onSelect} /> : null}

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
        // Everything provable and not yet in the cut, in one press.
        const ready = push.subjects
          .flatMap((s) => s.claims.flatMap((c) => c.promises))
          .filter((p) => !p.inCut && !p.tep && !p.stale && p.checks.length > 0);
        return ready.length ? (
          <button
            data-cut-ready
            style={{ ...btn, marginBottom: 10 }}
            title="Add every promise that already has its check, is not signed, and is not out of date."
            onClick={() => post({ action: "toggle-cut", changeIds: ready.map((p) => p.id) })}
          >
            Add everything that is ready ({ready.length} promise{ready.length === 1 ? "" : "s"})
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
