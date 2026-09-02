/**
 * Your own sentences, marked up with what was read from them.
 *
 * The question this page answers is the only one that matters before
 * anything is recorded: DID IT UNDERSTAND ME? A count of subjects cannot
 * answer that. Your words with the reading drawn on them can.
 *
 * Each claim is marked in its subject's colour over the exact words it
 * was read from. Where the sentence did not name the subject — a pronoun,
 * or nothing at all — the subject is written in beside it, so a reference
 * and the thing it points at are visibly the same. And whatever stays
 * unmarked is words nothing was read from, which is the part you would
 * otherwise only discover much later, as a question.
 *
 * The colour is a convenience. Every mark and every entry of the subject
 * key also carries the subject's label — S1, S2, S3 — as text a reader
 * can read, so nothing here depends on telling two hues apart.
 */
import { C, FS, label, O, SP, raised } from "./type";
import { SpacePush } from "./vscode";
import { markSentence, Piece, subjectKey } from "../../../src/derive/marks";

type Model = NonNullable<SpacePush["pendingModel"]>;

/** Six hues that stay apart from each other under the common forms of
 *  colour blindness. Past six, the number carries it alone. */
const HUES = ["#3794ff", "#4ec9b0", "#e5c07b", "#c586c0", "#ce9178", "#9cdcfe"];
const hue = (i: number): string => HUES[i % HUES.length];

/** A word on a mark saying what the mark IS — the colour is the second
 *  cue, never the first. The subject's own label goes with it, so the
 *  mark names which subject it is in words, not only in hue. */
function Tag(props: { text: string; color: string; subjectKey: string; title?: string }): JSX.Element {
  return (
    <span
      data-mark-tag={props.text}
      title={props.title}
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: props.color,
        border: `1px solid ${props.color}`,
        borderRadius: 3,
        padding: "0 3px",
        marginLeft: 3,
        whiteSpace: "nowrap",
        verticalAlign: "2px",
      }}
    >
      {props.subjectKey} {props.text}
    </span>
  );
}

/** The subject's own name where the sentence says it. */
function Named(props: { pieces: Piece[]; names: string[]; keyBase: string }): JSX.Element {
  return (
    <>
      {props.pieces.map((p, i) =>
        p.subject === undefined ? (
          <span key={`${props.keyBase}-${i}`}>{p.text}</span>
        ) : (
          <span
            key={`${props.keyBase}-${i}`}
            data-span="subject"
            title={`Subject: ${props.names[p.subject]}`}
            style={{
              background: `${hue(p.subject)}40`,
              fontWeight: 600,
              borderRadius: 3,
              padding: "1px 2px",
            }}
          >
            {p.text}
            <Tag text="subject" color={hue(p.subject)} subjectKey={subjectKey(p.subject)} title={props.names[p.subject]} />
          </span>
        ),
      )}
    </>
  );
}

function Sentence(props: { model: Model; n: number }): JSX.Element {
  const text = props.model.texts[props.n - 1] ?? "";
  const names = props.model.subjects.map((s) => s.name);
  const marked = markSentence(text, props.model.subjects, props.n);
  return (
    <div data-sentence-marked={props.n} style={{ fontSize: FS.body, lineHeight: 2.2, marginTop: SP.md }}>
      <span style={{ color: C.quiet, marginRight: SP.sm }}>#{props.n}</span>
      {marked.parts.map((p, i) =>
        p.kind === "plain" ? (
          <Named key={i} pieces={p.pieces} names={names} keyBase={`p${i}`} />
        ) : (
          <span
            key={i}
            data-span="claim"
            title={`${names[p.subject]} — ${p.claim}`}
            style={{ borderBottom: `2px solid ${hue(p.subject)}`, paddingBottom: 1 }}
          >
            <Named pieces={p.pieces} names={names} keyBase={`c${i}`} />
            {p.writeIn ? (
              <em data-implicit-subject style={{ color: hue(p.subject), marginLeft: SP.xs }}>
                [{names[p.subject]}]
              </em>
            ) : null}
            <Tag text="claim" color={hue(p.subject)} subjectKey={subjectKey(p.subject)} title={p.claim} />
          </span>
        ),
      )}
    </div>
  );
}

export function Analysis(props: {
  model: Model;
  /** The reading is behind the words: it was read from other text. */
  behind: boolean;
}): JSX.Element {
  const { model } = props;
  const replaced = model.subjects.flatMap((s) =>
    s.claims.filter((c) => c.replaces).map((c) => ({ subject: s.name, ...c })),
  );
  return (
    <section data-analysis style={{ marginTop: SP.lg, maxWidth: "56rem" }}>
      <div style={label}>What I read in your words</div>

      <div style={{ display: "flex", gap: SP.md, flexWrap: "wrap", marginBottom: SP.sm }}>
        {model.subjects.map((s, i) => (
          <span
            key={s.name}
            data-subject-key={s.name}
            style={{
              fontSize: FS.caption,
              borderLeft: `3px solid ${hue(i)}`,
              paddingLeft: SP.sm,
            }}
          >
            <strong>{subjectKey(i)}</strong> {s.name} · {s.claims.length} claim
            {s.claims.length === 1 ? "" : "s"}
          </span>
        ))}
      </div>

      <div style={{ ...raised, padding: `${SP.sm}px ${SP.md}px` }}>
        {model.texts.map((_, i) => (
          <Sentence key={i} model={model} n={i + 1} />
        ))}
      </div>

      <div style={{ fontSize: FS.caption, color: C.quiet, marginTop: SP.sm }}>
        <strong>subject</strong> — the thing a sentence is about · <strong>claim</strong> — what
        must become true of it · <em>[in brackets]</em> — the subject a sentence never names ·
        unmarked words were read as nothing.
      </div>

      {replaced.length ? (
        <div data-replaced style={{ marginTop: SP.sm }}>
          <div style={label}>What a later sentence displaced</div>
          {replaced.map((c, i) => (
            <div key={i} style={{ fontSize: FS.caption, color: C.quiet }}>
              “{c.text}” replaces “{c.replaces}” · {c.subject}
            </div>
          ))}
        </div>
      ) : null}

      {model.missing.length ? (
        <div data-unplaced style={{ marginTop: SP.sm, fontSize: FS.caption, color: C.bad }}>
          I could not say what {model.missing.length} of your sentences are about:{" "}
          {model.missing.join(" · ")}
        </div>
      ) : null}

      {props.behind ? (
        <div style={{ fontSize: FS.caption, color: C.ask, marginTop: SP.md }}>
          you have changed the words since this was read — it cannot be kept until it matches
        </div>
      ) : null}
    </section>
  );
}
