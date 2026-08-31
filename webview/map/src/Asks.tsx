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
import { can, post, refusalSentence, SpacePush } from "./vscode";
import { C, FS, O, SP, aside, label, labelIn } from "./type";

type Sentence = SpacePush["sentences"][number];

/**
 * What happened to an ask, said as what happened. Signing is approval and
 * nothing more: the run can refuse the plan and build nothing at all, and
 * a machine that reports its own intention as an accomplished fact is
 * lying about the one thing the human came to check.
 */
function boundWords(b: Sentence["bound"]): string {
  const as = b?.tep ? ` as ${b.tep}` : "";
  if (b?.stage === "accepted") return `built and accepted${as} — it is in the project`;
  if (b?.stage === "delivered") return `built${as} — delivered, waiting for you to accept it`;
  return `approved${as} — these words are part of the record now; nothing is built from them yet`;
}

function Editor(props: { s: Sentence; phase: SpacePush["phase"]; onDone: () => void }): JSX.Element {
  const { s } = props;
  const [text, setText] = useState(s.state === "bound" ? "" : s.text);
  const bound = s.state === "bound";
  const action = bound ? "amend" : "reframe";
  return (
    <div style={{ marginTop: 6 }}>
      <textarea
        data-sentence-editor={s.id}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        rows={3}
        style={{ width: "100%", fontSize: FS.body, fontFamily: "inherit" }}
        placeholder={bound ? "say what you want now — it supersedes the sentence above" : ""}
      />
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
        <button
          data-reframe={bound ? undefined : s.id}
          data-amend={bound ? s.id : undefined}
          disabled={!can(action)}
          title={can(action) ? undefined : refusalSentence(action, props.phase)}
          style={{ fontWeight: 600 }}
          onClick={() => {
            if (!text.trim()) return;
            post({ action, unitId: s.id, text });
            props.onDone();
          }}
        >
          {bound ? "Add this as an amendment" : "Say it this way instead"}
        </button>
        <button onClick={props.onDone}>Cancel</button>
        <span style={{ fontSize: FS.caption, opacity: O.dim }}>
          {bound
            ? "the sentence above stays exactly as you wrote it — it is approved work"
            : s.promises
              ? `re-reads ${s.subjects} subject${s.subjects === 1 ? "" : "s"} and replaces ${s.promises} promise${s.promises === 1 ? "" : "s"}` +
                (s.alsoReads.length ? `, including work from ${s.alsoReads.length} other sentence(s)` : "")
              : "nothing has been derived from it yet"}
        </span>
      </div>
      {!bound && s.alsoReads.length ? (
        <div style={{ fontSize: FS.caption, opacity: O.dim, marginTop: 3 }}>
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
      style={{ padding: `${SP.sm}px ${SP.lg}px 0` }}
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
            border: `1px solid ${C.border}`,
            borderLeft: `3px solid ${s.state === "bound" ? "#666" : C.ok}`,
            background:
              props.selected === s.id
                ? "var(--vscode-list-inactiveSelectionBackground, #2a2d2e)"
                : undefined,
            cursor: "pointer",
            borderRadius: 5,
            padding: `${SP.sm}px ${SP.md}px`,
            marginBottom: 8,
          }}
        >
          {s.amends ? (
            <div style={aside}>
              supersedes: “{s.amends}”
            </div>
          ) : null}
          <div style={{ fontSize: FS.body }}>
            <span style={{ opacity: O.faint, marginRight: 4 }}>#{i + 1}</span>
            {s.text}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginTop: 4 }}>
            <span style={{ fontSize: FS.caption, opacity: O.dim }}>
              {s.state === "bound"
                ? boundWords(s.bound)
                : `${s.promises} promise${s.promises === 1 ? "" : "s"} read from this ask`}
            </span>
            {editing === s.id ? null : (
              <button
                data-edit-sentence={s.id}
                disabled={!can(s.state === "bound" ? "amend" : "reframe")}
                title={
                  !can(s.state === "bound" ? "amend" : "reframe")
                    ? refusalSentence(s.state === "bound" ? "amend" : "reframe", props.push.phase)
                    : s.state === "bound"
                      ? "Approved work only changes through new work — add an amendment."
                      : "Say this ask differently and I will read it again."
                }
                aria-label={s.state === "bound" ? "amend this ask" : "say this ask differently"}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "inherit",
                  fontSize: FS.body,
                  padding: `0 ${SP.xs}px`,
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
          {editing === s.id ? (
            <Editor s={s} phase={props.push.phase} onDone={() => setEditing(null)} />
          ) : null}
          {s.assumptions.length ? (
            <div style={{ marginTop: 6 }}>
              <div style={{ ...labelIn(C.ask) }}>
                Assumed{" "}
                <span>
                  — decided in this ask&apos;s name; recorded when you build
                </span>
              </div>
              {s.assumptions.map((a, i) => (
                <div key={i} style={{ fontSize: FS.body, marginTop: 5 }}>
                  <div style={{ opacity: O.dim }}>{a.question}</div>
                  <div style={{ paddingLeft: 8, borderLeft: "2px solid #e5c07b" }}>
                    {a.answer}
                    {a.assumed ? (
                      <span style={{ fontSize: FS.caption, opacity: O.dim }}> — assumed, you did not say this</span>
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
