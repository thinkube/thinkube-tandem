/**
 * Every cut this space has run, and the way back into one.
 *
 * A cut leaves three things behind: the report of what was delivered, the
 * run that produced it with each step's log, and the pictures its
 * reviewers took. All three stay on file, and a person comes back to
 * them — to check a translation against an earlier screenshot, or to take
 * one into the documentation. This is the strip that gets them there.
 */
import { C, FS, SP } from "./type";
import { post, SpacePush } from "./vscode";

/** The day and time a cut was delivered, short enough for a chip. */
function when(at: string): string {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const day = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${day} ${time}`;
}

export function CutHistory(props: {
  push: SpacePush;
  /** Which of the cut's two accounts is on screen. */
  view: "report" | "workers";
  onView: (v: "report" | "workers") => void;
}): JSX.Element | null {
  const { push } = props;
  const history = push.history ?? [];
  // Nothing to navigate: one cut and no run behind it.
  if (history.length < 2 && !history.some((h) => h.hasRun)) return null;
  const newest = history[0]?.cutId;
  const showing = push.showing ?? newest;
  const chip = (on: boolean): Record<string, string | number> => ({
    fontSize: FS.caption,
    padding: `${SP.xs}px ${SP.sm}px`,
    borderRadius: 5,
    border: `1px solid ${on ? C.focus : C.border}`,
    color: on ? C.focus : C.quiet,
    background: "none",
    cursor: push.running ? "default" : "pointer",
    whiteSpace: "nowrap",
  });
  return (
    <div
      data-cut-history
      style={{
        display: "flex",
        gap: SP.sm,
        alignItems: "center",
        flexWrap: "wrap",
        padding: `${SP.sm}px ${SP.lg}px`,
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <span style={{ fontSize: FS.caption, color: C.quiet }}>Cuts</span>
      {history.map((h) => (
        <button
          key={h.cutId}
          data-cut={h.cutId}
          data-showing={h.cutId === showing ? "yes" : undefined}
          disabled={!!push.running}
          title={
            push.running
              ? "a run is in flight — what it is doing is on the page"
              : `${h.deliveryId ? "the report" : "no report"}${h.hasRun ? ", the run and its pictures" : ""}`
          }
          onClick={() => post({ action: "look-at-cut", cutId: h.cutId === newest ? undefined : h.cutId })}
          style={chip(h.cutId === showing)}
        >
          {h.tepId ?? h.cutId}
          {h.at ? ` · ${when(h.at)}` : ""}
        </button>
      ))}
      <span style={{ flex: 1 }} />
      {/* The two accounts of the cut on screen. The run's own page is
          drawn while it happens and stays drawable afterwards, which is
          where its step logs and its reviewers' pictures are read. */}
      <button
        data-flow-view="report"
        onClick={() => props.onView("report")}
        disabled={!!push.running}
        style={chip(props.view === "report")}
      >
        Report
      </button>
      <button
        data-flow-view="workers"
        onClick={() => props.onView("workers")}
        style={chip(props.view === "workers")}
      >
        Run and logs
      </button>
    </div>
  );
}
