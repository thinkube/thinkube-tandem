/**
 * Markdown, rendered.
 *
 * The delivery report is the one page read to make a decision, and a
 * decision is made faster from headed sections than from a block of
 * indented text. Only the shapes the reports actually use are understood
 * — headings, list items with one level of nesting, bold, code spans and
 * block quotes — and anything else arrives as the text it is.
 *
 * Nothing here interprets HTML. A report carries the human's own
 * sentences, so it can carry anything they typed; every character is
 * escaped before a single tag is added, and the tags are only ever the
 * ones this file writes.
 */
import { aside, C, FS, label, SP } from "./type";

type Block =
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "li"; depth: 0 | 1; text: string }
  | { kind: "quote"; text: string }
  | { kind: "p"; text: string };

/** The document, as blocks. Indented list items nest one level. */
function parse(md: string): Block[] {
  const out: Block[] = [];
  for (const raw of md.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      out.push({ kind: "h", level: h[1].length as 1 | 2 | 3, text: h[2] });
      continue;
    }
    const li = /^(\s*)[-*]\s+(.*)$/.exec(line);
    if (li) {
      out.push({ kind: "li", depth: li[1].length >= 2 ? 1 : 0, text: li[2] });
      continue;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      out.push({ kind: "quote", text: q[1] });
      continue;
    }
    out.push({ kind: "p", text: line.trim() });
  }
  return out;
}

/** `**bold**` and `` `code` `` inside a line — everything else is text. */
function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let at = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > at) out.push(text.slice(at, m.index));
    if (m[1] !== undefined) out.push(<strong key={`${keyBase}-${m.index}`}>{m[1]}</strong>);
    else
      out.push(
        <code
          key={`${keyBase}-${m.index}`}
          style={{
            font: `${FS.caption}px/1.4 var(--vscode-editor-font-family, monospace)`,
            background: "var(--vscode-textCodeBlock-background, #1e1e1e)",
            borderRadius: 3,
            padding: `1px ${SP.xs}px`,
          }}
        >
          {m[2]}
        </code>,
      );
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** A tick or a cross opening a line is what the line is — kept as a word
 *  would be, coloured only as a second cue on top of the mark itself. */
function Line(props: { text: string; k: string }): JSX.Element {
  const mark = /^([✓✗⚠])\s+/.exec(props.text);
  const rest = mark ? props.text.slice(mark[0].length) : props.text;
  const color = mark ? { "✓": C.ok, "✗": C.bad, "⚠": C.ask }[mark[1]] : undefined;
  return (
    <>
      {mark ? (
        <span style={{ color, fontWeight: 700, marginRight: SP.sm }}>{mark[1]}</span>
      ) : null}
      {inline(rest, props.k)}
    </>
  );
}

export function Markdown(props: { text: string }): JSX.Element {
  const blocks = parse(props.text);
  return (
    <div data-markdown style={{ fontSize: FS.body, lineHeight: 1.5 }}>
      {blocks.map((b, i) => {
        const k = `b${i}`;
        if (b.kind === "h")
          return b.level === 1 ? (
            <h1 key={k} style={{ fontSize: FS.heading, margin: `0 0 ${SP.sm}px`, fontWeight: 700 }}>
              {inline(b.text, k)}
            </h1>
          ) : b.level === 2 ? (
            <div key={k} style={{ ...label, marginTop: SP.lg }}>
              {b.text}
            </div>
          ) : (
            <h3 key={k} style={{ fontSize: FS.title, margin: `${SP.md}px 0 ${SP.xs}px`, fontWeight: 600 }}>
              {inline(b.text, k)}
            </h3>
          );
        if (b.kind === "li")
          return (
            <div
              key={k}
              style={{
                marginLeft: b.depth ? SP.lg : 0,
                marginTop: SP.xs,
                ...(b.depth ? { ...aside, fontSize: FS.caption } : {}),
              }}
            >
              <Line text={b.text} k={k} />
            </div>
          );
        if (b.kind === "quote")
          return (
            <blockquote
              key={k}
              style={{
                margin: `${SP.sm}px 0`,
                paddingLeft: SP.md,
                borderLeft: `2px solid ${C.border}`,
              }}
            >
              {inline(b.text, k)}
            </blockquote>
          );
        return (
          <p key={k} style={{ margin: `${SP.sm}px 0` }}>
            <Line text={b.text} k={k} />
          </p>
        );
      })}
    </div>
  );
}
