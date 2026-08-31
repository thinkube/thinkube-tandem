/**
 * Every staged implication of a decision in force, each with a way to
 * apply it or set it aside — and, once more than one is waiting, one
 * press to apply them all. Renders nothing when the push stages none.
 */
import { can, post, refusalSentence, SpacePush } from "./vscode";
import { implicationRows } from "../../../src/surfaces/implications";
import { C, FS, O, SP, label } from "./type";

export function Implications(props: { push: SpacePush }): JSX.Element | null {
  const { push } = props;
  const rows = implicationRows(push);
  if (!rows.length) return null;
  return (
    <div data-implications style={{ padding: `${SP.sm}px ${SP.lg}px`, borderBottom: "1px solid var(--vscode-panel-border, #333)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={label}>
          {rows.length} implication{rows.length === 1 ? "" : "s"} staged
        </div>
        {rows.applyAll ? (
          <button
            data-apply-all-impacts
            disabled={!can("apply-all-impacts")}
            title={can("apply-all-impacts") ? "Apply every staged implication." : refusalSentence("apply-all-impacts", push.phase)}
            style={{ marginLeft: "auto", fontSize: FS.caption, cursor: "pointer" }}
            onClick={() => post({ action: "apply-all-impacts" })}
          >
            Apply all
          </button>
        ) : null}
      </div>
      {rows.map((row) => (
        <div
          key={row.id}
          data-implication={row.id}
          style={{
            marginTop: SP.xs,
            padding: `${SP.xs}px ${SP.md}px`,
            borderLeft: `3px solid ${C.border}`,
          }}
        >
          <div style={{ fontSize: FS.body }}>{row.decision}</div>
          <div style={{ fontSize: FS.caption, opacity: O.dim }}>
            re-derives: {row.askText} — {row.affected} promise{row.affected === 1 ? "" : "s"} touched
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button
              data-accept-impact={row.id}
              disabled={!can("accept-impact")}
              title={can("accept-impact") ? "Apply this implication." : refusalSentence("accept-impact", push.phase)}
              style={{ fontSize: FS.caption, cursor: "pointer" }}
              onClick={() => post(row.apply)}
            >
              Apply
            </button>
            <button
              data-dismiss-impact={row.id}
              disabled={!can("dismiss-impact")}
              title={can("dismiss-impact") ? "Set this implication aside." : refusalSentence("dismiss-impact", push.phase)}
              style={{ fontSize: FS.caption, cursor: "pointer" }}
              onClick={() => post(row.setAside)}
            >
              Set aside
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
