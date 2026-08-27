/**
 * Where you write your asks.
 *
 * A thinking space is a list of asks, so the box you write it in is a
 * list too: ONE LINE IS ONE ASK. Nothing decides that for you and nothing
 * asks you to confirm it — you see it, in the text you are typing, as you
 * type it. Each ask is tinted along its whole height and numbered in the
 * margin, so a line that wraps over four rows still reads as one thing.
 * Merging two asks is deleting a newline; splitting one is adding one.
 *
 * The number in the margin is what says which ask is which; the tint only
 * makes the boundary quick to see, and alternates rather than meaning
 * anything, so nothing is lost by not separating the two colours.
 *
 * Nothing is recorded until you press Record.
 */
import { useEffect, useRef, useState } from "react";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  gutter,
  GutterMarker,
  keymap,
  placeholder,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { C, FS, SP } from "./type";
import { askOfLine, asksOfText } from "../../../src/derive/asks";

const even = Decoration.line({ attributes: { class: "tk-ask tk-ask-even" } });
const odd = Decoration.line({ attributes: { class: "tk-ask tk-ask-odd" } });

function tint(view: EditorView): DecorationSet {
  const map = askOfLine(view.state.doc.toString());
  const b = new RangeSetBuilder<Decoration>();
  for (let i = 1; i <= view.state.doc.lines; i++) {
    const n = map[i - 1];
    if (!n) continue;
    b.add(view.state.doc.line(i).from, view.state.doc.line(i).from, n % 2 ? odd : even);
  }
  return b.finish();
}

const tinting = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = tint(view);
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged) this.decorations = tint(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

/** `#3` beside the first row of each ask, and nothing beside its wrapped
 *  rows or the blank lines between. */
class AskMarker extends GutterMarker {
  constructor(private readonly n: number) {
    super();
  }
  toDOM(): Node {
    return document.createTextNode(`#${this.n}`);
  }
}

const numbers = gutter({
  class: "tk-asks-gutter",
  lineMarker: (view, line) => {
    const map = askOfLine(view.state.doc.toString());
    const no = view.state.doc.lineAt(line.from).number;
    const n = map[no - 1];
    if (!n) return null;
    // Only the FIRST line of an ask is numbered — the rest are the same ask.
    return map[no - 2] === n ? null : new AskMarker(n);
  },
});

const look = EditorView.theme({
  "&": {
    fontSize: `${FS.body}px`,
    border: `1px solid var(--vscode-input-border, #444)`,
    borderRadius: "6px",
    background: "var(--vscode-input-background, #222)",
    color: "var(--vscode-input-foreground, #ddd)",
    maxHeight: "14rem",
  },
  "&.cm-focused": { outline: `1px solid ${C.focus}` },
  ".cm-content": { fontFamily: "inherit", padding: `${SP.sm}px 0` },
  ".cm-line": { padding: `1px ${SP.md}px` },
  // Each ask is a band you can see at a glance: a tint across its whole
  // height and a stripe down its left edge, so the boundary reads even
  // where a background this quiet would not.
  ".tk-ask": { borderLeft: "3px solid transparent" },
  ".tk-ask-odd": { background: "#3794ff26", borderLeftColor: "#3794ff" },
  ".tk-ask-even": { background: "#4ec9b026", borderLeftColor: "#4ec9b0" },
  ".tk-asks-gutter": {
    color: C.quiet,
    fontSize: `${FS.caption}px`,
    minWidth: "2.4rem",
    paddingRight: SP.sm,
    textAlign: "right",
  },
  ".cm-scroller": { overflow: "auto", lineHeight: 1.5 },
});

export function Compose(props: {
  /** What is written, kept as it is written — this is called on every
   *  change, so closing the window mid-sentence loses nothing. */
  onChange: (text: string) => void;
  /** Read these words: what are they about? One round, as often as asked. */
  onRead: () => void;
  /** What the space already holds — the words you left last time. */
  initial: string;
  /** No writing while the machine is working. */
  busy: boolean;
  /** Whether reading is allowed in this phase; when off, the reason. */
  canRead: boolean;
  whyNotRead?: string;
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>();
  const canReadRef = useRef(props.canRead);
  canReadRef.current = props.canRead;
  const [count, setCount] = useState(asksOfText(props.initial).length);
  // The callbacks the keymap closes over must always be the latest ones.
  const read = useRef(props.onRead);
  read.current = props.onRead;
  const changed = useRef(props.onChange);
  changed.current = props.onChange;

  useEffect(() => {
    if (!host.current || view.current) return;
    const commit = (): boolean => {
      if (canReadRef.current) read.current();
      return true;
    };
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: props.initial,
        extensions: [
          history(),
          EditorView.lineWrapping,
          placeholder("Say what you want built — one ask per line, kept word for word."),
          tinting,
          numbers,
          look,
          keymap.of([
            { key: "Mod-Enter", run: commit },
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            const text = u.state.doc.toString();
            setCount(asksOfText(text).length);
            changed.current(text);
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = undefined;
    };
  }, []);

  useEffect(() => {
    view.current?.contentDOM.setAttribute("contenteditable", props.busy ? "false" : "true");
  }, [props.busy]);

  return (
    <div data-compose style={{ flexBasis: "100%", minWidth: 0 }}>
      <div ref={host} data-compose-editor />
      <div style={{ display: "flex", gap: SP.md, alignItems: "center", marginTop: SP.sm }}>
        <button
          data-read-draft
          disabled={!count || props.busy || !props.canRead}
          style={{ fontWeight: 600 }}
          title={
            props.canRead
              ? "Read these words: what are they about? Nothing is recorded and nothing is built."
              : props.whyNotRead ?? "Not now."
          }
          onClick={() => props.onRead()}
        >
          {count ? `Read ${count} ask${count === 1 ? "" : "s"}` : "Read"}
        </button>
        <span style={{ fontSize: FS.caption, color: C.quiet }}>
          one line is one ask · Enter starts another · Ctrl+Enter reads · nothing is recorded by
          reading
        </span>
      </div>
    </div>
  );
}
