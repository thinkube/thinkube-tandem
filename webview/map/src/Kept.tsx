/**
 * What the work noticed, kept for later — from every cut, in one place.
 *
 * A discovery arrives while the goals a person started with are still
 * being built. Turning it into an ask there and then puts it in front of
 * work they chose first, and reads every sentence again to do it. So a
 * finding is kept instead: it waits here, across cuts, until the person
 * says the discoveries are what comes next.
 */
import { C, FS, label, SP } from "./type";
import { post, SpacePush } from "./vscode";

export function Kept(props: { push: SpacePush }): JSX.Element | null {
  // Every cut's kept findings, oldest cut first, each still carrying the
  // ask its finder drafted.
  const kept = props.push.deliveries.flatMap((d) =>
    (d.findings ?? []).filter((f) => f.kept && !f.taken).map((f) => ({ ...f, from: d.tep ?? d.id })),
  );
  if (!kept.length) return null;
  return (
    <div data-kept style={{ marginBottom: SP.lg }}>
      <div style={label}>Kept for later</div>
      <div style={{ fontSize: FS.caption, color: C.quiet, marginBottom: SP.sm }}>
        Wanted, but not part of what is being built now. They wait here until you ask for them.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: SP.sm }}>
        {kept.map((f, i) => (
          <div
            key={`${f.from}-${i}`}
            data-kept-finding={i}
            style={{
              padding: `${SP.sm}px ${SP.md}px`,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <span style={{ fontSize: FS.body, lineHeight: 1.5 }}>{f.text}</span>
            {f.ask ? (
              <span style={{ fontSize: FS.caption, color: C.quiet, lineHeight: 1.5 }}>Ask: {f.ask}</span>
            ) : null}
            <span style={{ fontSize: FS.caption, color: C.quiet }}>noticed in {f.from}</span>
          </div>
        ))}
      </div>
      <button
        data-ask-from-kept
        onClick={() => post({ action: "ask-from-kept" })}
        style={{ marginTop: SP.sm, fontSize: FS.body, fontWeight: 600, padding: `${SP.xs}px ${SP.md}px` }}
        title="Puts every kept finding's drafted ask in the capture box, to read and keep when you want them built."
      >
        {`Put these ${kept.length} in the box`}
      </button>
    </div>
  );
}
