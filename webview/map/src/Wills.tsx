/**
 * What will be true when this is done: the promises of the thing in hand,
 * each with its criteria as ticks. This is the contract, readable and
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

/** The tick a criterion carries: proved, failed, or not yet checked. */
function tick(c: Check): { glyph: string; color: string; word: string } {
  if (c.verdict === "green") return { glyph: "✓", color: C.ok, word: c.drifted ? "proved, then the code moved" : "proved" };
  if (c.verdict === "red") return { glyph: "✗", color: C.bad, word: "not proved" };
  return { glyph: "○", color: C.quiet, word: c.kind === "assessment" ? "judged at delivery by a reviewer" : "checked when it is built" };
}

function Will(props: { p: Promise_; selected: boolean; onSelect: (id: string) => void; phase: SpacePush["phase"] }): JSX.Element {
  const { p } = props;
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
          const t = tick(c);
          return (
            <li key={i} data-criterion style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: SP.sm, alignItems: "baseline", fontSize: FS.body, lineHeight: 1.5 }}>
              <span title={t.word} style={{ color: t.color }}>{t.glyph}</span>
              <span>{c.text}</span>
            </li>
          );
        })}
        {(p.unverified ?? []).map((u, i) => (
          <li key={`u${i}`} style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: SP.sm, alignItems: "baseline", fontSize: FS.body, color: C.quiet }}>
            <span>·</span>
            <span>
              {u.text} <span style={{ fontSize: FS.caption }}>— for you to see: {u.why}</span>
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
          ? "Read the ticks. This is the last point where saying “no, the other way round” costs nothing — the pencil on the sentence is how."
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
