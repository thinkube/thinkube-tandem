/**
 * The reading page: what I understood of what you wrote, before anything
 * costs money. One shape only — the SUBJECT — with the claims that must
 * become true of it listed inside, each carrying the ask it was read from.
 *
 * There is nothing here to accept and nothing to rearrange. If it reads
 * wrong you say the sentence differently, because a wrong reading is a
 * sentence that did not say enough. Going on to the work page is what
 * starts the thinking, and it says first what that will cost.
 */
import { post, SpacePush } from "./vscode";
import { C, FS, O, SP, aside, label, labelIn } from "./type";

/**
 * Where a shape came from, and the way back. Every subject and claim
 * is read FROM an ask, so each one shows its number and a pencil that
 * opens that ask for rewriting — disliking what was read is reason enough,
 * and it is always available, not only when something was assumed.
 */
function FromAsk(props: {
  n: number;
  id: string;
  text: string;
  onEditAsk: (id: string) => void;
}): JSX.Element {
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <span
        data-from-ask={props.id}
        title={`Read from your ask #${props.n}: ${props.text}`}
        style={{ opacity: O.faint, marginRight: 2 }}
      >
        #{props.n}
      </span>
      <button
        data-edit-from={props.id}
        title={`Say ask #${props.n} differently — I will read it again.`}
        aria-label={`say ask ${props.n} differently`}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "inherit",
          opacity: O.dim,
          fontSize: FS.body,
          padding: 0,
          lineHeight: 1,
        }}
        onClick={(e) => {
          e.stopPropagation();
          props.onEditAsk(props.id);
        }}
      >
        ✎
      </button>
    </span>
  );
}

const box: React.CSSProperties = {
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  background: C.raised,
  overflow: "hidden",
};

