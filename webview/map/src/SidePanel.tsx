/**
 * The selected unit's detail — the rail's lower half: members with the
 * machine-face flip, cut membership, pins.
 */
import { post, SpacePush } from "./vscode";

export function SidePanel(props: {
  push: SpacePush;
  selected: string | null;
  flipped: Set<string>;
  onFlip: (id: string) => void;
}): JSX.Element {
  const { push } = props;
  const unit = push.units.find((u) => u.id === props.selected);
  const btn: React.CSSProperties = {
    background: "var(--vscode-button-background)",
    color: "var(--vscode-button-foreground)",
    border: "none",
    borderRadius: 4,
    padding: "4px 12px",
    cursor: "pointer",
    fontWeight: 600,
  };
  return (
    <div
      style={{
        width: 360,
        borderLeft: "1px solid var(--vscode-panel-border, #333)",
        padding: 12,
        overflowY: "auto",
        fontSize: 13,
      }}
    >
      {unit ? (
        <section data-unit-panel style={{ marginBottom: 16 }}>
          <strong>{unit.title}</strong>
          <div style={{ margin: "6px 0", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(() => {
              const cutUnits = push.units.filter((u) => u.inCut);
              return cutUnits.length >= 2 && unit.inCut ? (
                <button
                  data-pin-together
                  title="These units are one thing — pin them into one slice; the pin outranks the computed grouping"
                  onClick={() => {
                    for (let i = 1; i < cutUnits.length; i++)
                      post({ action: "pin", pinKind: "together", changeIds: [cutUnits[0].changeIds[0], cutUnits[i].changeIds[0]] });
                  }}
                >
                  Merge {cutUnits.length} into one slice
                </button>
              ) : null;
            })()}
            <button
              data-toggle-cut
              style={btn}
              onClick={() => post({ action: "toggle-cut", changeIds: unit.changeIds })}
            >
              {unit.inCut ? "Remove from cut" : "Add to cut"}
            </button>
          </div>
          {unit.nodes.map((n) => (
            <div key={n.id} style={{ padding: "4px 0" }}>
              <div>
                • {n.sentence}{" "}
                {unit.changeIds.length > 1 ? (
                  <button
                    data-pin-apart={n.id}
                    title="This change is not part of this unit — split it out; the pin outranks the computed grouping"
                    style={{ fontSize: 10, marginRight: 4 }}
                    onClick={() => {
                      const other = unit.changeIds.find((id) => id !== n.id);
                      if (other) post({ action: "pin", pinKind: "apart", changeIds: [n.id, other] });
                    }}
                  >
                    Split out
                  </button>
                ) : null}{" "}
                <span
                  data-flip={n.id}
                  title="Open the machine face"
                  style={{ cursor: "pointer", opacity: 0.6 }}
                  onClick={() => props.onFlip(n.id)}
                >
                  ⌄
                </span>
              </div>
              {props.flipped.has(n.id) ? (
                <pre
                  data-machine-face
                  style={{
                    fontSize: 11,
                    opacity: 0.85,
                    margin: "4px 0 4px 12px",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {`lands at: ${n.touchpoints.join(", ") || "(not grounded)"}\nproven by: ${n.acceptance.join("; ") || "(nothing yet)"}`}
                </pre>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
      {(() => {
        const uncovered = push.units.filter((u) => u.coverage.covered < u.coverage.total);
        const staleUnits = push.units.filter((u) => u.stale);
        const chips: { key: string; label: string; color: string; unitId?: string }[] = [
          ...push.questions.map((q, i) => ({
            key: `q${i}`,
            label: `❓ ${q.text.length > 40 ? q.text.slice(0, 39) + "…" : q.text}`,
            color: "#d29922",
            unitId: push.units.find((u) =>
              u.nodes.some((n) => push.questions.some((x) => x.id === q.id)),
            )?.id,
          })),
          ...uncovered.map((u) => ({
            key: `c${u.id}`,
            label: `⚠ nothing proves: ${u.title.length > 32 ? u.title.slice(0, 31) + "…" : u.title}`,
            color: "#f59e0b",
            unitId: u.id,
          })),
          ...staleUnits.map((u) => ({
            key: `s${u.id}`,
            label: `stale: ${u.title.length > 32 ? u.title.slice(0, 31) + "…" : u.title}`,
            color: "#8b949e",
            unitId: u.id,
          })),
        ];
        return chips.length ? (
          <div data-next-actions style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "6px 12px 0", alignItems: "center" }}>
            <span style={{ fontSize: 11, opacity: 0.6 }}>needs you:</span>
            {chips.map((c) => (
              <button
                key={c.key}
                data-next-action={c.key}
                style={{ fontSize: 11, border: `1px solid ${c.color}`, color: c.color, background: "none", borderRadius: 10, padding: "1px 8px", cursor: c.unitId ? "pointer" : "default" }}
                onClick={() => c.unitId && setSelected(c.unitId)}
              >
                {c.label}
              </button>
            ))}
          </div>
        ) : null;
      })()}
      {push.asks.length ? (
        <section data-asks style={{ margin: "8px 12px" }}>
          <strong style={{ fontSize: 12 }}>You asked</strong>
          <ol style={{ margin: "4px 0 0 18px", padding: 0 }}>
            {push.asks.map((a) => (
              <li key={a.id} data-ask={a.id} style={{ fontSize: 12, opacity: 0.85 }}>
                {a.text}
                {push.activity?.askId === a.id ? (
                  <span style={{ marginLeft: 6, color: "var(--vscode-progressBar-background, #3794ff)" }}>
                    ⟳ {push.activity.label}… ({push.activity.current}/{push.activity.total})
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {push.cutCount > 0 ? (
        <section data-cut-screen style={{ marginBottom: 16 }}>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{push.cutScreen}</pre>
          <button data-sign style={btn} onClick={() => post({ action: "sign-cut" })}>
            Sign
          </button>
        </section>
      ) : null}
      {push.lastAnswer ? (
        <section data-answer style={{ margin: "8px 12px", padding: 8, border: "1px solid var(--vscode-panel-border, #333)", borderRadius: 6 }}>
          <div style={{ fontSize: 11, opacity: 0.6 }}>You asked: {push.lastAnswer.question}</div>
          <div style={{ fontSize: 13, whiteSpace: "pre-wrap", marginTop: 4 }}>{push.lastAnswer.answer}</div>
        </section>
      ) : null}
      {push.proposals.length ? (
        <section data-proposals style={{ margin: "8px 12px" }}>
          <strong style={{ fontSize: 12 }}>The machine suggests merging ({push.proposals.length})</strong>
          {push.proposals.map((p) => (
            <div key={p.id} data-proposal={p.id} style={{ fontSize: 12, display: "flex", gap: 8, alignItems: "center", padding: "3px 0" }}>
              <span style={{ flex: 1, opacity: 0.85 }}>
                “{p.aTitle}” + “{p.bTitle}” look like one slice
              </span>
              <button data-merge-accept={p.id} style={{ cursor: "pointer" }} onClick={() => post({ action: "accept-merge", proposalId: p.id })}>
                Merge
              </button>
              <button data-merge-reject={p.id} style={{ cursor: "pointer", opacity: 0.75 }} onClick={() => post({ action: "reject-merge", proposalId: p.id })}>
                Reject
              </button>
            </div>
          ))}
        </section>
      ) : null}
      {push.impacts.length ? (
        <section data-impacts style={{ margin: "8px 12px" }}>
          <strong style={{ fontSize: 12 }}>Your decisions imply changes ({push.impacts.length})</strong>
          {push.impacts.map((im) => (
            <div key={im.id} data-impact={im.id} style={{ fontSize: 12, display: "flex", gap: 8, alignItems: "center", padding: "3px 0" }}>
              <span style={{ flex: 1, opacity: 0.85 }}>
                “{im.decision}” implies re-deriving {im.affected} change(s) of “{im.askText.length > 40 ? im.askText.slice(0, 39) + "…" : im.askText}” — nothing changed yet
              </span>
              <button data-impact-accept={im.id} style={{ cursor: "pointer" }} onClick={() => post({ action: "accept-impact", impactId: im.id })}>
                Re-derive
              </button>
              <button data-impact-dismiss={im.id} style={{ cursor: "pointer", opacity: 0.75 }} onClick={() => post({ action: "dismiss-impact", impactId: im.id })}>
                Dismiss
              </button>
            </div>
          ))}
        </section>
      ) : null}
      {push.questions.length ? <Questions push={push} /> : null}
      {push.deliveries.map((d) => (
        <section key={d.id} data-delivery={d.id} style={{ marginBottom: 16 }}>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{d.page}</pre>
          {d.undelivered?.length ? (
            <div style={{ color: "#f59e0b", fontSize: 12, margin: "4px 0" }}>
              {d.undelivered.map((u, i) => (
                <div key={i}>UNDELIVERED: {u}</div>
              ))}
            </div>
          ) : null}
          {d.url ? (
            <div style={{ fontSize: 12, margin: "4px 0" }}>
              <a href={d.url}>{d.url}</a>
            </div>
          ) : null}
          {d.accepted ? (
            <span style={{ opacity: 0.7 }}>accepted</span>
          ) : (
            <button
              data-accept
              style={btn}
              onClick={() => post({ action: "accept-delivery", deliveryId: d.id })}
            >
              Accept
            </button>
          )}
        </section>
      ))}
    </div>
  );
}
