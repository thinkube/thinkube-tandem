/**
 * The delivery report: what the run made true, and the one decision left.
 *
 * It has the whole page rather than a column beside the graph, because it
 * is read to decide — and it is read once, so what it costs to read is
 * the whole cost of deciding. Accept sits at the end of it, where a
 * reader arrives having read what they are accepting.
 */
import { Markdown } from "./Markdown";
import { C, FS, O, SAID, label, raised, SP } from "./type";
import { can, post, refusalSentence, SpacePush } from "./vscode";

/**
 * What you asked for, and what happened to each sentence: done and live,
 * still to come, or already true. Your words, in your face, with one word
 * beside each — the report a person reads first, before the machine's.
 */
function Asked(props: { push: SpacePush }): JSX.Element | null {
  const rows = props.push.sentences.map((s, i) => {
    const stage = s.bound?.stage;
    const word = stage === "accepted" ? "in the project" : stage === "delivered" ? "done" : stage === "signed" ? "being built" : "not started";
    const tone = stage === "delivered" || stage === "accepted" ? C.ok : C.quiet;
    return { n: i + 1, text: s.text, word, tone, done: !!stage };
  });
  if (!rows.length) return null;
  const done = rows.filter((r) => r.done);
  const later = rows.filter((r) => !r.done);
  const list = (items: typeof rows): JSX.Element => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {items.map((r) => (
        <div key={r.n} data-asked={r.n} style={{ display: "grid", gridTemplateColumns: "26px 1fr auto", gap: SP.md, alignItems: "baseline", padding: `${SP.sm}px ${SP.md}px` }}>
          <span style={{ fontSize: FS.caption, color: C.quiet }}>{r.n}</span>
          <span style={{ fontFamily: SAID, fontSize: FS.heading, lineHeight: 1.5 }}>{r.text}</span>
          <span style={{ fontSize: FS.caption, color: r.tone, fontWeight: r.done ? 600 : 400, whiteSpace: "nowrap" }}>{r.word}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div data-asked-list style={{ marginBottom: SP.lg }}>
      {done.length ? (
        <>
          <div style={label}>What you asked for, and what happened</div>
          {list(done)}
        </>
      ) : null}
      {later.length ? (
        <>
          <div style={{ ...label, marginTop: SP.lg }}>Not started</div>
          {list(later)}
        </>
      ) : null}
    </div>
  );
}

/** What was seen when it was used, and what could not be delivered. */
function Found(props: { d: SpacePush["deliveries"][number] }): JSX.Element | null {
  const seen = props.d.observations ?? [];
  const missing = props.d.undelivered ?? [];
  if (!seen.length && !missing.length) return null;
  return (
    <div data-found style={{ marginBottom: SP.lg }}>
      <div style={label}>What I saw when I used it</div>
      <div style={{ display: "flex", flexDirection: "column", gap: SP.md }}>
        {seen.map((o, i) => (
          <div key={`s${i}`} style={{ padding: `${SP.md}px ${SP.lg}px`, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.ask}`, borderRadius: 6, background: C.raised }}>
            <span style={{ fontFamily: SAID, fontSize: FS.heading, lineHeight: 1.5 }}>{o}</span>
            <div style={{ fontSize: FS.caption, color: C.quiet, marginTop: SP.xs }}>only you can certify this — the machine cannot watch the running product</div>
          </div>
        ))}
        {missing.map((m, i) => (
          <div key={`m${i}`} style={{ padding: `${SP.md}px ${SP.lg}px`, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.bad}`, borderRadius: 6, background: C.raised }}>
            <span style={{ fontSize: FS.body }}>{m}</span>
            <div style={{ fontSize: FS.caption, color: C.quiet, marginTop: SP.xs }}>not delivered — it stays on the branch</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The way back in: the signed work runs again. It is offered on every
 *  delivery that is not accepted — withheld, refused by the gate, or still
 *  waiting for a decision. Signing happens once, so a delivery the gate
 *  will not accept would otherwise leave the work with no door at all.
 *
 *  Off, it says why. A control the phase has turned off is dimmed by the
 *  native `disabled` attribute, which swallows the click — so the refusal
 *  path in `post()` never runs and the tooltip is the only place the
 *  sentence can reach the reader. */
function RunAgain(props: {
  rerun: { id: string; tepId?: string };
  phase: SpacePush["phase"];
}): JSX.Element {
  return (
    <button
      data-rerun
      disabled={!can("rerun")}
      style={{ fontWeight: 600 }}
      title={
        can("rerun")
          ? "Start the signed work again. Nothing is signed twice and nothing you wrote changes."
          : refusalSentence("rerun", props.phase)
      }
      onClick={() => post({ action: "rerun" })}
    >
      Run {props.rerun.tepId ?? "it"} again
    </button>
  );
}

export function Delivery(props: { push: SpacePush }): JSX.Element {
  const deliveries = [...props.push.deliveries].reverse();
  return (
    <div
      data-delivery-report
      style={{ flex: 1, overflowY: "auto", padding: `${SP.lg}px ${SP.xl}px ${SP.xl}px` }}
    >
      {deliveries.map((d) => (
        <article
          key={d.id}
          data-delivery={d.id}
          style={{ ...raised, padding: `${SP.md}px ${SP.lg}px`, marginBottom: SP.lg, maxWidth: "56rem" }}
        >
          {d.url ? (
            <div data-live style={{ display: "flex", alignItems: "center", gap: SP.md, flexWrap: "wrap", padding: `${SP.md}px ${SP.lg}px`, border: `1px solid ${C.ok}`, borderRadius: 7, marginBottom: SP.lg, background: "#4ec9b014" }}>
              <a href={d.url} style={{ color: "inherit", fontWeight: 600, fontSize: FS.title }}>{d.url.replace(/^https?:\/\//, "")}</a>
              <span style={{ fontSize: FS.caption, color: C.quiet }}>
                {/\/pull\/|\/pulls\/|\/merge_requests\//.test(d.url)
                  ? "the work, as a pull request — read it before you decide"
                  : "live — open it and use it before you decide"}
              </span>
            </div>
          ) : null}
          <Asked push={props.push} />
          <Found d={d} />
          <details data-full-report>
            <summary style={{ cursor: "pointer", fontSize: FS.caption, color: C.quiet }}>The full report, as the run wrote it</summary>
            <Markdown text={d.page} />
          </details>
          <div
            style={{
              marginTop: SP.lg,
              paddingTop: SP.md,
              borderTop: `1px solid ${C.border}`,
              display: "flex",
              alignItems: "center",
              gap: SP.md,
            }}
          >
            {d.accepted ? (
              <span data-accepted={d.id} style={{ color: C.ok, fontSize: FS.body, fontWeight: 600 }}>
                ✓ Accepted
              </span>
            ) : d.withheld ? (
              // Withheld: nothing was delivered. The record is readable and
              // the signed work can run again from here.
              <div data-withheld={d.id} style={{ fontSize: FS.body }}>
                <div style={{ color: C.bad }}>
                  <strong>Withheld — nothing was delivered.</strong> {d.withheld}
                </div>
                {d.rerun ? (
                  <div style={{ marginTop: SP.sm }}>
                    <RunAgain rerun={d.rerun} phase={props.push.phase} />
                  </div>
                ) : null}
              </div>
            ) : d.blocked ? (
              // Accept is not offered, because it would be refused: a button
              // that cannot work says the work is ready for the project,
              // which over a page of red checks is the machine lying about
              // the one decision it exists to support. The way back in is
              // offered instead — saying "no" and nothing else is a dead end.
              <div data-cannot-accept={d.id} style={{ fontSize: FS.body, color: C.bad }}>
                <strong>This cannot be accepted.</strong> {d.blocked}
                {d.rerun ? (
                  <div style={{ marginTop: SP.sm }}>
                    <RunAgain rerun={d.rerun} phase={props.push.phase} />
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <button
                  data-accept-delivery={d.id}
                  disabled={!can("accept-delivery")}
                  style={{ fontWeight: 600, padding: `${SP.xs}px ${SP.md}px` }}
                  title={
                    can("accept-delivery")
                      ? "Accept it — this merges the work on the project's forge."
                      : refusalSentence("accept-delivery", props.push.phase)
                  }
                  onClick={() => post({ action: "accept-delivery", deliveryId: d.id })}
                >
                  Accept
                </button>
                <button
                  data-reject-delivery={d.id}
                  disabled={!can("reject-delivery")}
                  style={{ padding: `${SP.xs}px ${SP.md}px` }}
                  title={
                    can("reject-delivery")
                      ? "Not this — the work stays on its branch and the signed promises can run again."
                      : refusalSentence("reject-delivery", props.push.phase)
                  }
                  onClick={() => post({ action: "reject-delivery", deliveryId: d.id })}
                >
                  Not this
                </button>
                {d.rerun ? <RunAgain rerun={d.rerun} phase={props.push.phase} /> : null}
                <span style={{ fontSize: FS.caption, color: C.quiet }}>
                  Try it first — every “see it” line above is a way in.
                </span>
                {d.observations?.length ? (
                  <div data-observations={d.id} style={{ fontSize: FS.body, marginTop: SP.sm }}>
                    <strong>For you to certify — the machine cannot watch the running product:</strong>
                    <ul style={{ margin: `${SP.xs}px 0 0`, paddingLeft: 18 }}>
                      {d.observations.map((o, i) => (
                        <li key={i}>{o}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {d.pending?.length ? (
                  <div data-pending={d.id} style={{ fontSize: FS.body, marginTop: SP.sm }}>
                    <strong>Answered after the merge — not by anything this run could reach:</strong>
                    <ul style={{ margin: `${SP.xs}px 0 0`, paddingLeft: 18 }}>
                      {d.pending.map((p, i) => (
                        <li key={i} style={{ marginBottom: SP.xs }}>
                          {p.text}
                          <span style={{ opacity: O.dim }}> — settled by {p.settledBy}</span>
                          {p.ref ? <div style={{ opacity: O.dim, fontSize: FS.caption }}>{p.ref}</div> : null}
                          {/* Only a person can answer some of these: they
                              installed it, or they did not. The buttons say
                              exactly that and nothing more. */}
                          {p.criterionId && /attest|person|clean node|install/i.test(p.settledBy) ? (
                            <div style={{ marginTop: SP.xs }}>
                              <button
                                data-attest-held={p.criterionId}
                                onClick={() =>
                                  post({
                                    action: "attest",
                                    deliveryId: d.id,
                                    criterionId: p.criterionId!,
                                    held: true,
                                  })
                                }
                              >
                                It held
                              </button>{" "}
                              <button
                                data-attest-broke={p.criterionId}
                                onClick={() =>
                                  post({
                                    action: "attest",
                                    deliveryId: d.id,
                                    criterionId: p.criterionId!,
                                    held: false,
                                  })
                                }
                              >
                                It did not
                              </button>
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
