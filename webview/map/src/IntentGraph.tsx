/**
 * The reading page: what I understood of what you wrote, before anything
 * costs money. One shape only — the object — with what must become true of
 * it listed inside, and the rules that hold across all of them above.
 *
 * There is nothing here to accept and nothing to rearrange. If it reads
 * wrong you say the sentence differently, because a wrong reading is a
 * sentence that did not say enough. Going on to the work page is what
 * starts the thinking, and it says first what that will cost.
 */
import { post, SpacePush } from "./vscode";

const box: React.CSSProperties = {
  border: "1px solid var(--vscode-panel-border, #3c3c3c)",
  borderRadius: 6,
  background: "var(--vscode-editorWidget-background, #252526)",
  overflow: "hidden",
};

/** The reading, straight from the proposal — nothing is recorded yet. */
function Proposed(props: { push: SpacePush }): JSX.Element {
  const p = props.push.pendingModel!;
  return (
    <>
      {p.rules.length ? (
        <section
          data-proposed-rules
          style={{ ...box, borderColor: "#e5c07b", padding: "8px 10px", marginBottom: 10 }}
        >
          <div style={{ fontSize: 11, textTransform: "uppercase", color: "#e5c07b", marginBottom: 3 }}>
            holds across all of them
          </div>
          {p.rules.map((r, i) => (
            <div key={i} style={{ fontSize: 12 }}>
              {r.text} <em style={{ opacity: 0.7 }}>— {r.scope}</em>
            </div>
          ))}
        </section>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(21rem, 1fr))", gap: 10 }}>
        {p.subjects.map((s, i) => (
          <div key={i} data-proposed-subject={i} style={{ ...box, padding: "8px 10px" }}>
            <strong style={{ fontSize: 13 }}>{s.name}</strong>
            {s.claims.map((c, j) => (
              <div
                key={j}
                style={{ fontSize: 12, marginTop: 4, paddingLeft: 8, borderLeft: "2px solid #4ec9b0" }}
              >
                {c.text}
                {c.why ? (
                  <div style={{ fontSize: 11, opacity: 0.7, fontStyle: "italic" }}>{c.why}</div>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>
      {p.missing.length ? (
        <div data-model-missing style={{ fontSize: 11, color: "#f14c4c", marginTop: 8 }}>
          I could not place {p.missing.length} of your sentences: {p.missing.join(" · ")}
        </div>
      ) : null}
    </>
  );
}

/** What was recorded — the same shape, once the reading has been kept. */
function Recorded(props: { push: SpacePush; onSelect: (id: string) => void }): JSX.Element {
  const { push } = props;
  return (
    <>
      {push.rules.length ? (
        <section
          data-rules-band
          style={{
            ...box,
            borderColor: "#e5c07b",
            padding: "8px 10px",
            marginBottom: 10,
            maxHeight: "14rem",
            overflowY: "auto",
          }}
        >
          <div style={{ fontSize: 11, textTransform: "uppercase", color: "#e5c07b", marginBottom: 3 }}>
            holds across all of them, now and later
          </div>
          {push.rules.map((r) => (
            <div
              key={r.id}
              data-rule={r.id}
              onClick={() => props.onSelect(r.id)}
              style={{ fontSize: 12, cursor: "pointer" }}
              title={`From what you wrote: ${r.fromAsk}`}
            >
              {r.text} <span style={{ opacity: 0.65, fontSize: 11 }}>— {r.scope}</span>
            </div>
          ))}
        </section>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(21rem, 1fr))", gap: 10 }}>
        {push.subjects.map((s) => (
          <div key={s.id} data-subject={s.id} style={box}>
            <div
              data-subject-head={s.id}
              onClick={() => props.onSelect(s.id)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                padding: "7px 9px",
                cursor: "pointer",
                borderBottom: "1px solid var(--vscode-panel-border, #3c3c3c)",
              }}
            >
              <strong style={{ fontSize: 13 }}>{s.name}</strong>
              {s.thinking ? (
                <span style={{ fontSize: 11, color: "#4ec9b0" }}>
                  ⟳ {s.thinking.label} {s.thinking.current}/{s.thinking.total}
                </span>
              ) : null}
            </div>
            {s.claims.map((c) => (
              <div
                key={c.id}
                data-claim={c.id}
                onClick={() => props.onSelect(c.id)}
                style={{
                  padding: "6px 9px",
                  cursor: "pointer",
                  borderBottom: "1px solid var(--vscode-panel-border, #3c3c3c)",
                }}
              >
                <div style={{ fontSize: 12 }}>{c.text}</div>
                {c.why ? (
                  <div style={{ fontSize: 11, opacity: 0.7, fontStyle: "italic" }}>{c.why}</div>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

export function IntentGraph(props: {
  push: SpacePush;
  selected: string | null;
  onSelect: (id: string) => void;
  onOpenWork: (subjectId: string) => void;
}): JSX.Element {
  const { push } = props;
  if (push.modelFailure)
    return (
      <section
        data-model-failed
        style={{ margin: 12, padding: 12, border: "1px solid #f14c4c", borderRadius: 6 }}
      >
        <strong style={{ fontSize: 13, color: "#f14c4c" }}>
          I could not read your list — nothing was derived
        </strong>
        <div style={{ fontSize: 12, margin: "6px 0" }}>
          Your {push.modelFailure.sentences} sentence
          {push.modelFailure.sentences === 1 ? " is" : "s are"} recorded and waiting. Nothing was
          guessed at.
        </div>
        <pre
          style={{
            fontSize: 11,
            whiteSpace: "pre-wrap",
            background: "var(--vscode-textCodeBlock-background, #1e1e1e)",
            borderRadius: 4,
            padding: "6px 8px",
            maxHeight: 160,
            overflowY: "auto",
          }}
        >
          {push.modelFailure.reason}
        </pre>
        <button data-retry-model onClick={() => post({ action: "retry-model" })}>
          Read it again
        </button>
      </section>
    );

  const nothing = !push.pendingModel && !push.subjects.length;
  if (nothing)
    return (
      <div style={{ flex: 1, padding: 24, opacity: 0.7 }}>
        Nothing here yet — write what you want above and I will read it as one description.
      </div>
    );

  const cost = push.cost;
  return (
    <div data-intent-graph style={{ flex: 1, overflowY: "auto", padding: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>What I understood</strong>
        <span style={{ fontSize: 11, opacity: 0.75 }}>
          Say a sentence differently if this reads wrong — nothing here costs anything yet.
        </span>
      </div>

      {push.pendingModel ? <Proposed push={push} /> : <Recorded push={push} onSelect={props.onSelect} />}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
        <button
          data-think
          style={{ fontWeight: 600 }}
          title="Work out what to build. This is what starts spending."
          onClick={() => post({ action: "think" })}
        >
          Work out what to build
        </button>
        <span style={{ fontSize: 11, opacity: 0.75 }}>
          {cost.subjects
            ? `${cost.subjects} object${cost.subjects === 1 ? "" : "s"} to think about — about ${cost.rounds} rounds`
            : "everything here has been thought about already"}
        </span>
      </div>

      {push.orphans.length ? (
        <section
          data-orphans
          style={{ marginTop: 12, border: "1px solid #f14c4c", borderRadius: 6, padding: "8px 10px" }}
        >
          <div style={{ fontSize: 11, textTransform: "uppercase", color: "#f14c4c", marginBottom: 4 }}>
            {push.orphans.length} thing(s) I derived that match nothing you asked for
          </div>
          {push.orphans.map((o) => (
            <div key={o.id} style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "baseline" }}>
              <span style={{ flex: 1 }}>{o.text}</span>
              <button
                data-dismiss-promise={o.id}
                title="Remove it — nothing you wrote asks for this."
                onClick={() => post({ action: "dismiss-promise", unitId: o.id })}
              >
                Remove
              </button>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
