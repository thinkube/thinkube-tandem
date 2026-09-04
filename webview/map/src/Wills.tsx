/**
 * What will be true when this is done: the promises of the thing in hand,
 * each with its criteria. This is the contract, readable and
 * arguable — the one thing on the surface a person can disagree with
 * before any code exists, and the last point where saying "no, the other
 * way round" costs nothing.
 *
 * A promise is set in your face, because it is made in your words. Where
 * it lands is said under it, quietly. The criteria are the machine's, set
 * in the interface face, with the newest verdict any delivery recorded.
 */
import { useState } from "react";
import { can, post, refusalSentence, SpacePush } from "./vscode";
import { C, FS, SAID, SP, label } from "./type";
import { setsInOrder } from "../../../src/surfaces/nextAction";

type Subject = SpacePush["subjects"][number];
type Promise_ = Subject["claims"][number]["promises"][number];
type Check = Promise_["checks"][number];

/**
 * Where a criterion stands, in words.
 *
 * A mark only earns its place when everyone reads it the same way: a
 * tick and a cross do, a hollow circle and a middle dot do not. Those two
 * carried four different meanings between them, each written in a tooltip
 * nobody hovers — a riddle in front of a person who came to read what
 * their work will do. What is not proved or broken says what it is, on
 * the line, in the same size as everything else.
 */
function stands(c: Check): { mark: string; color: string; word: string } {
  // The world answered back: proved once, and not any more.
  if (c.contradicted) return { mark: "✗", color: C.bad, word: "no longer holds" };
  if (c.verdict === "green")
    return { mark: "✓", color: C.ok, word: c.drifted ? "proved, then the code moved" : "" };
  if (c.verdict === "red") return { mark: "✗", color: C.bad, word: "not proved" };
  if (c.verdict === "unjudged") return { mark: "", color: C.quiet, word: "nothing could judge it" };
  return {
    mark: "",
    color: C.quiet,
    word: c.kind === "assessment" ? "judged by a reviewer at delivery" : "checked when it is built",
  };
}

/** Saying a delivered promise, or one criterion of it, does not hold. The
 *  press is off until there are words: a repair is told what to fix. */
