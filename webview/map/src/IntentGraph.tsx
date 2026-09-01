/**
 * The reading page: what I understood of what you wrote, before anything
 * costs money. One shape only — the SUBJECT — with the claims that must
 * become true of it listed inside, each carrying the ask it was read from.
 *
 * There is nothing here to accept and nothing to rearrange. If it reads
 * wrong you say the sentence differently, because a wrong reading is a
 * sentence that did not say enough. Going on to the work page is what
 * starts the thinking, and it says first what that will cost.
 */
import { can, post, refusalSentence, SpacePush } from "./vscode";
import { C, FS, O, SP, aside, label, labelIn } from "./type";

/**
 * Where a shape came from, and the way back. Every subject and claim
 * is read FROM an ask, so each one shows its number and a pencil that
 * opens that ask for rewriting — disliking what was read is reason enough,
 * and it is always available, not only when something was assumed.
 */
function FromAsk(props: {
  n: number;
  id: string;
  text: string;
  phase: SpacePush["phase"];
  onEditAsk: (id: string) => void;
}): JSX.Element {
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <span
        data-from-ask={props.id}
        title={`Read from your ask #${props.n}: ${props.text}`}
        style={{ opacity: O.faint, marginRight: 2 }}
      >
        #{props.n}
      </span>
      <button
        data-edit-from={props.id}
        disabled={!can("reframe") && !can("amend")}
        title={
          can("reframe") || can("amend")
            ? `Say ask #${props.n} differently — I will read it again.`
            : refusalSentence("reframe", props.phase)
        }
        aria-label={`say ask ${props.n} differently`}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "inherit",
          opacity: O.dim,
          fontSize: FS.body,
          padding: 0,
          lineHeight: 1,
        }}
        onClick={(e) => {
          e.stopPropagation();
          props.onEditAsk(props.id);
        }}
      >
        ✎
      </button>
    </span>
  );
}

const box: React.CSSProperties = {
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  background: C.raised,
  overflow: "hidden",
};

