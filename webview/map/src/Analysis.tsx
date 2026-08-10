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
 * The colour is a convenience. The subject's number and name are on the
 * mark itself, so nothing here depends on telling two hues apart.
 */
import { C, FS, label, O, SP, raised } from "./type";
import { SpacePush } from "./vscode";

type Model = NonNullable<SpacePush["pendingModel"]>;

/** Six hues that stay apart from each other under the common forms of
 *  colour blindness. Past six, the number carries it alone. */
const HUES = ["#3794ff", "#4ec9b0", "#e5c07b", "#c586c0", "#ce9178", "#9cdcfe"];
const hue = (i: number): string => HUES[i % HUES.length];

interface Mark {
  at: number;
  to: number;
  subject: number;
  claim: string;
  mention?: string;
  replaces?: string;
}

/** Where each claim's words sit in the sentence it was read from. A quote
 *  that is not in the sentence verbatim is not placed at all — a mark in
 *  the wrong place is worse than no mark. */
function marksFor(model: Model, sentence: number): Mark[] {
  const text = model.texts[sentence - 1] ?? "";
  const out: Mark[] = [];
  model.subjects.forEach((s, si) => {
    for (const c of s.claims) {
      if (c.from !== sentence || !c.quote) continue;
      const at = text.indexOf(c.quote);
      if (at < 0) continue;
      out.push({
        at,
        to: at + c.quote.length,
        subject: si,
        claim: c.text,
        ...(c.mention !== undefined ? { mention: c.mention } : {}),
        ...(c.replaces ? { replaces: c.replaces } : {}),
      });
    }
  });
  // Overlapping marks would nest; the first one wins and the rest are
  // dropped rather than drawn on top of each other.
  const kept: Mark[] = [];
  for (const m of out.sort((a, b) => a.at - b.at || b.to - a.to))
    if (!kept.some((k) => m.at < k.to && k.at < m.to)) kept.push(m);
  return kept;
}

function Sentence(props: { model: Model; n: number }): JSX.Element {
  const text = props.model.texts[props.n - 1] ?? "";
  const marks = marksFor(props.model, props.n);
  const parts: JSX.Element[] = [];
  let at = 0;
  marks.forEach((m, i) => {
    if (m.at > at)
      parts.push(
        <span key={`plain-${i}`} style={{ opacity: O.dim }}>
          {text.slice(at, m.at)}
        </span>,
      );
    const color = hue(m.subject);
    parts.push(
      <span
        key={`mark-${i}`}
        data-claim-mark={m.claim}
        title={`${props.model.subjects[m.subject].name} — ${m.claim}`}
        style={{
          background: `${color}26`,
          borderBottom: `2px solid ${color}`,
          padding: "1px 0",
        }}
      >
        {text.slice(m.at, m.to)}
        {m.mention !== undefined ? (
          <em
            data-implicit-subject
            style={{ color, fontStyle: "italic", marginLeft: SP.xs }}
          >
            [{props.model.subjects[m.subject].name}]
          </em>
        ) : null}
      </span>,
    );
    at = m.to;
  });
  if (at < text.length)
    parts.push(
      <span key="plain-end" style={{ opacity: O.dim }}>
        {text.slice(at)}
      </span>,
    );
  return (
    <div data-sentence-marked={props.n} style={{ fontSize: FS.body, lineHeight: 1.7, marginTop: SP.sm }}>
      <span style={{ color: C.quiet, marginRight: SP.sm }}>#{props.n}</span>
      {parts.length ? parts : <span style={{ opacity: O.dim }}>{text}</span>}
    </div>
  );
}

export function Analysis(props: {
  model: Model;
  /** The reading is behind the words: it was read from other text. */
  behind: boolean;
  onKeep: () => void;
  onRead: () => void;
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
            {s.name} · {s.claims.length} claim{s.claims.length === 1 ? "" : "s"}
          </span>
        ))}
      </div>

      <div style={{ ...raised, padding: `${SP.sm}px ${SP.md}px` }}>
        {model.texts.map((_, i) => (
          <Sentence key={i} model={model} n={i + 1} />
        ))}
      </div>

      <div style={{ fontSize: FS.caption, color: C.quiet, marginTop: SP.sm }}>
        Marked words became a claim. Anything unmarked was read as nothing — if that is a
        mistake, say the sentence differently above.
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

      <div style={{ display: "flex", gap: SP.md, alignItems: "center", marginTop: SP.md }}>
        {props.behind ? (
          <>
            <button data-read-again style={{ fontWeight: 600 }} onClick={props.onRead}>
              Read it again
            </button>
            <span style={{ fontSize: FS.caption, color: C.ask }}>
              you have changed the words since this was read — it cannot be kept until it matches
            </span>
          </>
        ) : (
          <>
            <button data-keep-draft style={{ fontWeight: 600 }} onClick={props.onKeep}>
              Keep {model.fresh.length} ask{model.fresh.length === 1 ? "" : "s"}
            </button>
            <span style={{ fontSize: FS.caption, color: C.quiet }}>
              recorded word for word · costs nothing · nothing is built yet
            </span>
          </>
        )}
      </div>
    </section>
  );
}
