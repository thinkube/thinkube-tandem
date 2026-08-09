/**
 * The rail beside the graphs: what is in force, what the machine is doing
 * right now, what it has delivered, and the one press that commits.
 *
 * Nothing here asks for a decision the machine could make itself. What is
 * left is authority (build, accept, answer a stuck worker), a live view of
 * the work, and the sentence panel that leads anything that grates back to
 * the words that caused it.
 */
import { post, SpacePush } from "./vscode";
import { Sentences } from "./Sentences";

const btn: React.CSSProperties = {
  fontWeight: 600,
  padding: "4px 10px",
};

const chip = (color: string): React.CSSProperties => ({
  fontSize: 10,
  color,
  border: `1px solid ${color}`,
  borderRadius: 3,
  padding: "0 4px",
  marginLeft: 4,
});

/** One step's own log, paged — the machine's account of what it did. */
function StepLog(props: { log: NonNullable<SpacePush["runLog"]> }): JSX.Element {
  const { log } = props;
  return (
    <section data-step-log style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong style={{ fontSize: 12 }}>{log.step}</strong>
        <span style={{ fontSize: 10, opacity: 0.7 }}>
          {log.total} line{log.total === 1 ? "" : "s"}
        </span>
      </div>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          fontSize: 11,
          background: "var(--vscode-textCodeBlock-background, #1e1e1e)",
          border: "1px solid var(--vscode-panel-border, #3c3c3c)",
          borderRadius: 4,
          padding: "6px 8px",
          margin: "4px 0",
          maxHeight: "22rem",
          overflowY: "auto",
        }}
      >
        {log.lines.join("\n") || "(nothing yet)"}
      </pre>
      {log.pages > 1 ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11 }}>
          <button
            data-log-prev
            disabled={log.page <= 1}
            onClick={() => post({ action: "read-log", stepId: log.step, page: log.page - 1 })}
          >
            ←
          </button>
          <span>
            page {log.page} of {log.pages}
          </span>
          <button
            data-log-next
            disabled={log.page >= log.pages}
            onClick={() => post({ action: "read-log", stepId: log.step, page: log.page + 1 })}
          >
            →
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** What the human alone can answer: a worker that cannot go on without them. */
function Parked(props: { push: SpacePush }): JSX.Element | null {
  const parked = props.push.run?.parked ?? [];
  if (!parked.length) return null;
  return (
    <section data-parked style={{ marginBottom: 14 }}>
      <strong style={{ fontSize: 12, color: "#e5c07b" }}>A worker needs you</strong>
      {parked.map((p) => (
        <div key={p.unitId} style={{ marginTop: 4 }}>
          <div style={{ fontSize: 12 }}>{p.question}</div>
          <textarea
            id={`answer-${p.unitId}`}
            rows={2}
            style={{ width: "100%", fontSize: 12, marginTop: 2 }}
            placeholder="your answer"
          />
          <button
            data-answer-worker={p.unitId}
            style={{ fontSize: 11 }}
            onClick={() => {
              const el = document.getElementById(`answer-${p.unitId}`) as HTMLTextAreaElement | null;
              if (el?.value.trim())
                post({ action: "answer-worker", unitId: p.unitId, text: el.value });
            }}
          >
            Send
          </button>
        </div>
      ))}
    </section>
  );
}

export function Rail(props: {
  push: SpacePush;
  selected: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const { push } = props;
  const ready = push.subjects
    .flatMap((s) => s.claims.flatMap((c) => c.promises))
    .filter((p) => !p.tep);
  const objects = push.subjects.filter((s) =>
    s.claims.some((c) => c.promises.some((p) => !p.tep)),
  ).length;

  return (
    <div
      data-rail
      style={{
        width: 320,
        borderLeft: "1px solid var(--vscode-panel-border, #3c3c3c)",
        overflowY: "auto",
        fontSize: 12,
        flexShrink: 0,
      }}
    >
      <div style={{ padding: 10 }}>
        {push.rules.length ? (
          <section style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", opacity: 0.7, marginBottom: 4 }}>
              In force
            </div>
            {push.rules.map((r) => (
              <div
                key={r.id}
                data-rule-chip={r.id}
                style={{
                  border: "1px solid var(--vscode-panel-border, #3c3c3c)",
                  borderRadius: 5,
                  padding: "5px 7px",
                  marginBottom: 5,
                }}
              >
                {r.text}
                <span style={chip("#e5c07b")}>{r.scope}</span>
                <button
                  data-retire-rule={r.id}
                  style={{ fontSize: 10, marginLeft: 6 }}
                  title="Retire it — it governs nothing from now on."
                  onClick={() => post({ action: "retire-rule", unitId: r.id })}
                >
                  Retire
                </button>
              </div>
            ))}
          </section>
        ) : null}

        <Parked push={push} />
        {push.runLog ? <StepLog log={push.runLog} /> : null}

        {ready.length ? (
          <section data-build style={{ marginBottom: 14 }}>
            <button
              data-build
              style={{ ...btn, width: "100%" }}
              title="Build it. Everything assumed becomes a rule, and the sentences behind this work become read-only."
              onClick={() => post({ action: "build" })}
            >
              Build {objects} object{objects === 1 ? "" : "s"}
            </button>
            <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4 }}>
              {ready.length} promise{ready.length === 1 ? "" : "s"} · workers run in parallel ·
              the sentences behind them become read-only
            </div>
          </section>
        ) : null}

        {push.deliveries.length ? (
          <section data-deliveries>
            <div style={{ fontSize: 11, textTransform: "uppercase", opacity: 0.7, marginBottom: 4 }}>
              Delivered
            </div>
            {push.deliveries.map((d) => (
              <div
                key={d.id}
                style={{
                  border: "1px solid var(--vscode-panel-border, #3c3c3c)",
                  borderRadius: 5,
                  padding: "6px 8px",
                  marginBottom: 8,
                }}
              >
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, margin: 0 }}>{d.page}</pre>
                {d.accepted ? (
                  <span style={chip("#89d185")}>accepted</span>
                ) : (
                  <button
                    data-accept-delivery={d.id}
                    style={{ ...btn, marginTop: 4 }}
                    title="Try the gestures above, then accept."
                    onClick={() => post({ action: "accept-delivery", deliveryId: d.id })}
                  >
                    Accept
                  </button>
                )}
              </div>
            ))}
          </section>
        ) : null}
      </div>

      <div style={{ borderTop: "1px solid var(--vscode-panel-border, #3c3c3c)" }}>
        <Sentences push={push} />
      </div>
    </div>
  );
}
