/**
 * What the machine could not settle from the code, and what it has
 * settled since.
 *
 * All of this was computed and sent to the surface, and none of it was
 * ever drawn: the questions were answered for you at the moment you
 * pressed Build — "every assumption nobody objected to becomes a
 * decision" — by a silence you were never given the chance to break. A
 * recommendation nobody can see is not a recommendation; it is the
 * machine deciding and calling it consent.
 *
 * So each question is shown where the work it affects is, with what the
 * machine would answer and which promises hang on it. Answering is one
 * press. Saying it differently is a sentence. Doing neither still means
 * the recommendation stands at Build — that is the rule, said out loud
 * instead of discovered afterwards.
 */
import { useState } from "react";
import { C, FS, O, SP, aside, label, raised } from "./type";
import { post, SpacePush } from "./vscode";

function Question(props: { q: SpacePush["questions"][number] }): JSX.Element {
  const { q } = props;
  const [mine, setMine] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <div
      data-question={q.id}
      style={{ ...raised, borderColor: C.ask, padding: `${SP.sm}px ${SP.md}px`, marginBottom: SP.sm }}
    >
      <div style={{ fontSize: FS.body }}>{q.text}</div>
      {q.askLabel ? <div style={aside}>from {q.askLabel}</div> : null}
      {q.cards.length ? (
        <div style={aside}>
          {q.cards.length} promise{q.cards.length === 1 ? "" : "s"} hang on it:{" "}
          {q.cards.map((c) => c.title).join(" · ")}
        </div>
      ) : null}
      {q.recommendation ? (
        <div
          style={{
            marginTop: SP.sm,
            paddingLeft: SP.md,
            borderLeft: `2px solid ${C.ask}`,
            fontSize: FS.body,
          }}
        >
          {q.recommendation}
        </div>
      ) : null}
      <div style={{ display: "flex", gap: SP.sm, alignItems: "center", marginTop: SP.sm, flexWrap: "wrap" }}>
        {q.recommendation ? (
          <button
            data-accept-question={q.id}
            style={{ fontWeight: 600 }}
            title="Record this as the answer. Everything derived from it is worked out again under it."
            onClick={() => post({ action: "accept-question", questionId: q.id })}
          >
            Use this answer
          </button>
        ) : null}
        <button data-answer-question={q.id} onClick={() => setOpen(!open)}>
          {open ? "Never mind" : "Answer it myself"}
        </button>
        <span style={{ ...aside }}>
          {q.recommendation
            ? "unanswered, this answer is recorded for you when you build"
            : "the machine has no answer — unanswered, this blocks nothing and nothing settles it"}
        </span>
      </div>
      {open ? (
        <div style={{ marginTop: SP.sm }}>
          <textarea
            data-question-text={q.id}
            rows={2}
            value={mine}
            onChange={(e) => setMine(e.currentTarget.value)}
            style={{ width: "100%", fontSize: FS.body, fontFamily: "inherit" }}
            placeholder="your answer, in your words"
          />
          <button
            data-accept-question-mine={q.id}
            style={{ fontWeight: 600, marginTop: SP.xs }}
            onClick={() => {
              if (!mine.trim()) return;
              post({ action: "accept-question", questionId: q.id, text: mine });
              setOpen(false);
            }}
          >
            Record this answer
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Review(props: { push: SpacePush }): JSX.Element | null {
  const { push } = props;
  const [showDecided, setShowDecided] = useState(false);
  if (!push.questions.length && !push.impacts.length && !push.decisions.length) return null;
  return (
    <section data-review style={{ marginBottom: SP.md, maxWidth: "52rem" }}>
      {push.questions.length ? (
        <>
          <div style={label}>
            {push.questions.length} question{push.questions.length === 1 ? "" : "s"} your words did
            not settle
          </div>
          {push.questions.map((q) => (
            <Question key={q.id} q={q} />
          ))}
        </>
      ) : null}

      {push.impacts.length ? (
        <>
          <div style={label}>
            A decision you made reaches work derived before it
          </div>
          {push.impacts.map((im) => (
            <div
              key={im.id}
              data-impact={im.id}
              style={{ ...raised, padding: `${SP.sm}px ${SP.md}px`, marginBottom: SP.sm }}
            >
              <div style={{ fontSize: FS.body }}>{im.decision}</div>
              <div style={aside}>
                from “{im.askText}” · {im.affected} promise{im.affected === 1 ? "" : "s"} were worked
                out before it
              </div>
              <div style={{ display: "flex", gap: SP.sm, marginTop: SP.sm }}>
                <button
                  data-accept-impact={im.id}
                  style={{ fontWeight: 600 }}
                  title="Work those promises out again under this decision."
                  onClick={() => post({ action: "accept-impact", impactId: im.id })}
                >
                  Work them out again
                </button>
                <button
                  data-dismiss-impact={im.id}
                  title="Leave them as they are — the decision does not change them."
                  onClick={() => post({ action: "dismiss-impact", impactId: im.id })}
                >
                  Leave them
                </button>
              </div>
            </div>
          ))}
          {push.impacts.length > 1 ? (
            <button
              data-apply-all-impacts
              style={{ marginBottom: SP.sm }}
              onClick={() => post({ action: "apply-all-impacts" })}
            >
              Work everything out again under all {push.impacts.length}
            </button>
          ) : null}
        </>
      ) : null}

      {push.decisions.length ? (
        <div style={{ marginTop: SP.sm }}>
          <button
            data-show-decisions
            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, opacity: O.dim, fontSize: FS.caption }}
            onClick={() => setShowDecided(!showDecided)}
          >
            {showDecided ? "▾" : "▸"} {push.decisions.length} decision
            {push.decisions.length === 1 ? "" : "s"} in force — everything is built under{" "}
            {push.decisions.length === 1 ? "it" : "them"}
          </button>
          {showDecided
            ? push.decisions.map((d, i) => (
                <div key={i} data-decision={i} style={{ ...aside, marginTop: SP.xs, paddingLeft: SP.md }}>
                  {d}
                </div>
              ))
            : null}
        </div>
      ) : null}
    </section>
  );
}