/** The reading, straight from the proposal — nothing is recorded yet. */
function Proposed(props: { push: SpacePush }): JSX.Element {
  const p = props.push.pendingModel!;
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(21rem, 1fr))", gap: 10 }}>
        {p.subjects.map((s, i) => (
          <div key={i} data-proposed-subject={i} style={{ ...box, padding: `${SP.sm}px ${SP.md}px` }}>
            <div style={{ ...label, marginTop: 0 }}>Subject</div>
            <strong style={{ fontSize: FS.body }}>{s.name}</strong>
            <div style={{ ...label, marginTop: 6 }}>Claims — what must become true of it</div>
            {s.claims.map((c, j) => (
              <div
                key={j}
                style={{ fontSize: FS.body, marginTop: 4, paddingLeft: 8, borderLeft: "2px solid #4ec9b0" }}
              >
                {c.text}
                {c.why ? (
                  <div style={aside}>so that {c.why}</div>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>
      {p.missing.length ? (
        <div data-model-missing style={{ fontSize: FS.caption, color: C.bad, marginTop: 8 }}>
          I could not place {p.missing.length} of your sentences: {p.missing.join(" · ")}
        </div>
      ) : null}
    </>
  );
}

/** What was recorded — the same shape, once the reading has been kept. */
export function IntentGraph(props: {
  push: SpacePush;
  selected: string | null;
  onSelect: (id: string) => void;
  onOpenWork: (subjectId: string) => void;
  onEditAsk: (id: string) => void;
  /** Go and see the work — which is also what starts the thinking. */
  onWork: () => void;
  /** Whether going to the work page is allowed now (a move never is refused;
   *  the thinking it would start can be). */
  canWork: boolean;
  /** The thinking is running: the work page is not a page yet. */
  working: boolean;
}): JSX.Element {
  const { push } = props;
  // AN EMPTY GRAPH MUST SAY WHY IT IS EMPTY.
  //
  // The chrome — tabs, zoom, fit — renders whatever the space holds, so a
  // space with nothing derived looked identical to a broken one, to a run
  // that had eaten it, and to a bug. A person stared at blank space with
  // no way to tell which; so did I, with the filesystem open, and I
  // guessed wrong twice before reading which space was pushed. One
  // sentence ends that.
  if (!push.modelFailure && !push.pendingModel && (push.subjects?.length ?? 0) === 0)
    return (
      <section data-empty-space style={{ margin: 12, padding: 12 }}>
        <strong style={{ fontSize: FS.body }}>
          Nothing is derived in {push.spaceName ? `"${push.spaceName}"` : "this space"} yet
        </strong>
        <div style={{ fontSize: FS.body, margin: "6px 0", opacity: O.dim }}>
          {(push.sentences?.length ?? 0) > 0
            ? `Your ${push.sentences.length} sentence${push.sentences.length === 1 ? "" : "s"} ${
                push.sentences.length === 1 ? "is" : "are"
              } written and waiting to be read.`
            : "Write what you want on the first page, and it is read into subjects and claims here."}
        </div>
        <div style={{ fontSize: FS.caption, opacity: O.dim }}>
          If you expected work here, this is not the space that holds it — pick another under its
          project in the tree.
        </div>
      </section>
    );
  if (push.modelFailure)
    return (
      <section
        data-model-failed
        style={{ margin: 12, padding: 12, border: "1px solid #f14c4c", borderRadius: 6 }}
      >
        <strong style={{ fontSize: FS.body, color: C.bad }}>
          I could not read your list — nothing was derived
        </strong>
        <div style={{ fontSize: FS.body, margin: "6px 0" }}>
          Your {push.modelFailure.sentences} sentence
          {push.modelFailure.sentences === 1 ? " is" : "s are"} recorded and waiting. Nothing was
          guessed at.
        </div>
        <pre
          style={{
            fontSize: FS.caption,
            whiteSpace: "pre-wrap",
            background: "var(--vscode-textCodeBlock-background, #1e1e1e)",
            borderRadius: 4,
            padding: `${SP.sm}px ${SP.md}px`,
            maxHeight: 160,
            overflowY: "auto",
          }}
        >
          {push.modelFailure.reason}
        </pre>
        <button data-retry-model onClick={() => post({ action: "retry-model" })}>
          Read it again
        </button>
      </section>
    );

  if (!push.pendingModel && !push.subjects.length)
    return (
      <div style={{ flex: 1, padding: 24 }}>
        {push.sentences.length ? (
          <>
            <div style={{ fontSize: FS.body, marginBottom: 4 }}>
              {push.sentences.length} sentence{push.sentences.length === 1 ? "" : "s"} recorded, none
              read yet.
            </div>
            <div style={{ fontSize: FS.body, opacity: O.dim, marginBottom: 10 }}>
              Reading them is one cheap round and costs nothing else.
            </div>
            <button
              data-retry-model
              style={{ fontWeight: 600 }}
              title="Read everything you have written, as one description."
              onClick={() => post({ action: "retry-model" })}
            >
              Read what I wrote
            </button>
          </>
        ) : (
          <span style={{ opacity: O.dim }}>
            Nothing here yet — write what you want above and I will read it as one description.
          </span>
        )}
      </div>
    );

/**
 * The sets worth delivering on their own.
 *
 * Nineteen asks went into one cut and came back three days later as a single
 * delivery, in which every page rendered at zero height. The correction that
 * turns a tricycle into a car happens between deliveries, and there was one.
 * Choosing a set here is choosing what the next delivery contains — the whole
 * point being that it contains less than everything.
 */
function Sets(props: { push: SpacePush }): JSX.Element | null {
  const sets = props.push.specs ?? [];
  const phase = props.push.phase;
  if (!props.push.subjects.length) return null;

  // In the order they should be built, not as peers. The first is the one
  // the rest lean on; a set already built is behind you. Five equal chips
  // told you nothing about which to press, which is the one decision this
  // whole layer exists to make easy.
  const order = [...sets].sort((a, b) => {
    if (a.built !== b.built) return a.built ? 1 : -1;
    return b.promises - a.promises;
  });
  const words = (i: number, sp: (typeof sets)[number]): string =>
    sp.built ? "built" : i === 0 ? "first" : i === order.length - 1 ? "last" : "then";

  return (
    <div data-sets style={{ marginBottom: SP.md }}>
      <div style={{ ...label, marginBottom: 4 }}>
        Sets — what to build and look at, one at a time, in this order
      </div>
      {order.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {order.map((sp, i) => (
            <button
              key={sp.id}
              data-choose-set={sp.id}
              disabled={!can("choose-set") || sp.built}
              title={
                sp.built
                  ? "This set is built — its promises are signed."
                  : can("choose-set")
                    ? `Work this set out and put it in the cut — ${sp.subjects} subject(s).`
                    : refusalSentence("choose-set", phase)
              }
              onClick={() => post({ action: "choose-set", specId: sp.id })}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: SP.md,
                alignItems: "baseline",
                textAlign: "left",
                padding: `${SP.sm}px ${SP.md}px`,
                borderRadius: 6,
                border: `1px solid ${sp.chosen ? C.ok : C.border}`,
                background: sp.chosen ? "#4ec9b014" : undefined,
                color: "inherit",
                cursor: sp.built ? "default" : "pointer",
                opacity: sp.built ? O.dim : 1,
              }}
            >
              <span
                data-set-when
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.09em",
                  textTransform: "uppercase",
                  color: i === 0 && !sp.built ? C.ok : C.quiet,
                  border: `1px solid ${i === 0 && !sp.built ? C.ok : C.border}`,
                  borderRadius: 999,
                  padding: "1px 6px",
                  whiteSpace: "nowrap",
                }}
              >
                {words(i, sp)}
              </span>
              <span>
                <span style={{ fontSize: FS.body, fontWeight: 600 }}>{sp.name}</span>
                {/* Which of YOUR sentences it carries. A count said "2
                    subjects" and left a wrong grouping invisible until it
                    was built. */}
                {sp.asks?.length ? (
                  <span data-set-asks style={{ fontSize: FS.caption, opacity: O.dim, marginLeft: SP.sm }}>
                    your {sp.asks.length === 1 ? "sentence" : "sentences"} {sp.asks.map((n) => `#${n}`).join(", ")}
                  </span>
                ) : null}
              </span>
              <span style={{ fontSize: FS.caption, opacity: O.dim, whiteSpace: "nowrap" }}>
                {sp.promises
                  ? `${sp.promises} promise${sp.promises === 1 ? "" : "s"}`
                  : `${sp.subjects} subject${sp.subjects === 1 ? "" : "s"} · not worked out yet`}
                {sp.repos.length > 1 ? ` · in ${sp.repos.join(" and ")}` : ""}
                {sp.chosen ? " · in the cut" : ""}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "baseline", gap: SP.sm }}>
          <button
            data-group-into-sets
            disabled={!can("group-into-sets")}
            title={can("group-into-sets") ? undefined : refusalSentence("group-into-sets", phase)}
            onClick={() => post({ action: "group-into-sets" })}
          >
            Group these into sets
          </button>
          <span style={{ fontSize: FS.caption, opacity: O.dim }}>
            so each one can be built and looked at on its own, instead of all of it at once
          </span>
        </div>
      )}
    </div>
  );
}

  const cost = push.cost;
  const total = push.subjects.length;
  const done = Math.max(0, total - cost.subjects);
  return (
    <div data-intent-graph style={{ flex: 1, overflowY: "auto", padding: `${SP.lg}px ${SP.lg}px 56px` }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
        <strong style={{ fontSize: FS.body }}>What I understood of your asks</strong>
        <span style={{ fontSize: FS.caption, opacity: O.dim }}>
          Say a sentence differently if this reads wrong — nothing here costs anything yet.
        </span>
      </div>

      <Sets push={push} />

      {/* A reading not yet kept is shown whole, because there is nothing
          else on screen to read it from. Once kept, it is marked inside your
          own sentences above — and drawing it a second time here, as cards
          in the machine's arrangement, put the same nine sentences on one
          page twice in two visual languages. */}
      {push.pendingModel ? <Proposed push={push} /> : null}

      {props.working ? (
        <div
          data-working
          style={{
            marginTop: SP.md,
            padding: `${SP.sm}px ${SP.md}px`,
            border: `1px solid ${C.focus}`,
            borderRadius: 6,
            maxWidth: "44rem",
          }}
        >
          <div style={{ fontSize: FS.body, fontWeight: 600 }}>
            Working out what to build — {done} of {total} subject{total === 1 ? "" : "s"} done
          </div>
          <div style={{ fontSize: FS.caption, opacity: O.dim, marginTop: SP.xs }}>
            Each subject above says where it is. Nothing is lost if you look elsewhere; the work
            page opens by itself when the last one finishes.
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
        <button
          data-think
          disabled={props.working || !props.canWork}
          style={{ fontWeight: 600 }}
          title={
            props.working
              ? "Working out what to build. The work page opens by itself when every subject is done."
              : !props.canWork
                ? refusalSentence("think", push.phase)
              : push.pendingModel
                ? "Keep this reading and work out what to build from it. This is what starts spending. You stay here until it is finished."
                : "Go to the work page. Working out what to build is what starts spending."
          }
          onClick={props.onWork}
        >
          {props.working
            ? "Working out what to build…"
            : push.pendingModel
              ? "Keep this reading and see what it will build →"
              : "See what this will build →"}
        </button>
        <span style={{ fontSize: FS.caption, opacity: O.dim }}>
          {props.working
            ? "you stay on this page until every subject is worked out — then it opens by itself"
            : cost.subjects
              ? `${cost.subjects} subject${cost.subjects === 1 ? "" : "s"} to think about — about ${cost.rounds} rounds`
              : "everything here has been thought about already"}
        </span>
      </div>

      {push.orphans.length ? (
        <section
          data-orphans
          style={{ marginTop: 12, border: "1px solid #f14c4c", borderRadius: 6, padding: `${SP.sm}px ${SP.md}px` }}
        >
          <div style={{ ...labelIn(C.bad), marginBottom: 4 }}>
            {push.orphans.length} thing(s) I derived that match nothing you asked for
          </div>
          {push.orphans.map((o) => (
            <div key={o.id} style={{ fontSize: FS.body, display: "flex", gap: 6, alignItems: "baseline" }}>
              <span style={{ flex: 1 }}>{o.text}</span>
              <button
                data-dismiss-promise={o.id}
                disabled={!can("dismiss-promise")}
                title={can("dismiss-promise") ? "Remove it — nothing you wrote asks for this." : refusalSentence("dismiss-promise", push.phase)}
                onClick={() => post({ action: "dismiss-promise", unitId: o.id })}
              >
                Remove
              </button>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
