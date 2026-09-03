/**
 * What came back: your sentences, and what happened to each — done, not
 * kept, not judged, not started. A failure is said under the sentence it
 * broke, in plain words. What the machine could not judge is said once,
 * grouped by its one cause. The run's own account is folded away, for a
 * developer who wants it. The decision sits at the end, where a reader
 * arrives having read what they are deciding on.
 */
import { Markdown } from "./Markdown";
import { C, FS, SAID, label, raised, SP } from "./type";
import { can, post, refusalSentence, SpacePush } from "./vscode";

type Delivery_ = SpacePush["deliveries"][number];
type Promise_ = SpacePush["subjects"][number]["claims"][number]["promises"][number];

/** How a sentence fared, read from THIS delivery's verdicts on the promises made from it. */
type Fate = "done" | "not kept" | "not judged" | "being built" | "not started" | "landed earlier";
type Verdict = { verdict: "green" | "red" | "unjudged"; said?: string };

function fateOf(promises: Promise_[], judged: Map<string, Verdict>, stage: string | undefined): Fate {
  const verdicts = promises.flatMap((p) => p.checks.map((c) => judged.get(c.id)));
  if (verdicts.some((v) => v?.verdict === "red")) return "not kept";
  if (verdicts.length && verdicts.every((v) => v?.verdict === "green")) return "done";
  if (verdicts.some((v) => !v || v.verdict === "unjudged")) return "not judged";
  if (stage === "delivered" || stage === "accepted") return "done";
  if (stage === "signed") return "being built";
  return "not started";
}

const TONE: Record<Fate, string> = {
  done: C.ok,
  "not kept": C.bad,
  "not judged": C.ask,
  "being built": C.live,
  "not started": C.quiet,
  "landed earlier": C.quiet,
};

/** The way back in: the signed work runs again. Off, it says why. */
function RunAgain(props: { phase: SpacePush["phase"] }): JSX.Element {
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
      Run it again
    </button>
  );
}

