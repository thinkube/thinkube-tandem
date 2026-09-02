/**
 * One of your sentences, drawn with the reading marked inside it.
 *
 * Your words appear once, where the reading put them — inside the thing
 * they were read into — and nowhere else. Each carries its marks, what it
 * is about and what must become true of it, and a pencil: disliking what
 * was read is reason enough to say the sentence differently. An open ask
 * is rewritten in place, at a price stated before it is paid. An ask whose
 * work is built cannot be rewritten — changing built software is new work —
 * so it takes an amendment instead.
 */
import { useState } from "react";
import { can, post, refusalSentence, SpacePush } from "./vscode";
import { C, FS, O, SAID, SP, aside } from "./type";
import { Marked, NamesNothing } from "./Marked";
import type { ReadSubject } from "../../../src/derive/marks";

type Sentence = SpacePush["sentences"][number];

/** The reading, in the shape that marks a sentence. */
export function readingOf(push: SpacePush): ReadSubject[] {
  return (push.subjects ?? []).map((sub) => ({
    name: sub.name,
    claims: sub.claims.map((c) => ({
      text: c.text,
      from: c.fromAskN,
      ...(c.quote ? { quote: c.quote } : {}),
      ...(c.mention !== undefined ? { mention: c.mention } : {}),
    })),
  }));
}

/**
 * The sentences, by number, that name nothing: every claim read from one
 * stands in for its subject by a pronoun or by nothing at all. Such a
 * sentence will derive badly, and this is the only warning before it does.
 * Only a reading that RECORDED what stood for the subject can say so.
 */
export function namesNothing(push: SpacePush, read: ReadSubject[]): Set<number> {
  return new Set(
    push.sentences
      .map((_s, i) => i + 1)
      .filter((n) => {
        const recorded = read
          .flatMap((r) => r.claims.filter((c) => c.from === n))
          .filter((c) => c.mention !== undefined);
        return (
          recorded.length > 0 &&
          recorded.every(
            (c) => !c.mention || /^(it|its|they|them|their|this|that|these|those|one|ones)$/i.test(c.mention.trim()),
          )
        );
      }),
  );
}

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

/** One sentence: its number, its words with the marks, its pencil. */
export function SentenceRow(props: {
  s: Sentence;
  n: number;
  read: ReadSubject[];
  names: string[];
  namesNothing: boolean;
  phase: SpacePush["phase"];
  selected: boolean;
  onSelect: () => void;
  editing: boolean;
  onEditing: (id: string | null) => void;
}): JSX.Element {
  const { s } = props;
  const bound = s.state === "bound";
  const action = bound ? "amend" : "reframe";
  return (
    <section
      data-sentence={s.id}
      onClick={props.onSelect}
      style={{
        display: "grid",
        gridTemplateColumns: "26px 1fr auto",
        gap: SP.md,
        alignItems: "baseline",
        padding: `${SP.sm}px ${SP.md}px`,
        borderRadius: 6,
        background: props.selected ? "var(--vscode-list-inactiveSelectionBackground, #2a2d2e)" : undefined,
        cursor: "pointer",
      }}
    >
      <span style={{ fontSize: FS.caption, color: C.quiet, fontVariantNumeric: "tabular-nums" }}>{props.n}</span>
      <span style={{ fontFamily: SAID, fontSize: FS.heading, lineHeight: 1.5 }}>
        <Marked text={s.text} subjects={props.read} names={props.names} n={props.n} />
        {props.namesNothing ? <NamesNothing /> : null}
        {s.amends ? <div style={aside}>supersedes: “{s.amends}”</div> : null}
        {bound ? <div style={aside}>{boundWords(s.bound)}</div> : null}
        {props.editing ? <Editor s={s} phase={props.phase} onDone={() => props.onEditing(null)} /> : null}
      </span>
      {props.editing ? (
        <span />
      ) : (
        <button
          data-edit-sentence={s.id}
          disabled={!can(action)}
          title={
            !can(action)
              ? refusalSentence(action, props.phase)
              : bound
                ? "Approved work only changes through new work — add an amendment."
                : "Say this ask differently and I will read it again."
          }
          aria-label={bound ? "amend this ask" : "say this ask differently"}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "inherit",
            opacity: O.dim,
            fontSize: FS.body,
            padding: `0 ${SP.xs}px`,
            lineHeight: 1,
          }}
          onClick={(e) => {
            e.stopPropagation();
            props.onEditing(s.id);
          }}
        >
          {bound ? "＋" : "✎"}
        </button>
      )}
    </section>
  );
}