/** The reading, straight from the proposal — nothing is recorded yet. */
function Proposed(props: { push: SpacePush }): JSX.Element {
  const p = props.push.pendingModel!;
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(21rem, 1fr))", gap: 10 }}>
        {p.subjects.map((s, i) => (
          <div key={i} data-proposed-subject={i} style={{ ...box, padding: `${SP.sm}px ${SP.md}px` }}>
            <div style={{ ...label, marginTop: 0 }}>Subject</div>
            <strong style={{ fontSize: FS.body }}>{s.name}</strong>
            <div style={{ ...label, marginTop: 6 }}>Claims — what must become true of it</div>
            {s.claims.map((c, j) => (
              <div
                key={j}
                style={{ fontSize: FS.body, marginTop: 4, paddingLeft: 8, borderLeft: "2px solid #4ec9b0" }}
              >
                {c.text}
                {c.why ? (
                  <div style={aside}>so that {c.why}</div>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>
      {p.missing.length ? (
        <div data-model-missing style={{ fontSize: FS.caption, color: C.bad, marginTop: 8 }}>
          I could not place {p.missing.length} of your sentences: {p.missing.join(" · ")}
        </div>
      ) : null}
    </>
  );
}

/** What was recorded — the same shape, once the reading has been kept. */
function Recorded(props: {
  push: SpacePush;
  selected: string | null;
  onSelect: (id: string) => void;
  onEditAsk: (id: string) => void;
}): JSX.Element {
  const { push } = props;
  return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(21rem, 1fr))", gap: 10 }}>
        {push.subjects.map((s) => (
          <div key={s.id} data-subject={s.id} style={box}>
            <div
              data-subject-head={s.id}
              onClick={() => props.onSelect(s.id)}
              style={{
                padding: `${SP.sm}px ${SP.md}px`,
                cursor: "pointer",
                borderBottom: `1px solid ${C.border}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={label}>Subject</span>
                {s.thinking ? (
                  <span style={{ fontSize: FS.caption, color: C.ok }}>
                    ⟳ {s.thinking.label} {s.thinking.current}/{s.thinking.total}
                  </span>
                ) : null}
              </div>
              <strong style={{ fontSize: FS.body }}>{s.name}</strong>
              {s.from.length ? (
                <div style={{ fontSize: FS.caption, opacity: O.dim, marginTop: 2, display: "flex", gap: 6 }}>
                  <span>read from your ask{s.from.length === 1 ? "" : "s"}</span>
                  {s.from.map((f) => (
                    <FromAsk key={f.id} n={f.n} id={f.id} text={f.text} onEditAsk={props.onEditAsk} />
                  ))}
                </div>
              ) : null}
            </div>
            <div style={{ ...label, padding: `${SP.sm}px ${SP.md}px 0` }}>
              Claims — what must become true of it
            </div>
            {s.claims.map((c) => (
              <div
                key={c.id}
                data-claim={c.id}
                onClick={() => props.onSelect(c.id)}
                title={`Read from your ask #${c.fromAskN}: ${c.fromAsk}`}
                style={{
                  padding: `${SP.sm}px ${SP.md}px`,
                  cursor: "pointer",
                  borderBottom: `1px solid ${C.border}`,
                  background:
                    props.selected === c.fromAskId || props.selected === c.id
                      ? "var(--vscode-list-inactiveSelectionBackground, #2a2d2e)"
                      : undefined,
                }}
              >
                <div style={{ fontSize: FS.body }}>
                  <FromAsk
                    n={c.fromAskN}
                    id={c.fromAskId}
                    text={c.fromAsk}
                    onEditAsk={props.onEditAsk}
                  />{" "}
                  {c.text}
                </div>
                {c.why ? (
                  <div style={aside}>so that {c.why}</div>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>
  );
}

export function IntentGraph(props: {
  push: SpacePush;
  selected: string | null;
  onSelect: (id: string) => void;
  onOpenWork: (subjectId: string) => void;
  onEditAsk: (id: string) => void;
  /** Go and see the work — which is also what starts the thinking. */
  onWork: () => void;
}): JSX.Element {
  const { push } = props;
  if (push.modelFailure)
    return (
      <section
        data-model-failed
        style={{ margin: 12, padding: 12, border: "1px solid #f14c4c", borderRadius: 6 }}
      >
        <strong style={{ fontSize: FS.body, color: C.bad }}>
          I could not read your list — nothing was derived
        </strong>
        <div style={{ fontSize: FS.body, margin: "6px 0" }}>
          Your {push.modelFailure.sentences} sentence
          {push.modelFailure.sentences === 1 ? " is" : "s are"} recorded and waiting. Nothing was
          guessed at.
        </div>
        <pre
          style={{
            fontSize: FS.caption,
            whiteSpace: "pre-wrap",
            background: "var(--vscode-textCodeBlock-background, #1e1e1e)",
            borderRadius: 4,
            padding: `${SP.sm}px ${SP.md}px`,
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

  if (!push.pendingModel && !push.subjects.length)
    return (
      <div style={{ flex: 1, padding: 24 }}>
        {push.sentences.length ? (
          <>
            <div style={{ fontSize: FS.body, marginBottom: 4 }}>
              {push.sentences.length} sentence{push.sentences.length === 1 ? "" : "s"} recorded, none
              read yet.
            </div>
            <div style={{ fontSize: FS.body, opacity: O.dim, marginBottom: 10 }}>
              Reading them is one cheap round and costs nothing else.
            </div>
            <button
              data-retry-model
              style={{ fontWeight: 600 }}
              title="Read everything you have written, as one description."
              onClick={() => post({ action: "retry-model" })}
            >
              Read what I wrote
            </button>
          </>
        ) : (
          <span style={{ opacity: O.dim }}>
            Nothing here yet — write what you want above and I will read it as one description.
          </span>
        )}
      </div>
    );

  const cost = push.cost;
  return (
    <div data-intent-graph style={{ flex: 1, overflowY: "auto", padding: `${SP.lg}px ${SP.lg}px 56px` }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
        <strong style={{ fontSize: FS.body }}>What I understood of your asks</strong>
        <span style={{ fontSize: FS.caption, opacity: O.dim }}>
          Say a sentence differently if this reads wrong — nothing here costs anything yet.
        </span>
      </div>

      {push.pendingModel ? <Proposed push={push} /> : <Recorded
          push={push}
          selected={props.selected}
          onSelect={props.onSelect}
          onEditAsk={props.onEditAsk}
        />}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
        <button
          data-think
          style={{ fontWeight: 600 }}
          title={
            push.pendingModel
              ? "Keep this reading and work out what to build from it. This is what starts spending."
              : "Go to the work page. Working out what to build is what starts spending."
          }
          onClick={props.onWork}
        >
          {push.pendingModel ? "Keep this reading and see what it will build →" : "See what this will build →"}
        </button>
        <span style={{ fontSize: FS.caption, opacity: O.dim }}>
          {cost.subjects
            ? `${cost.subjects} subject${cost.subjects === 1 ? "" : "s"} to think about — about ${cost.rounds} rounds`
            : "everything here has been thought about already"}
        </span>
      </div>

      {push.orphans.length ? (
        <section
          data-orphans
          style={{ marginTop: 12, border: "1px solid #f14c4c", borderRadius: 6, padding: `${SP.sm}px ${SP.md}px` }}
        >
          <div style={{ ...labelIn(C.bad), marginBottom: 4 }}>
            {push.orphans.length} thing(s) I derived that match nothing you asked for
          </div>
          {push.orphans.map((o) => (
            <div key={o.id} style={{ fontSize: FS.body, display: "flex", gap: 6, alignItems: "baseline" }}>
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
