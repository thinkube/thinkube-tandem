/**
 * Your sentence, with the reading marked inside it.
 *
 * One drawing of this, used wherever your words appear. The reading screen
 * drew it one way and the intent page did not draw it at all — the intent
 * page put your sentence in one box and then repeated everything read from
 * it underneath, in the machine's arrangement, so the same nine sentences
 * appeared twice on one page in two visual languages.
 *
 * The marks are not decoration and not machine vocabulary: they are what
 * tells you, while you can still change the words, that a sentence names
 * nothing the machine could find. That sentence will derive badly, and the
 * mark is the only warning you get.
 *
 * Two marks and a legend, never a label per mark: what the sentence is
 * ABOUT is tinted, what must BECOME TRUE of it is underlined. The tint
 * carries which subject through its hue; the words say what the marks mean
 * once, above, rather than a tag hanging off every span.
 */
import { markSentence, type Piece, type ReadSubject } from "../../../src/derive/marks";
import { C, FS, O, SP } from "./type";

/** Six hues that stay apart under the common forms of colour blindness.
 *  Past six the subject's number carries it, never the hue alone. */
const HUES = ["#3794ff", "#4ec9b0", "#e5c07b", "#c586c0", "#ce9178", "#9cdcfe"];
const hueOf = (i: number): string => HUES[i % HUES.length];

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
            title={`what this is about: ${props.names[p.subject]}`}
            style={{
              background: `${hueOf(p.subject)}38`,
              fontWeight: 600,
              borderRadius: 3,
              padding: "1px 2px",
            }}
          >
            {p.text}
          </span>
        ),
      )}
    </>
  );
}

/**
 * One sentence, marked. `n` is its position in the person's own list, which
 * is what every claim points back at.
 */
export function Marked(props: {
  text: string;
  subjects: readonly ReadSubject[];
  names: string[];
  n: number;
}): JSX.Element {
  const marked = markSentence(props.text, props.subjects, props.n);
  return (
    <>
      {marked.parts.map((p, i) =>
        p.kind === "plain" ? (
          <Named key={i} pieces={p.pieces} names={props.names} keyBase={`p${i}`} />
        ) : (
          <span
            key={i}
            data-span="claim"
            title={`what must become true: ${p.claim}`}
            style={{ borderBottom: `2px solid ${hueOf(p.subject)}`, paddingBottom: 1 }}
          >
            <Named pieces={p.pieces} names={props.names} keyBase={`c${i}`} />
            {p.writeIn ? (
              <em data-implicit-subject style={{ color: hueOf(p.subject), marginLeft: SP.xs }}>
                [{props.names[p.subject]}]
              </em>
            ) : null}
          </span>
        ),
      )}
    </>
  );
}

/** What the marks mean, said once. A legend beats a tag on every span:
 *  the tags were longer than some of the words they hung off. */
export function MarkLegend(): JSX.Element {
  return (
    <div data-mark-legend style={{ fontSize: FS.caption, color: C.quiet, marginBottom: SP.sm }}>
      <span style={{ background: `${HUES[0]}38`, fontWeight: 600, borderRadius: 3, padding: "1px 3px" }}>
        what it is about
      </span>
      <span style={{ margin: "0 6px", opacity: O.faint }}>·</span>
      <span style={{ borderBottom: `2px solid ${HUES[0]}`, paddingBottom: 1 }}>
        what must become true of it
      </span>
      <span style={{ marginLeft: 8, opacity: O.dim }}>— your words, marked where you wrote them</span>
    </div>
  );
}

/** A sentence nothing could be read from names nothing the machine found,
 *  and will derive badly. Said here, while the words can still change. */
export function NamesNothing(): JSX.Element {
  return (
    <span
      data-names-nothing
      title="Nothing in this sentence says what it is about, so the machine had to infer it from the sentences around it."
      style={{
        fontSize: 10,
        marginLeft: 8,
        whiteSpace: "nowrap",
        color: C.ask,
        border: `1px solid ${C.ask}`,
        borderRadius: 999,
        padding: "0 6px",
      }}
    >
      names nothing
    </span>
  );
}
