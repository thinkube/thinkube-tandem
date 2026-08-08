/**
 * Graph 1 — intent: what you want, in your words. One shape only, the
 * SUBJECT box; claims are rows inside it and promises live in the work
 * graph. Rules sit in a band above, and every subject shows which of them
 * govern it. Nothing here asks you to group anything by file.
 */
import { post, SpacePush } from "./vscode";

const box: React.CSSProperties = {
  border: "1px solid var(--vscode-panel-border, #3c3c3c)",
  borderRadius: 6,
  background: "var(--vscode-editorWidget-background, #252526)",
  overflow: "hidden",
};

/** The model the round proposed — shown BEFORE any code is read, so a
 *  wrong reading costs one cheap round instead of seven expensive ones. */
function Proposal(props: { push: SpacePush }): JSX.Element {
  const p = props.push.pendingModel!;
  return (
    <section data-proposal style={{ ...box, padding: 12, marginBottom: 14, borderColor: "#4ec9b0" }}>
      <strong style={{ fontSize: 13 }}>What I understood — nothing recorded yet</strong>
      <div style={{ fontSize: 11, opacity: 0.75, margin: "2px 0 8px" }}>
        {p.subjects.length} subject{p.subjects.length === 1 ? "" : "s"} · {p.rules.length} rule
        {p.rules.length === 1 ? "" : "s"}. Correct it before I think about your code.
      </div>
      {p.rules.length ? (
        <div data-proposed-rules style={{ border: "1px solid #e5c07b", borderRadius: 5, padding: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", color: "#e5c07b", marginBottom: 3 }}>
            Rules — these govern every subject
          </div>
          {p.rules.map((r, i) => (
            <div key={i} style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "baseline" }}>
              <span style={{ flex: 1 }}>
                {r.text} <em style={{ opacity: 0.7 }}>— {r.scope}</em>
              </span>
              <button
                data-drop-rule={i}
                title="Drop this rule — it is not something that governs everything."
                onClick={() => post({ action: "revise-model", kind: "drop-rule", page: i })}
              >
                Drop
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {p.subjects.map((s, i) => (
        <div key={i} data-proposed-subject={i} style={{ ...box, padding: 8, marginBottom: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <strong style={{ fontSize: 12 }}>{s.name}</strong>
            <span style={{ display: "flex", gap: 4 }}>
              <button
                data-to-rule={i}
                title="This is not one thing — its claims govern everything. Turn them into rules."
                onClick={() => post({ action: "revise-model", kind: "to-rule", page: i })}
              >
                Make rules
              </button>
              <button
                data-drop-subject={i}
                title="Drop this subject — I read something that is not there."
                onClick={() => post({ action: "revise-model", kind: "drop-subject", page: i })}
              >
                Drop
              </button>
            </span>
          </div>
          {s.claims.map((c, j) => (
            <div key={j} style={{ fontSize: 12, marginTop: 3, paddingLeft: 8, borderLeft: "2px solid #4ec9b0" }}>
              {c.text}
              {c.why ? <div style={{ fontSize: 11, opacity: 0.7, fontStyle: "italic" }}>{c.why}</div> : null}
            </div>
          ))}
        </div>
      ))}
      {p.missing.length ? (
        <div data-model-missing style={{ fontSize: 11, color: "#f14c4c", margin: "6px 0" }}>
          {p.missing.length} sentence(s) I could not place — they are recorded and waiting:
          {" "}
          {p.missing.join(" · ")}
        </div>
      ) : null}
      <button
        data-accept-model
        style={{ marginTop: 8, fontWeight: 600 }}
        title="Record this model and start thinking about your code, one round per subject."
        onClick={() => post({ action: "accept-model" })}
      >
        Yes — think about these
      </button>
    </section>
  );
}

export function IntentGraph(props: {
  push: SpacePush;
  selected: string | null;
  onSelect: (id: string) => void;
  onOpenWork: (subjectId: string) => void;
}): JSX.Element {
  const { push } = props;
  if (push.pendingModel) return <Proposal push={push} />;
  if (!push.subjects.length)
    return (
      <div style={{ flex: 1, padding: 24, opacity: 0.7 }}>
        Nothing here yet — paste what you want above and I will read it as one description.
      </div>
    );

  return (
    <div data-intent-graph style={{ flex: 1, overflowY: "auto", padding: 12 }}>
      {push.rules.length ? (
        <section
          data-rules-band
          style={{ border: "1px solid #e5c07b", borderRadius: 6, padding: "8px 10px", marginBottom: 12 }}
        >
          <div style={{ fontSize: 11, textTransform: "uppercase", color: "#e5c07b", marginBottom: 4 }}>
            Rules — they govern every subject, now and later
          </div>
          {push.rules.map((r) => (
            <div key={r.id} data-rule={r.id} style={{ fontSize: 12 }} title={`Governs ${r.scope}. From: ${r.fromAsk}`}>
              {r.text}{" "}
              <span style={{ opacity: 0.65, fontSize: 11 }}>
                — governs {r.scope} · in force on {r.governs} subject
                {r.governs === 1 ? "" : "s"}, and any new one that matches
              </span>
            </div>
          ))}
        </section>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(21rem, 1fr))", gap: 10 }}>
        {push.subjects.map((s) => {
          const promises = s.claims.reduce((n, c) => n + c.promises.length, 0);
          const unchecked = s.claims.reduce(
            (n, c) => n + c.promises.filter((p) => !p.checks.length).length,
            0,
          );
          return (
            <div
              key={s.id}
              data-subject={s.id}
              style={{
                ...box,
                borderColor: props.selected === s.id ? "var(--vscode-focusBorder, #3794ff)" : undefined,
              }}
            >
              <div
                data-subject-head={s.id}
                onClick={() => props.onSelect(s.id)}
                title="Select this subject."
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "7px 9px",
                  cursor: "pointer",
                  borderBottom: "1px solid var(--vscode-panel-border, #3c3c3c)",
                }}
              >
                <strong style={{ fontSize: 13 }}>{s.name}</strong>
                <span style={{ display: "flex", gap: 5, flexShrink: 0, fontSize: 11 }}>
                  {s.rules.length ? (
                    <span style={{ color: "#e5c07b" }} title={s.rules.map((r) => r.text).join("\n")}>
                      {s.rules.length} rules
                    </span>
                  ) : null}
                  {s.thinking ? (
                    <span style={{ color: "#4ec9b0" }}>
                      ⟳ {s.thinking.label} {s.thinking.current}/{s.thinking.total}
                    </span>
                  ) : (
                    <span style={{ opacity: 0.7 }}>{promises} promises</span>
                  )}
                </span>
              </div>
              {s.claims.map((c) => (
                <div
                  key={c.id}
                  data-claim={c.id}
                  onClick={() => props.onOpenWork(s.id)}
                  title="Open this claim's promises in the work graph."
                  style={{ padding: "6px 9px", cursor: "pointer", borderBottom: "1px solid var(--vscode-panel-border, #3c3c3c)" }}
                >
                  <div style={{ fontSize: 12 }}>{c.text}</div>
                  {c.why ? (
                    <div style={{ fontSize: 11, opacity: 0.7, fontStyle: "italic" }}>{c.why}</div>
                  ) : null}
                  <div style={{ fontSize: 11, opacity: 0.75, marginTop: 3 }}>
                    {c.promises.length} promise{c.promises.length === 1 ? "" : "s"}
                    {c.promises.length
                      ? c.promises.every((p) => p.checks.length)
                        ? " · all proved"
                        : ` · ${c.promises.filter((p) => !p.checks.length).length} without a check`
                      : " · nothing derived yet"}
                  </div>
                </div>
              ))}
              {unchecked ? (
                <div style={{ fontSize: 11, color: "#f14c4c", padding: "4px 9px" }}>
                  {unchecked} promise(s) here have no check
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {push.orphans.length ? (
        <section data-orphans style={{ marginTop: 12, border: "1px solid #f14c4c", borderRadius: 6, padding: "8px 10px" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", color: "#f14c4c", marginBottom: 4 }}>
            Scope creep — {push.orphans.length} promise(s) serve no claim or rule
          </div>
          {push.orphans.map((o) => (
            <div key={o.id} style={{ fontSize: 12 }}>
              {o.text}
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
