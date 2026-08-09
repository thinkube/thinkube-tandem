/**
 * Your asks, under the box you write them in — the one page they appear
 * on. They are absent from the work and build pages on purpose: editing
 * an ask re-reads its component and discards the derived work, so a list
 * there offers nothing but a way to destroy what you came to look at.
 * The way back from a promise to its ask is a link on the promise.
 *
 * Everything else on screen is read FROM them, so when something grates
 * this is where it leads: each ask carries what was assumed in its name
 * and which part of it was silent. An ask still open is rewritten here, at
 * a price stated before it is paid. An ask whose work is built cannot be
 * rewritten — changing built software is new work — so it takes an
 * amendment instead.
 *
 * Editing is a pencil, not a sentence-long button: it is available on
 * every open ask at all times, because disliking a subject or a claim is
 * reason enough to say the ask differently.
 */
import { useState } from "react";
import { post, SpacePush } from "./vscode";
import { aside, label, labelIn } from "./type";

type Sentence = SpacePush["sentences"][number];

function Editor(props: { s: Sentence; onDone: () => void }): JSX.Element {
  const { s } = props;
  const [text, setText] = useState(s.state === "bound" ? "" : s.text);
  const bound = s.state === "bound";
  return (
    <div style={{ marginTop: 6 }}>
      <textarea
        data-sentence-editor={s.id}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        rows={3}
        style={{ width: "100%", fontSize: 12, fontFamily: "inherit" }}
        placeholder={bound ? "say what you want now — it supersedes the sentence above" : ""}
      />
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
        <button
          data-reframe={bound ? undefined : s.id}
          data-amend={bound ? s.id : undefined}
          style={{ fontWeight: 600 }}
          onClick={() => {
            if (!text.trim()) return;
            post({ action: bound ? "amend" : "reframe", unitId: s.id, text });
            props.onDone();
          }}
        >
          {bound ? "Add this as an amendment" : "Say it this way instead"}
        </button>
        <button onClick={props.onDone}>Cancel</button>
        <span style={{ fontSize: 11, opacity: 0.75 }}>
          {bound
            ? "the sentence above stays exactly as you wrote it"
            : s.promises
              ? `re-reads ${s.subjects} subject${s.subjects === 1 ? "" : "s"} and replaces ${s.promises} promise${s.promises === 1 ? "" : "s"}` +
                (s.alsoReads.length ? `, including work from ${s.alsoReads.length} other sentence(s)` : "")
              : "nothing has been derived from it yet"}
        </span>
      </div>
      {!bound && s.alsoReads.length ? (
        <div style={{ fontSize: 11, opacity: 0.7, marginTop: 3 }}>
          also re-read: {s.alsoReads.map((t) => `“${t}”`).join(" · ")}
        </div>
      ) : null}
    </div>
  );
}

export function Asks(props: {
  push: SpacePush;
  selected: string | null;
  onSelect: (id: string) => void;
  /** The ask whose editor is open — set from anywhere that reads FROM an
   *  ask, so a subject or a claim that reads wrong leads straight here. */
  editing: string | null;
  onEditing: (id: string | null) => void;
}): JSX.Element {
  const editing = props.editing;
  const setEditing = props.onEditing;
  if (!props.push.sentences.length) return <></>;
  return (
    <div
      data-sentences
      style={{ padding: "6px 12px 0", maxHeight: "16rem", overflowY: "auto" }}
    >
      <div style={{ ...label, marginBottom: 4 }}>
        Asks — what you wrote, kept word for word
      </div>
      {props.push.sentences.map((s, i) => (
        <section
          key={s.id}
          data-sentence={s.id}
          onClick={() => props.onSelect(s.id)}
          style={{
            border: "1px solid var(--vscode-panel-border, #3c3c3c)",
            borderLeft: `3px solid ${s.state === "bound" ? "#666" : "#4ec9b0"}`,
            background:
              props.selected === s.id
                ? "var(--vscode-list-inactiveSelectionBackground, #2a2d2e)"
                : undefined,
            cursor: "pointer",
            borderRadius: 5,
            padding: "7px 9px",
            marginBottom: 8,
          }}
        >
          {s.amends ? (
            <div style={aside}>
              supersedes: “{s.amends}”
            </div>
          ) : null}
          <div style={{ fontSize: 12 }}>
            <span style={{ opacity: 0.55, marginRight: 4 }}>#{i + 1}</span>
            {s.text}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginTop: 4 }}>
            <span style={{ fontSize: 11, opacity: 0.7 }}>
              {s.state === "bound"
                ? `built${s.tep ? ` as ${s.tep}` : ""} — these words are part of the record now`
                : `${s.promises} promise${s.promises === 1 ? "" : "s"} read from this ask`}
            </span>
            {editing === s.id ? null : (
              <button
                data-edit-sentence={s.id}
                title={
                  s.state === "bound"
                    ? "Built work only changes through new work — add an amendment."
                    : "Say this ask differently and I will read it again."
                }
                aria-label={s.state === "bound" ? "amend this ask" : "say this ask differently"}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "inherit",
                  fontSize: 13,
                  padding: "0 3px",
                  lineHeight: 1,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(s.id);
                }}
              >
                {s.state === "bound" ? "＋" : "✎"}
              </button>
            )}
          </div>
          {editing === s.id ? <Editor s={s} onDone={() => setEditing(null)} /> : null}
          {s.assumptions.length ? (
            <div style={{ marginTop: 6 }}>
              <div style={{ ...labelIn("#e5c07b") }}>
                Assumed{" "}
                <span>
                  — decided in this ask&apos;s name; recorded when you build
                </span>
              </div>
              {s.assumptions.map((a, i) => (
                <div key={i} style={{ fontSize: 12, marginTop: 5 }}>
                  <div style={{ opacity: 0.75 }}>{a.question}</div>
                  <div style={{ paddingLeft: 8, borderLeft: "2px solid #e5c07b" }}>
                    {a.answer}
                    {a.assumed ? (
                      <span style={{ fontSize: 10, opacity: 0.6 }}> — assumed, you did not say this</span>
                    ) : null}
                  </div>
                  {a.clause ? (
                    <div style={aside}>
                      your ask did not say: {a.clause}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}