export function Delivery(props: { push: SpacePush }): JSX.Element {
  const { push } = props;
  const d: Delivery_ | undefined = [...push.deliveries].reverse()[0];
  if (!d) return <div data-delivery-report style={{ padding: SP.xl, color: C.quiet }}>Nothing has been delivered yet.</div>;

  // Your sentences, each with the promises made from it.
  const byN = new Map<number, Promise_[]>();
  for (const s of push.subjects)
    for (const f of s.from) {
      const list = byN.get(f.n) ?? [];
      for (const c of s.claims) for (const p of c.promises) if (!list.some((x) => x.id === p.id)) list.push(p);
      byN.set(f.n, list);
    }
  // This delivery's own verdicts, by criterion. A page painted from the
  // newest verdict anywhere showed one run's reds over another run's news.
  const judged = new Map<string, Verdict>(
    d.proofs
      ? d.proofs.map((p) => [p.criterionId, { verdict: p.verdict, ...(p.said ? { said: p.said } : {}) }])
      : push.subjects
          .flatMap((s) => s.claims.flatMap((c) => c.promises.flatMap((p) => p.checks)))
          .filter((c) => !!c.verdict)
          .map((c) => [c.id, { verdict: c.verdict!, ...(c.said ? { said: c.said } : {}) }]),
  );
  // This report is about ONE delivery. A sentence delivered by an earlier
  // one is not judged again here: its work is already in the project, and
  // reading "not judged" over merged code is a lie about what happened.
  const rows = push.sentences.map((s, i) => {
    const promises = byN.get(i + 1) ?? [];
    const elsewhere = !!s.bound?.tep && !!d.tep && s.bound.tep !== d.tep;
    return {
      n: i + 1,
      text: s.text,
      promises,
      fate: elsewhere
        ? ("landed earlier" as Fate)
        : fateOf(promises, judged, s.bound?.stage),
      tep: s.bound?.tep,
    };
  });
  const happened = rows.filter((r) => r.fate !== "not started" && r.fate !== "landed earlier");
  const earlier = rows.filter((r) => r.fate === "landed earlier");
  const later = rows.filter((r) => r.fate === "not started");

  // Failures said once. Twenty-four checks failing the same way is one
  // failure; the report names it once, and the sentences point at it.
  const shared = new Map<string, number>();
  const unjudged = new Map<string, number>();
  for (const v of judged.values()) {
    if (v.verdict === "red" && v.said) shared.set(v.said, (shared.get(v.said) ?? 0) + 1);
    if (v.verdict === "unjudged") unjudged.set(v.said ?? "the check could not run", (unjudged.get(v.said ?? "the check could not run") ?? 0) + 1);
  }
  const commonFailures = [...shared.entries()].filter(([, n]) => n >= 2);
  const isCommon = (said: string | undefined): boolean => !!said && (shared.get(said) ?? 0) >= 2;
  // The latest run's own outcome comes first when it produced nothing.
  const lastRun = push.run?.phases;
  const refusedAtDoor = lastRun?.door.state === "failed" ? lastRun.door.doing : undefined;

  const seen = d.observations ?? [];
  const stuck = d.withheld ?? d.blocked;
  const account = [...(d.undelivered ?? [])];

  return (
    <div data-delivery-report style={{ flex: 1, overflowY: "auto", padding: `${SP.lg}px ${SP.xl}px ${SP.xl}px` }}>
      <article data-delivery={d.id} style={{ maxWidth: "60rem" }}>
        {d.afterMerge?.outcome === "broke" ? (
          <div data-after-merge style={{ marginBottom: SP.lg, padding: `${SP.md}px ${SP.lg}px`, border: `1px solid ${C.bad}`, borderRadius: 7 }}>
            <strong style={{ fontSize: FS.body }}>This was accepted, and then the merged work did not build.</strong>
            <div style={{ fontSize: FS.body, marginTop: SP.xs }}>
              {d.afterMerge.detail ?? "it did not pass"} — said by {d.afterMerge.said}.
            </div>
            <div style={{ fontSize: FS.caption, color: C.quiet, marginTop: SP.xs }}>
              The work is in the project and its branch is kept. Run it again to repair it.
            </div>
          </div>
        ) : d.afterMerge?.outcome === "held" ? (
          <div data-after-merge style={{ marginBottom: SP.lg, fontSize: FS.body, color: C.ok }}>
            The merged work built and deployed, said by {d.afterMerge.said}.
          </div>
        ) : null}
        {refusedAtDoor ? (
          <div data-refused-at-door style={{ marginBottom: SP.lg, padding: `${SP.md}px ${SP.lg}px`, border: `1px solid ${C.bad}`, borderRadius: 7 }}>
            <strong style={{ fontSize: FS.body }}>The last run was refused at the door. Nothing below is from it.</strong>
            <div style={{ fontSize: FS.body, marginTop: SP.xs }}>{refusedAtDoor}</div>
          </div>
        ) : null}
        {commonFailures.length ? (
          <div data-common-failures style={{ marginBottom: SP.lg, padding: `${SP.md}px ${SP.lg}px`, border: `1px solid ${C.bad}`, borderRadius: 7 }}>
            <div style={{ ...label, marginTop: 0 }}>One failure, many checks</div>
            {commonFailures.map(([said, n]) => (
              <div key={said} style={{ fontSize: FS.body, lineHeight: 1.5 }}>
                {n} checks failed the same way — {said}
              </div>
            ))}
          </div>
        ) : null}
        {stuck ? (
          <div data-withheld={d.id} style={{ marginBottom: SP.lg, padding: `${SP.md}px ${SP.lg}px`, border: `1px solid ${C.bad}`, borderRadius: 7 }}>
            <strong style={{ fontSize: FS.body }}>{d.withheld ? "Nothing was delivered." : "This cannot be accepted."}</strong>
            <div style={{ fontSize: FS.body, marginTop: SP.xs }}>{stuck}</div>
          </div>
        ) : d.url ? (
          <div data-live style={{ display: "flex", alignItems: "center", gap: SP.md, flexWrap: "wrap", padding: `${SP.md}px ${SP.lg}px`, border: `1px solid ${C.ok}`, borderRadius: 7, marginBottom: SP.lg, background: "#4ec9b014" }}>
            <a href={d.url} style={{ color: "inherit", fontWeight: 600, fontSize: FS.title }}>{d.url.replace(/^https?:\/\//, "")}</a>
            <span style={{ fontSize: FS.caption, color: C.quiet }}>
              {/\/pull\/|\/pulls\/|\/merge_requests\//.test(d.url) ? "the work, as a pull request — read it before you decide" : "live — open it and use it before you decide"}
            </span>
          </div>
        ) : null}

        {happened.length ? (
          <div data-asked-list style={{ marginBottom: SP.lg }}>
            <div style={label}>What you asked for, and what happened</div>
            {happened.map((r) => (
              <div key={r.n} data-asked={r.n} data-fate={r.fate} style={{ padding: `${SP.sm}px ${SP.md}px`, borderRadius: 6 }}>
                <div style={{ display: "grid", gridTemplateColumns: "26px 1fr auto", gap: SP.md, alignItems: "baseline" }}>
                  <span style={{ fontSize: FS.caption, color: C.quiet }}>{r.n}</span>
                  <span style={{ fontFamily: SAID, fontSize: FS.heading, lineHeight: 1.5 }}>{r.text}</span>
                  <span style={{ fontSize: FS.caption, color: TONE[r.fate], fontWeight: r.fate === "done" || r.fate === "not kept" ? 600 : 400, whiteSpace: "nowrap" }}>
                    {r.fate}
                  </span>
                </div>
                {r.fate === "not kept"
                  ? r.promises
                      .filter((p) => p.checks.some((c) => judged.get(c.id)?.verdict === "red"))
                      .map((p) => (
                        <div key={p.id} data-broken={p.id} style={{ margin: `${SP.sm}px 0 0 38px`, padding: `${SP.sm}px ${SP.md}px`, borderLeft: `3px solid ${C.bad}`, background: C.raised, borderRadius: 4 }}>
                          <div style={{ fontFamily: SAID, fontSize: FS.body, lineHeight: 1.5 }}>{p.text}</div>
                          {p.checks
                            .filter((c) => judged.get(c.id)?.verdict === "red")
                            .map((c, i) => {
                              const v = judged.get(c.id);
                              return (
                                <div key={i} style={{ fontSize: FS.body, marginTop: SP.xs }}>
                                  {isCommon(v?.said) ? "the same failure as above" : v?.said ? v.said : "did not hold"}
                                  <span style={{ color: C.quiet }}> — {c.text}</span>
                                </div>
                              );
                            })}
                        </div>
                      ))
                  : null}
              </div>
            ))}
          </div>
        ) : null}

        {unjudged.size ? (
          <div data-unjudged style={{ marginBottom: SP.lg, padding: `${SP.md}px ${SP.lg}px`, border: `1px solid ${C.ask}`, borderRadius: 7 }}>
            <div style={{ ...label, marginTop: 0 }}>What the machine could not judge</div>
            {[...unjudged.entries()].map(([why, n]) => (
              <div key={why} style={{ fontSize: FS.body, lineHeight: 1.5 }}>
                {n} check{n === 1 ? "" : "s"} could not run — {why}. Nothing here says the work is wrong.
              </div>
            ))}
          </div>
        ) : null}

        {seen.length ? (
          <div data-found style={{ marginBottom: SP.lg }}>
            <div style={label}>What I saw when I used it</div>
            <div style={{ display: "flex", flexDirection: "column", gap: SP.md }}>
              {seen.map((o, i) => (
                <div key={i} style={{ padding: `${SP.md}px ${SP.lg}px`, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.ask}`, borderRadius: 6, background: C.raised }}>
                  <span style={{ fontFamily: SAID, fontSize: FS.heading, lineHeight: 1.5 }}>{o}</span>
                  <div style={{ fontSize: FS.caption, color: C.quiet, marginTop: SP.xs }}>only you can certify this — the machine cannot watch the running product</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {earlier.length ? (
          <div data-landed-earlier style={{ marginBottom: SP.lg }}>
            <div style={label}>Already in the project, from an earlier delivery</div>
            {earlier.map((r) => (
              <div key={r.n} data-asked={r.n} data-fate={r.fate} style={{ display: "grid", gridTemplateColumns: "26px 1fr auto", gap: SP.md, alignItems: "baseline", padding: `${SP.sm}px ${SP.md}px`, fontSize: FS.body, color: C.quiet }}>
                <span style={{ fontSize: FS.caption }}>{r.n}</span>
                <span>{r.text}</span>
                <span style={{ fontSize: FS.caption, whiteSpace: "nowrap" }}>accepted</span>
              </div>
            ))}
          </div>
        ) : null}

        {later.length ? (
          <div style={{ marginBottom: SP.lg }}>
            <div style={label}>Not started</div>
            {later.map((r) => (
              <div key={r.n} data-asked={r.n} data-fate={r.fate} style={{ display: "grid", gridTemplateColumns: "26px 1fr auto", gap: SP.md, alignItems: "baseline", padding: `${SP.sm}px ${SP.md}px` }}>
                <span style={{ fontSize: FS.caption, color: C.quiet }}>{r.n}</span>
                <span style={{ fontFamily: SAID, fontSize: FS.heading, lineHeight: 1.5 }}>{r.text}</span>
                <span style={{ fontSize: FS.caption, color: C.quiet }}>not started</span>
              </div>
            ))}
          </div>
        ) : null}

        <details data-full-report style={{ marginBottom: SP.lg }}>
          <summary style={{ cursor: "pointer", fontSize: FS.caption, color: C.quiet }}>The run's own account, for a developer</summary>
          {account.length ? (
            <ul style={{ fontSize: FS.caption, color: C.quiet, paddingLeft: SP.lg, lineHeight: 1.5 }}>
              {account.map((m, i) => (
                <li key={i} style={{ whiteSpace: "pre-wrap", marginBottom: SP.xs }}>{m}</li>
              ))}
            </ul>
          ) : null}
          <div style={{ ...raised, padding: `${SP.md}px ${SP.lg}px` }}>
            <Markdown text={d.page} />
          </div>
        </details>

        <div style={{ paddingTop: SP.md, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: SP.md, flexWrap: "wrap" }}>
          {d.accepted && d.afterMerge?.outcome === "broke" ? (
            <>
              <span data-accepted={d.id} style={{ color: C.quiet, fontSize: FS.body }}>Accepted, and it did not build</span>
              <RunAgain phase={push.phase} />
            </>
          ) : d.accepted ? (
            <span data-accepted={d.id} style={{ color: C.ok, fontSize: FS.body, fontWeight: 600 }}>✓ Accepted</span>
          ) : stuck ? (
            <>{d.rerun ? <RunAgain phase={push.phase} /> : null}</>
          ) : (
            <>
              <button
                data-accept-delivery={d.id}
                disabled={!can("accept-delivery")}
                style={{ fontWeight: 600, padding: `${SP.xs}px ${SP.md}px` }}
                title={can("accept-delivery") ? "Accept it — this merges the work into your branch and pushes it." : refusalSentence("accept-delivery", push.phase)}
                onClick={() => post({ action: "accept-delivery", deliveryId: d.id })}
              >
                Accept
              </button>
              <button
                data-reject-delivery={d.id}
                disabled={!can("reject-delivery")}
                style={{ padding: `${SP.xs}px ${SP.md}px` }}
                title={can("reject-delivery") ? "Not this — the work stays on its branch and the signed promises can run again." : refusalSentence("reject-delivery", push.phase)}
                onClick={() => post({ action: "reject-delivery", deliveryId: d.id })}
              >
                Not this
              </button>
              {d.rerun ? <RunAgain phase={push.phase} /> : null}
              {push.acceptRefusal ? (
                <div data-accept-refusal style={{ fontSize: FS.body, color: C.bad, flexBasis: "100%", marginTop: SP.xs }}>
                  Not accepted — {push.acceptRefusal}
                </div>
              ) : null}
            </>
          )}
          {d.pending?.length ? (
            <div data-pending={d.id} style={{ fontSize: FS.body, flexBasis: "100%", marginTop: SP.sm }}>
              <strong>Answered after the merge — not by anything this run could reach:</strong>
              <ul style={{ margin: `${SP.xs}px 0 0`, paddingLeft: 18 }}>
                {d.pending.map((p, i) => (
                  <li key={i} style={{ marginBottom: SP.xs }}>
                    {p.text}
                    <span style={{ color: C.quiet }}> — settled by {p.settledBy}</span>
                    {p.criterionId && /attest|person|clean node|install/i.test(p.settledBy) ? (
                      <div style={{ marginTop: SP.xs }}>
                        <button data-attest-held={p.criterionId} onClick={() => post({ action: "attest", deliveryId: d.id, criterionId: p.criterionId!, held: true })}>It held</button>{" "}
                        <button data-attest-broke={p.criterionId} onClick={() => post({ action: "attest", deliveryId: d.id, criterionId: p.criterionId!, held: false })}>It did not</button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </article>
    </div>
  );
}
