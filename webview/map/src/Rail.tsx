/**
 * The rail beside the graphs: what the machine is doing right now, what it
 * has delivered, and the one press that commits.
 *
 * Nothing here asks for a decision the machine could make itself, and
 * nothing here repeats what is shown elsewhere — your asks live under the
 * box you write them in, and what was read from them on the reading page.
 */
import { post, SpacePush } from "./vscode";
import { C, FS, O, SP, label } from "./type";

const btn: React.CSSProperties = {
  fontWeight: 600,
  padding: `${SP.xs}px ${SP.md}px`,
};

/** One step's own log, paged — the machine's account of what it did. */
function StepLog(props: { log: NonNullable<SpacePush["runLog"]> }): JSX.Element {
  const { log } = props;
  return (
    <section data-step-log style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong style={{ fontSize: FS.body }}>{log.step}</strong>
        <span style={{ fontSize: FS.caption, opacity: O.dim }}>
          {log.total} line{log.total === 1 ? "" : "s"}
        </span>
      </div>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          fontSize: FS.caption,
          background: "var(--vscode-textCodeBlock-background, #1e1e1e)",
          border: `1px solid ${C.border}`,
          borderRadius: 4,
          padding: `${SP.sm}px ${SP.md}px`,
          margin: "4px 0",
          maxHeight: "22rem",
          overflowY: "auto",
        }}
      >
        {log.lines.join("\n") || "(nothing yet)"}
      </pre>
      {log.pages > 1 ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: FS.caption }}>
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
      <strong style={{ fontSize: FS.body, color: C.ask }}>A worker needs you</strong>
      {parked.map((p) => (
        <div key={p.unitId} style={{ marginTop: 4 }}>
          <div style={{ fontSize: FS.body }}>{p.question}</div>
          <textarea
            id={`answer-${p.unitId}`}
            rows={2}
            style={{ width: "100%", fontSize: FS.body, marginTop: 2 }}
            placeholder="your answer"
          />
          <button
            data-answer-worker={p.unitId}
            style={{ fontSize: FS.caption }}
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
  /** Build lives on the work page and nowhere else: pressing it is the one
   *  act that cannot be undone, and it must not sit beside a reading the
   *  human has not been shown the work for. */
  canBuild: boolean;
}): JSX.Element {
  const { push } = props;
  const ready = push.ready;

  return (
    <div
      data-rail
      style={{
        width: 320,
        borderLeft: `1px solid ${C.border}`,
        overflowY: "auto",
        fontSize: FS.body,
        flexShrink: 0,
      }}
    >
      <div style={{ padding: 10 }}>
        <Parked push={push} />
        {push.runLog ? <StepLog log={push.runLog} /> : null}

        {!props.canBuild ? null : ready.thinking ? (
          <div style={{ fontSize: FS.caption, opacity: O.dim, marginBottom: 14 }}>
            Still working out what to build — nothing can be committed until every subject is
            thought through.
          </div>
        ) : ready.subjects ? (
          <section data-build-section style={{ marginBottom: 14 }}>
            <div style={label}>Pressing this</div>
            <ul
              data-build-price
              style={{ fontSize: FS.caption, margin: 0, paddingLeft: SP.lg, lineHeight: 1.5 }}
            >
              <li>signs this work and mints a TEP number for it</li>
              <li>
                locks the {ready.asks} sentence{ready.asks === 1 ? "" : "s"} behind it: from then on
                they are read-only and can only be changed by writing a new one
              </li>
              <li>
                starts the workers on {ready.promises} promise
                {ready.promises === 1 ? "" : "s"} — this is what spends money
              </li>
              <li>pushes a branch, which stays whether or not you accept what comes back</li>
              <li>
                nothing is merged until you accept the delivery. Once you do, this thinking space
                becomes the record of that decision and can no longer be deleted
              </li>
            </ul>
            <button
              data-build
              style={{ ...btn, width: "100%", marginTop: SP.sm }}
              title="Sign this work and start the workers."
              onClick={() => post({ action: "build" })}
            >
              Sign and build {ready.subjects} subject{ready.subjects === 1 ? "" : "s"}
            </button>
          </section>
        ) : null}

      </div>
    </div>
  );
}
