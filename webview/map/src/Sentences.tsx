/**
 * Your sentences, and everything decided in their name.
 *
 * When something grates, this is the one place to come: each sentence
 * carries what was assumed under it and which part of it was silent, so
 * the thing to fix is never more than a glance away. A sentence still open
 * is rewritten here, at a price stated before it is paid. A sentence whose
 * work is built cannot be rewritten — changing built software is new work
 * — so it takes an amendment instead.
 */
import { useState } from "react";
import { post, SpacePush } from "./vscode";

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
              ? `re-reads ${s.subjects} object${s.subjects === 1 ? "" : "s"} and replaces ${s.promises} promise${s.promises === 1 ? "" : "s"}` +
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

export function Sentences(props: {
  push: SpacePush;
  selected: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const [editing, setEditing] = useState<string | null>(null);
  if (!props.push.sentences.length)
    return <div style={{ padding: 12, opacity: 0.7, fontSize: 12 }}>Nothing written yet.</div>;
  return (
    <div data-sentences style={{ padding: 12, overflowY: "auto" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", opacity: 0.7, marginBottom: 6 }}>
        Asks <span style={{ textTransform: "none" }}>— what you wrote, kept word for word</span>
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
            <div style={{ fontSize: 11, opacity: 0.7, fontStyle: "italic" }}>
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
                    : "Say it differently and I will read it again."
                }
                onClick={() => setEditing(s.id)}
              >
                {s.state === "bound" ? "Amend" : "Say it differently"}
              </button>
            )}
          </div>
          {editing === s.id ? <Editor s={s} onDone={() => setEditing(null)} /> : null}
          {s.assumptions.length ? (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", color: "#e5c07b" }}>
                Assumed{" "}
                <span style={{ textTransform: "none" }}>
                  — decided in this ask&apos;s name; becomes a rule when you build
                </span>
              </div>
              {s.assumptions.map((a, i) => (
                <div key={i} style={{ fontSize: 12, marginTop: 2 }}>
                  {a.text}
                  {a.clause ? (
                    <div style={{ fontSize: 11, opacity: 0.7, fontStyle: "italic" }}>
                      your sentence did not say: {a.clause}
                    </div>
                  ) : null}
                  {a.assumed ? (
                    <span style={{ fontSize: 10, opacity: 0.6 }}> — assumed, you did not say this</span>
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
