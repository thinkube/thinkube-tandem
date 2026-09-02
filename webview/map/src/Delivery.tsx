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

/** How a sentence fared, read from the verdicts of the promises made from it. */
type Fate = "done" | "not kept" | "not judged" | "being built" | "not started";

function fateOf(promises: Promise_[], stage: string | undefined): Fate {
  const checks = promises.flatMap((p) => p.checks);
  if (checks.some((c) => c.verdict === "red")) return "not kept";
  if (checks.length && checks.every((c) => c.verdict === "green")) return "done";
  if (checks.some((c) => c.verdict === "unjudged")) return "not judged";
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
  const rows = push.sentences.map((s, i) => {
    const promises = byN.get(i + 1) ?? [];
    return { n: i + 1, text: s.text, promises, fate: fateOf(promises, s.bound?.stage) };
  });
  const happened = rows.filter((r) => r.fate !== "not started");
  const later = rows.filter((r) => r.fate === "not started");

  // What could not be judged, once, by its cause — each check counted once,
  // however many sentences share the promise it belongs to.
  const unjudged = new Map<string, number>();
  const counted = new Set<string>();
  for (const r of rows)
    for (const p of r.promises)
      for (const c of p.checks) {
        const key = `${p.id}\u0000${c.text}`;
        if (c.verdict !== "unjudged" || counted.has(key)) continue;
        counted.add(key);
        const why = c.said ?? "the check could not run";
        unjudged.set(why, (unjudged.get(why) ?? 0) + 1);
      }

  const seen = d.observations ?? [];
  const stuck = d.withheld ?? d.blocked;
  const account = [...(d.undelivered ?? [])];

  return (
    <div data-delivery-report style={{ flex: 1, overflowY: "auto", padding: `${SP.lg}px ${SP.xl}px ${SP.xl}px` }}>
      <article data-delivery={d.id} style={{ maxWidth: "60rem" }}>
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
                      .filter((p) => p.checks.some((c) => c.verdict === "red"))
                      .map((p) => (
                        <div key={p.id} data-broken={p.id} style={{ margin: `${SP.sm}px 0 0 38px`, padding: `${SP.sm}px ${SP.md}px`, borderLeft: `3px solid ${C.bad}`, background: C.raised, borderRadius: 4 }}>
                          <div style={{ fontFamily: SAID, fontSize: FS.body, lineHeight: 1.5 }}>{p.text}</div>
                          {p.checks
                            .filter((c) => c.verdict === "red")
                            .map((c, i) => (
                              <div key={i} style={{ fontSize: FS.body, marginTop: SP.xs }}>
                                {c.said ? c.said : "did not hold"}
                                <span style={{ color: C.quiet }}> — {c.text}</span>
                              </div>
                            ))}
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
          {d.accepted ? (
            <span data-accepted={d.id} style={{ color: C.ok, fontSize: FS.body, fontWeight: 600 }}>✓ Accepted</span>
          ) : stuck ? (
            <>{d.rerun ? <RunAgain phase={push.phase} /> : null}</>
          ) : (
            <>
              <button
                data-accept-delivery={d.id}
                disabled={!can("accept-delivery")}
                style={{ fontWeight: 600, padding: `${SP.xs}px ${SP.md}px` }}
                title={can("accept-delivery") ? "Accept it — this merges the work on the project's forge." : refusalSentence("accept-delivery", push.phase)}
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
