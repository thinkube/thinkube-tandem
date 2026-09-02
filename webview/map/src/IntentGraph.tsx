/**
 * The reading page: what I understood of what you wrote, before anything
 * costs money. Your sentences, each inside the thing it was read into,
 * with the reading marked in your own words.
 *
 * There is nothing here to accept and nothing to rearrange. If it reads
 * wrong you say the sentence differently, because a wrong reading is a
 * sentence that did not say enough. Going on is the one press in the
 * strip, and it says first what that will cost.
 */
import { can, post, refusalSentence, SpacePush } from "./vscode";
import { C, FS, O, SP, aside, labelIn } from "./type";
import { Things } from "./Things";

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
    <div style={{ padding: `0 ${SP.lg}px ${SP.md}px` }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(21rem, 1fr))", gap: 10 }}>
        {p.subjects.map((s, i) => (
          <div key={i} data-proposed-subject={i} style={{ ...box, padding: `${SP.sm}px ${SP.md}px` }}>
            <strong style={{ fontSize: FS.body }}>{s.name}</strong>
            {s.claims.map((c, j) => (
              <div
                key={j}
                style={{ fontSize: FS.body, marginTop: 4, paddingLeft: 8, borderLeft: "2px solid #4ec9b0" }}
              >
                {c.text}
                {c.why ? <div style={aside}>so that {c.why}</div> : null}
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
    </div>
  );
}

/** What was recorded — your sentences inside the things they became. */
export function IntentGraph(props: {
  push: SpacePush;
  selected: string | null;
  onSelect: (id: string) => void;
  editing: string | null;
  onEditing: (id: string | null) => void;
  /** The thinking is running: the work page is not a page yet. */
  working: boolean;
}): JSX.Element {
  const { push } = props;
  // AN EMPTY PAGE MUST SAY WHY IT IS EMPTY. A space with nothing derived
  // looked identical to a broken one, to a run that had eaten it, and to a
  // bug — one sentence ends that.
  if (!push.modelFailure && !push.pendingModel && (push.subjects?.length ?? 0) === 0 && !push.sentences.length)
    return (
      <section data-empty-space style={{ margin: 12, padding: 12 }}>
        <strong style={{ fontSize: FS.body }}>
          Nothing is written in {push.spaceName ? `"${push.spaceName}"` : "this space"} yet
        </strong>
        <div style={{ fontSize: FS.body, margin: "6px 0", opacity: O.dim }}>
          Write what you want on the first page, and it is read here.
        </div>
        <div style={{ fontSize: FS.caption, opacity: O.dim }}>
          If you expected work here, this is not the space that holds it — pick another under its
          project in the tree.
        </div>
      </section>
    );
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

  const cost = push.cost;
  const total = push.subjects.length;
  const done = Math.max(0, total - cost.subjects);
  return (
    <div data-intent-graph style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {push.pendingModel ? <Proposed push={push} /> : null}
      {props.working ? (
        <div
          data-working
          style={{
            margin: `${SP.md}px ${SP.lg}px 0`,
            padding: `${SP.sm}px ${SP.md}px`,
            border: `1px solid ${C.focus}`,
            borderRadius: 6,
            maxWidth: "44rem",
          }}
        >
          <div style={{ fontSize: FS.body, fontWeight: 600 }}>
            Working out what to build — {done} of {total} subject{total === 1 ? "" : "s"} done
          </div>
          <div style={{ fontSize: FS.caption, opacity: O.dim, marginTop: SP.xs }}>
            Nothing is lost if you look elsewhere; the work page opens by itself when the last one
            finishes.
          </div>
        </div>
      ) : null}
      <Things
        push={push}
        selected={props.selected}
        onSelect={props.onSelect}
        editing={props.editing}
        onEditing={props.onEditing}
      />
      {push.orphans.length ? (
        <section
          data-orphans
          style={{ margin: `0 ${SP.lg}px ${SP.md}px`, border: "1px solid #f14c4c", borderRadius: 6, padding: `${SP.sm}px ${SP.md}px` }}
        >
          <div style={{ ...labelIn(C.bad), marginBottom: 4 }}>
            {push.orphans.length} thing(s) I derived that match nothing you asked for
          </div>
          {push.orphans.map((o) => (
            <div key={o.id} style={{ fontSize: FS.body, display: "flex", gap: 6, alignItems: "baseline" }}>
              <span style={{ flex: 1 }}>{o.text}</span>
              <button
                data-dismiss-promise={o.id}
                disabled={!can("dismiss-promise")}
                title={can("dismiss-promise") ? "Remove it — nothing you wrote asks for this." : refusalSentence("dismiss-promise", push.phase)}
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
