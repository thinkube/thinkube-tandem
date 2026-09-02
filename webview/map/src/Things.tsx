/**
 * What your sentences became: the things to build, in the order to build
 * them, each carrying the sentences of yours it was read from.
 *
 * Your words are the content of this page, not a header above it. Each
 * sentence appears once, inside the thing it belongs to, marked where it
 * was read — what it is about, and what must become true of it. The
 * machine's own reasoning is folded behind one quiet line per thing, never
 * stacked above your words. Nothing here is relabelled and nothing is
 * repeated: the sentence with its marks IS the reading.
 */
import { can, post, refusalSentence, SpacePush } from "./vscode";
import { C, FS, O, SP, label } from "./type";
import { MarkLegend } from "./Marked";
import { namesNothing, readingOf, SentenceRow } from "./Asks";
import { setsInOrder } from "../../../src/surfaces/nextAction";

type Sentence = SpacePush["sentences"][number];
type Set = NonNullable<SpacePush["specs"]>[number];

/** The word on a thing: where it sits in the order, or that it is done. */
function whenWord(i: number, sp: Set, count: number): string {
  if (sp.built) return "built";
  if (i === 0) return "first";
  return i === count - 1 ? "later" : "then";
}

/** What a thing carries, said before it is built. */
function sizeWords(sp: Set): string {
  const carries = sp.asks?.length
    ? `${sp.asks.length} of your ${sp.asks.length === 1 ? "sentence" : "sentences"}`
    : `${sp.subjects} subject${sp.subjects === 1 ? "" : "s"}`;
  const state = sp.promises
    ? `${sp.promises} promise${sp.promises === 1 ? "" : "s"}`
    : "not worked out yet";
  const lands = sp.repos.length > 1 ? ` · in ${sp.repos.join(" and ")}` : "";
  return `${carries} · ${state}${lands}${sp.chosen ? " · in the cut" : ""}`;
}

/**
 * The subjects of a thing being worked out right now, with how far each
 * has got. Drawn under the thing's header while it is happening, so the
 * page says where the work is instead of going quiet until it is done.
 */