function DoesNotHold(props: { target: { unitId?: string; criterionId?: string }; phase: SpacePush["phase"]; what: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState("");
  if (!open)
    return (
      <button
        data-does-not-hold={props.target.criterionId ?? props.target.unitId}
        disabled={!can("contradict")}
        title={can("contradict") ? `Say that ${props.what} does not hold, and what you saw using it.` : refusalSentence("contradict", props.phase)}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        style={{ fontSize: FS.caption, background: "none", border: "none", color: C.quiet, textDecoration: "underline", cursor: "pointer", padding: 0 }}
      >
        Say it does not hold
      </button>
    );
  return (
    <div data-does-not-hold-form style={{ marginTop: SP.xs, maxWidth: "44rem" }} onClick={(e) => e.stopPropagation()}>
      <textarea
        data-does-not-hold-said
        rows={2}
        autoFocus
        placeholder="what you saw…"
        value={said}
        onChange={(e) => setSaid(e.target.value)}
        style={{ width: "100%", fontSize: FS.body, fontFamily: "inherit" }}
      />
      <div style={{ display: "flex", gap: SP.md, marginTop: SP.xs }}>
        <button
          data-does-not-hold-commit
          disabled={!said.trim()}
          title={said.trim() ? "Record it: this comes back as work." : "Say what you saw — a repair is told what to fix."}
          onClick={() => {
            post({ action: "contradict", ...props.target, reason: said });
            setOpen(false);
            setSaid("");
          }}
          style={{ fontSize: FS.caption }}
        >
          It does not hold
        </button>
        <button onClick={() => setOpen(false)} style={{ fontSize: FS.caption }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Will(props: { p: Promise_; selected: boolean; onSelect: (id: string) => void; phase: SpacePush["phase"] }): JSX.Element {
  const { p } = props;
  // Only work that is IN THE PROJECT can be refused. Offered on a delivery
  // still waiting for a decision, it asked a person whether something they
  // had not seen yet worked — nothing is deployed until they accept.
  const landed = p.checks.some((c) => c.accepted);
  // A promise the machine added — documentation, or a gap the code
  // demands. It says so, and it can be declined in one press.
  const minted = /-gap-\d/.test(p.id);
  return (
    <section
      data-will={p.id}
      onClick={() => props.onSelect(p.id)}
      style={{
        border: `1px solid ${props.selected ? C.focus : C.border}`,
        borderRadius: 7,
        padding: `${SP.md}px ${SP.lg}px ${SP.md}px`,
        cursor: "pointer",
        opacity: p.stale ? 0.7 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: SP.md, flexWrap: "wrap", marginBottom: SP.sm }}>
        <span style={{ fontFamily: SAID, fontSize: FS.heading, lineHeight: 1.4 }}>{p.text}</span>
        <span style={{ marginLeft: "auto", fontSize: FS.caption, color: C.quiet, whiteSpace: "nowrap" }}>
          {p.file || "where it lands is not known yet"}
          {p.stale ? " · the code moved since this was read" : ""}
        </span>
      </div>
      {landed && !p.checks.every((c) => c.contradicted) ? (
        <div style={{ marginBottom: SP.sm }}>
          <DoesNotHold target={{ unitId: p.id }} phase={props.phase} what="this promise" />
        </div>
      ) : null}
      {minted ? (
        <div data-minted style={{ display: "flex", alignItems: "center", gap: SP.md, fontSize: FS.caption, color: C.quiet, marginBottom: SP.sm }}>
          <span>added by the machine — {/^The documentation/.test(p.text) ? "documentation is part of every delivery unless you say it is not needed" : "the code around this work demands it"}</span>
          <button
            data-dismiss-promise={p.id}
            disabled={!can("dismiss-promise")}
            title={can("dismiss-promise") ? "Take it out of this delivery. Say why on the line that appears." : refusalSentence("dismiss-promise", props.phase)}
            onClick={(e) => {
              e.stopPropagation();
              post({ action: "dismiss-promise", unitId: p.id });
            }}
            style={{ fontSize: FS.caption }}
          >
            Not needed
          </button>
        </div>
      ) : null}
      <ul data-criteria style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: SP.sm }}>
        {p.checks.map((c, i) => {
          const t = stands(c);
          return (
            <li key={i} data-criterion style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: SP.sm, alignItems: "baseline", fontSize: FS.body, lineHeight: 1.5 }}>
              <span style={{ color: t.color }}>{t.mark}</span>
              <span>
                {c.text}
                {t.word ? <span style={{ color: t.color }}> · {t.word}</span> : null}
                {c.contradicted ? (
                  <span data-contradicted style={{ display: "block", color: C.bad }}>
                    {c.contradicted.said} · said by {c.contradicted.by}
                  </span>
                ) : landed && !c.contradicted ? (
                  <span style={{ marginLeft: SP.md }}>
                    <DoesNotHold target={{ criterionId: c.id }} phase={props.phase} what="this" />
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
        {(p.unverified ?? []).map((u, i) => (
          <li key={`u${i}`} data-unverified style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: SP.sm, alignItems: "baseline", fontSize: FS.body, lineHeight: 1.5, color: C.quiet }}>
            <span />
            <span>
              {u.text} · only you can see this: {u.why}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Wills(props: {
  push: SpacePush;
  selected: string | null;
  onSelect: (id: string) => void;
  onGoToRun: () => void;
}): JSX.Element {
  const { push } = props;
  const [docReason, setDocReason] = useState("");
  const chosen = (push.specs ?? []).find((sp) => sp.chosen);
  // The things, each with the promises of its subjects. With one in hand,
  // only that one: the others are not what is about to be built.
  const things = (chosen ? [chosen] : setsInOrder(push)).map((sp) => {
    const asks = new Set(sp.asks ?? []);
    const subjects = push.subjects.filter((s) => s.from.some((f) => asks.has(f.n)));
    const promises = subjects.flatMap((s) => s.claims.flatMap((c) => c.promises));
    return { sp, promises: promises.filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i) };
  });
  // Without any grouping, every promise under its subject.
  const loose = things.length
    ? []
    : push.subjects.map((s) => ({ name: s.name, promises: s.claims.flatMap((c) => c.promises) })).filter((s) => s.promises.length);
  const doc = push.documentation;
  const total = things.reduce((n, t) => n + t.promises.length, 0) + loose.reduce((n, s) => n + s.promises.length, 0);

  return (
    <div data-wills style={{ flex: 1, overflowY: "auto", padding: `${SP.lg}px ${SP.lg}px 56px` }}>
      {push.signedIdle ? (
        <div data-signed-idle style={{ marginBottom: SP.lg, padding: `${SP.sm}px ${SP.md}px`, border: `1px solid ${C.ask}`, borderRadius: 6 }}>
          <strong style={{ fontSize: FS.body }}>{push.signedIdle.heading}</strong>
          <div style={{ fontSize: FS.body, marginTop: SP.xs }}>{push.signedIdle.sentence}</div>
          <button style={{ marginTop: SP.sm }} onClick={props.onGoToRun}>See the run</button>
        </div>
      ) : null}

      <div style={{ ...label, marginTop: 0 }}>What will be true when this is done</div>
      <div style={{ fontSize: FS.caption, color: C.quiet, marginBottom: SP.md }}>
        {total
          ? "Each line under a promise is one thing that must become true, and says where it stands. This is the last point where saying “no, the other way round” costs nothing — the pencil on the sentence is how."
          : chosen
            ? "Nothing has been worked out for this yet."
            : "Choose a thing on the intent page and its promises appear here."}
      </div>

      {things.map(({ sp, promises }) => (
        <div key={sp.id} data-thing-wills={sp.id} style={{ marginBottom: SP.lg }}>
          {!chosen ? <div style={label}>{sp.name}</div> : null}
          <div style={{ display: "flex", flexDirection: "column", gap: SP.md }}>
            {promises.map((p) => (
              <Will key={p.id} p={p} selected={props.selected === p.id} onSelect={props.onSelect} phase={push.phase} />
            ))}
          </div>
        </div>
      ))}
      {loose.map((s) => (
        <div key={s.name} style={{ marginBottom: SP.lg }}>
          <div style={label}>{s.name}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: SP.md }}>
            {s.promises.map((p) => (
              <Will key={p.id} p={p} selected={props.selected === p.id} onSelect={props.onSelect} phase={push.phase} />
            ))}
          </div>
        </div>
      ))}

      {total && chosen ? (
        <div data-before-build style={{ marginTop: SP.lg, paddingTop: SP.md, borderTop: `1px solid ${C.border}` }}>
          <div style={label}>Pressing Build these {total}</div>
          <ul style={{ fontSize: FS.caption, color: C.quiet, margin: 0, paddingLeft: SP.lg, lineHeight: 1.6 }}>
            <li>signs this work and locks the {push.ready.asks} sentence{push.ready.asks === 1 ? "" : "s"} behind it — from then on they change only by amendment</li>
            {push.questions.length ? (
              <li>records the machine's own answer to {push.questions.length} open question{push.questions.length === 1 ? "" : "s"} — answering first replaces it with yours</li>
            ) : null}
            <li>starts the workers on {total} promise{total === 1 ? "" : "s"} — this is what spends</li>
            <li>pushes a branch; nothing is merged until you accept the delivery</li>
          </ul>
          {doc.state === "landed" ? (
            <div data-docs-landed style={{ fontSize: FS.caption, color: C.quiet, marginTop: SP.sm }}>
              Lands documentation: {doc.landings.join(", ")}
            </div>
          ) : doc.state === "exempt" ? (
            <div data-docs-exempt style={{ fontSize: FS.caption, color: C.quiet, marginTop: SP.sm }}>
              Documentation not needed: {doc.reason}
            </div>
          ) : (
            <div data-docs-exemption style={{ marginTop: SP.sm, maxWidth: "44rem" }}>
              <label htmlFor="docs-exemption-reason" style={{ fontSize: FS.body }}>
                Nothing in this delivery lands a documentation page. Say why none is needed, and Build unlocks.
              </label>
              <textarea
                id="docs-exemption-reason"
                data-docs-exemption-reason
                rows={2}
                style={{ width: "100%", fontSize: FS.body, marginTop: SP.xs, fontFamily: "inherit" }}
                placeholder="documentation is not needed here because…"
                value={docReason}
                onChange={(e) => setDocReason(e.target.value)}
                onBlur={() => {
                  if (docReason.trim()) post({ action: "exempt-docs", reason: docReason });
                }}
              />
            </div>
          )}
          {push.buildRefusal ? (
            <div data-build-refusal style={{ fontSize: FS.body, color: C.bad, marginTop: SP.sm }}>
              {push.buildRefusal}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
