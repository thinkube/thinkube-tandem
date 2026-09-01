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
import { MarkLegend, Marked, NamesNothing } from "./Marked";
import type { ReadSubject } from "../../../src/derive/marks";

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

  // What was read from each sentence, in the shape that marks it. The words
  // and their marks belong together: the reading used to be shown a second
  // time below, in the machine's arrangement, which is how the same nine
  // sentences came to be on one page twice.
  const read: ReadSubject[] = (props.push.subjects ?? []).map((sub) => ({
    name: sub.name,
    claims: sub.claims.map((c) => ({
      text: c.text,
      from: c.fromAskN,
      ...(c.quote ? { quote: c.quote } : {}),
      ...(c.mention !== undefined ? { mention: c.mention } : {}),
    })),
  }));
  const names = read.map((r) => r.name);
  // A sentence every claim of which stands in for its subject by a pronoun,
  // or by nothing at all, says nothing about what it is about. It will
  // derive badly, and this is the only warning before it does.
  const namesNothing = new Set(
    props.push.sentences
      .map((_s, i) => i + 1)
      .filter((n) => {
        const mine = read.flatMap((r) => r.claims.filter((c) => c.from === n));
        // A reading kept before the wording was carried has no `mention` at
        // all, and saying "names nothing" about every one of those sentences
        // is a false alarm on every space read before today. Only a reading
        // that RECORDED what stood for the subject can say it stood for
        // nothing.
        const recorded = mine.filter((c) => c.mention !== undefined);
        return (
          recorded.length > 0 &&
          recorded.every((c) => !c.mention || /^(it|its|they|them|their|this|that|these|those|one|ones)$/i.test(c.mention.trim()))
        );
      }),
  );
  return (
    <div
      data-sentences
      style={{
        padding: `${SP.sm}px ${SP.lg}px 0`,
        // The asks are CONTENT sharing the column with the page, not a
        // header sitting above it. Left to its natural height this list
        // grew to seventeen hundred pixels in an eight hundred pixel
        // column and took every one of them: each page below it was laid
        // out at zero height and pushed off the bottom of the window, so
        // the whole surface read as one strip of asks and nothing else.
        // It shrinks and scrolls; the page keeps its share.
        flex: "0 1 auto",
        minHeight: 0,
        maxHeight: "38%",
        overflowY: "auto",
      }}
    >
      <div style={{ ...label, marginBottom: 4 }}>
        Asks — what you wrote, kept word for word
      </div>
      {read.length ? <MarkLegend /> : null}
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
          <div style={{ fontSize: FS.body, lineHeight: 1.9 }}>
            <span style={{ opacity: O.faint, marginRight: 4 }}>#{i + 1}</span>
            <Marked text={s.text} subjects={read} names={names} n={i + 1} />
            {namesNothing.has(i + 1) ? <NamesNothing /> : null}
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
          {/* Folded. Eight assumptions under one ask ran taller than the ask
              itself and pushed the next sentence off the screen, so the page
              led with what the machine decided and buried what you wrote.
              They are one line until you want them. */}
          {s.assumptions.length ? (
            <details style={{ marginTop: 6 }}>
              <summary
                data-assumptions={s.id}
                style={{ ...labelIn(C.ask), cursor: "pointer", width: "fit-content", listStyle: "revert" }}
              >
                {s.assumptions.length} thing{s.assumptions.length === 1 ? "" : "s"} decided in this
                ask&apos;s name{" "}
                <span style={{ opacity: O.dim }}>— recorded when you build</span>
              </summary>
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
            </details>
          ) : null}
        </section>
      ))}
    </div>
  );
}