function Thinking(props: { push: SpacePush; asks: number[] }): JSX.Element | null {
  const mine = props.push.subjects.filter(
    (sub) => sub.thinking && sub.from.some((f) => props.asks.includes(f.n)),
  );
  if (!mine.length) return null;
  return (
    <div data-thinking-subjects style={{ padding: `${SP.sm}px ${SP.lg}px 0`, display: "flex", flexDirection: "column", gap: SP.xs }}>
      {mine.map((sub) => {
        const t = sub.thinking!;
        const pct = t.total ? Math.round((t.current / t.total) * 100) : 0;
        return (
          <div key={sub.id} data-thinking-subject={sub.id} style={{ display: "flex", alignItems: "center", gap: SP.md, fontSize: FS.caption, color: C.quiet }}>
            <span className="tandem-spin" style={{ display: "inline-block" }}>⟳</span>
            <span style={{ whiteSpace: "nowrap" }}>
              {sub.name} — {t.label} · {t.current} of {t.total}
            </span>
            <span style={{ flex: 1, height: 4, background: "var(--vscode-input-background, #222)", borderRadius: 2, overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${pct}%`, background: C.live, transition: "width 300ms" }} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** What the machine decided in the name of these sentences, folded. */
function Decided(props: { sentences: Sentence[]; id: string }): JSX.Element | null {
  const decided = props.sentences.flatMap((s) => s.assumptions.map((a) => ({ ...a, n: s.id })));
  if (!decided.length) return null;
  return (
    <details style={{ margin: `${SP.sm}px 0 0 38px` }}>
      <summary
        data-assumptions={props.id}
        style={{ cursor: "pointer", fontSize: FS.caption, color: C.quiet, width: "fit-content", listStyle: "revert" }}
      >
        {decided.length} thing{decided.length === 1 ? "" : "s"} I decided for you
      </summary>
      {decided.map((a, i) => (
        <div
          key={i}
          style={{
            fontSize: FS.body,
            lineHeight: 1.5,
            padding: `${SP.sm}px 0 ${SP.sm}px ${SP.md}px`,
            borderLeft: `2px solid ${C.border}`,
            marginTop: SP.sm,
          }}
        >
          {a.answer}
          {a.assumed ? <span style={{ color: C.quiet }}> — assumed, you did not say this</span> : null}
          <div style={{ color: C.quiet, fontSize: FS.caption }}>{a.question}</div>
        </div>
      ))}
    </details>
  );
}

export function Things(props: {
  push: SpacePush;
  selected: string | null;
  onSelect: (id: string) => void;
  editing: string | null;
  onEditing: (id: string | null) => void;
}): JSX.Element {
  const { push } = props;
  const read = readingOf(push);
  const names = read.map((r) => r.name);
  const flagged = namesNothing(push, read);
  const sets = setsInOrder(push);
  const sentences = push.sentences;
  const row = (s: Sentence, i: number): JSX.Element => (
    <SentenceRow
      key={s.id}
      s={s}
      n={i + 1}
      read={read}
      names={names}
      namesNothing={flagged.has(i + 1)}
      phase={push.phase}
      selected={props.selected === s.id}
      onSelect={() => props.onSelect(s.id)}
      editing={props.editing === s.id}
      onEditing={props.onEditing}
    />
  );
  const inSome = new Set(sets.flatMap((sp) => sp.asks ?? []));
  const elsewhere = sentences.map((s, i) => [s, i] as const).filter(([, i]) => !inSome.has(i + 1));

  return (
    <div data-things style={{ flex: 1, overflowY: "auto", padding: `${SP.lg}px ${SP.lg}px 56px` }}>
      <div style={{ ...label, marginTop: 0 }}>
        {sets.length
          ? `Your ${sentences.length} sentence${sentences.length === 1 ? "" : "s"} became ${sets.length} thing${sets.length === 1 ? "" : "s"}`
          : `Your ${sentences.length} sentence${sentences.length === 1 ? "" : "s"}, as they were read`}
      </div>
      {read.length ? <MarkLegend /> : null}

      {sets.length ? (
        <div data-sets style={{ display: "flex", flexDirection: "column", gap: SP.lg }}>
          {sets.map((sp, i) => {
            const first = i === 0 && !sp.built;
            const mine = (sp.asks ?? []).map((n) => sentences[n - 1]).filter(Boolean);
            return (
              <section
                key={sp.id}
                data-thing={sp.id}
                style={{
                  border: `1px solid ${sp.chosen ? C.ok : C.border}`,
                  borderRadius: 7,
                  overflow: "hidden",
                  opacity: sp.built ? O.dim : 1,
                }}
              >
                <button
                  data-choose-set={sp.id}
                  disabled={!can("choose-set") || sp.built}
                  title={
                    sp.built
                      ? "This is built — its promises are signed."
                      : can("choose-set")
                        ? "Work this out and put it in the cut: it is what the next delivery contains."
                        : refusalSentence("choose-set", push.phase)
                  }
                  onClick={() => post({ action: "choose-set", specId: sp.id })}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: SP.md,
                    flexWrap: "wrap",
                    width: "100%",
                    textAlign: "left",
                    padding: `${SP.md}px ${SP.lg}px`,
                    background: sp.chosen ? "#4ec9b014" : C.raised,
                    borderWidth: "0 0 1px 0",
                    borderStyle: "solid",
                    borderColor: C.border,
                    color: "inherit",
                    cursor: sp.built ? "default" : "pointer",
                  }}
                >
                  <span
                    data-set-when
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      padding: "2px 8px",
                      borderRadius: 999,
                      border: `1px solid ${first ? C.ok : C.border}`,
                      background: first ? C.ok : "transparent",
                      color: first ? "#10231e" : C.quiet,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {whenWord(i, sp, sets.length)}
                  </span>
                  <span style={{ fontSize: FS.title, fontWeight: 650 }}>{sp.name}</span>
                  <span data-set-asks style={{ marginLeft: "auto", fontSize: FS.caption, color: C.quiet }}>
                    {sizeWords(sp)}
                  </span>
                </button>
                <Thinking push={push} asks={sp.asks ?? []} />
                {mine.length ? (
                  <div style={{ padding: `${SP.sm}px ${SP.md}px ${SP.md}px` }}>
                    {mine.map((s) => row(s, sentences.indexOf(s)))}
                    <Decided sentences={mine} id={sp.id} />
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "baseline", gap: SP.sm, marginBottom: SP.md }}>
          <button
            data-group-into-sets
            disabled={!can("group-into-sets")}
            title={can("group-into-sets") ? undefined : refusalSentence("group-into-sets", push.phase)}
            style={{ fontWeight: 600 }}
            onClick={() => post({ action: "group-into-sets" })}
          >
            Group into things to build
          </button>
          <span style={{ fontSize: FS.caption, color: C.quiet }}>
            so each one can be built and looked at on its own, instead of all of it at once
          </span>
        </div>
      )}

      {elsewhere.length ? (
        <div data-sentences style={{ marginTop: sets.length ? SP.lg : 0 }}>
          {sets.length ? (
            <div style={label}>Not in any of these</div>
          ) : null}
          {elsewhere.map(([s, i]) => row(s, i))}
          {sets.length ? null : <Decided sentences={sentences} id="all" />}
        </div>
      ) : null}
    </div>
  );
}
