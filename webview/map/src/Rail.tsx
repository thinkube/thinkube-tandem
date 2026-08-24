/**
 * The rail beside the graphs: what the machine is doing right now, what it
 * has delivered, and the one press that commits.
 *
 * Nothing here asks for a decision the machine could make itself, and
 * nothing here repeats what is shown elsewhere — your asks live under the
 * box you write them in, and what was read from them on the reading page.
 */
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { can, post, SpacePush, whyNot } from "./vscode";
import { C, FS, O, SP, label, labelIn } from "./type";

const btn: React.CSSProperties = {
  fontWeight: 600,
  padding: `${SP.xs}px ${SP.md}px`,
};

/**
 * The chosen worker, read here: what it is, what it was asked to build,
 * and its own account of what it did.
 *
 * A node on the graph carries its title and nothing more. Everything a
 * node has to SAY is said here, in one place, for whichever node is
 * chosen — rather than a paragraph on every card and a floating panel
 * that only ever followed the one unit that happened to be running.
 */
function StepLog(props: {
  log: NonNullable<SpacePush["runLog"]>;
  unit?: NonNullable<SpacePush["run"]>["units"][number];
}): JSX.Element {
  const { log, unit } = props;
  // A log is read the way a terminal is read: it scrolls, and it follows
  // what is arriving unless you have scrolled back to look at something —
  // in which case it leaves you where you are.
  const box = useRef<HTMLPreElement>(null);
  const [following, setFollowing] = useState(true);
  useEffect(() => {
    if (following && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [log.lines.length, log.total, following]);
  return (
    <section data-step-log style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong style={{ fontSize: FS.body }}>{log.step}</strong>

      </div>
      {unit ? (
        <>
          <div style={{ fontSize: FS.caption, color: C.quiet }}>
            {unit.role === "test" ? "writes the checks" : "writes the code"} for{" "}
            {unit.sliceTitle ?? unit.slice}
          </div>
          {unit.what ? (
            <>
              <div style={label}>What it builds</div>
              <div style={{ fontSize: FS.caption, whiteSpace: "pre-wrap" }}>{unit.what}</div>
            </>
          ) : null}
          {unit.waits?.length ? (
            <>
              <div style={label}>Waits for</div>
              {unit.waits.map((w) => (
                <div key={w.on} style={{ fontSize: FS.caption, color: C.quiet }}>
                  {w.on} —{" "}
                  {w.kind === "probes"
                    ? "its own probes, written before the code"
                    : `what it needs${w.what ? `: ${w.what}` : ""}`}
                </div>
              ))}
            </>
          ) : null}
          {unit.note ? (
            <>
              <div style={labelIn(unit.state === "failed" ? C.bad : C.quiet)}>What happened</div>
              <div style={{ fontSize: FS.caption, whiteSpace: "pre-wrap" }}>{unit.note}</div>
            </>
          ) : null}
          <div style={label}>Its own account</div>
        </>
      ) : null}
      <pre
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
        }}
        style={{
          whiteSpace: "pre-wrap",
          fontSize: FS.caption,
          background: "var(--vscode-textCodeBlock-background, #1e1e1e)",
          border: `1px solid ${C.border}`,
          borderRadius: 4,
          padding: `${SP.sm}px ${SP.md}px`,
          margin: "4px 0",
          maxHeight: "26rem",
          overflowY: "auto",
        }}
      >
        {log.lines.join("\n") || "(nothing yet)"}
      </pre>
      <div style={{ display: "flex", gap: SP.sm, alignItems: "center", fontSize: FS.caption }}>
        {following ? (
          <span data-log-live style={{ color: C.ok }}>following</span>
        ) : (
          <button
            data-log-newest
            title="Back to the newest lines, and follow them as they arrive."
            onClick={() => {
              setFollowing(true);
              if (box.current) box.current.scrollTop = box.current.scrollHeight;
            }}
          >
            follow again
          </button>
        )}
        <span style={{ color: C.quiet }}>
          {log.total > log.shown
            ? `newest ${log.shown} of ${log.total} lines`
            : `${log.total} line${log.total === 1 ? "" : "s"}`}
        </span>
      </div>
    </section>
  );
}

/** What the human alone can answer: a worker that cannot go on without them. */
function Parked(props: { push: SpacePush }): JSX.Element | null {
  const parked = props.push.run?.parked ?? [];
  if (!parked.length) return null;
  return (
    <section data-parked style={{ marginBottom: 14 }}>
      <strong style={{ fontSize: FS.body, color: C.ask }}>A worker needs you</strong>
      {parked.map((p) => (
        <div key={p.unitId} style={{ marginTop: 4 }}>
          <div style={{ fontSize: FS.body }}>{p.question}</div>
          <textarea
            id={`answer-${p.unitId}`}
            rows={2}
            style={{ width: "100%", fontSize: FS.body, marginTop: 2 }}
            placeholder="your answer"
          />
          <button
            data-answer-worker={p.unitId}
            style={{ fontSize: FS.caption }}
            onClick={() => {
              const el = document.getElementById(`answer-${p.unitId}`) as HTMLTextAreaElement | null;
              if (el?.value.trim())
                post({ action: "answer-worker", unitId: p.unitId, text: el.value });
            }}
          >
            Send
          </button>
        </div>
      ))}
    </section>
  );
}

/**
 * The not-needed reason: recorded before signing, when this cut writes no
 * documentation on purpose. A blank or whitespace-only reason posts
 * nothing — the host records a waiver only for a stated reason.
 */
function DocsWaiver(props: { phase: SpacePush["phase"] }): JSX.Element {
  const [reason, setReason] = useState("");
  return (
    <div data-docs-waiver style={{ marginTop: SP.sm }}>
      <input
        data-docs-waiver-reason
        type="text"
        value={reason}
        disabled={!can("waive-docs")}
        placeholder="why documentation is not needed"
        style={{ width: "100%", fontSize: FS.body }}
        title={can("waive-docs") ? "Recorded on the cut review, in place of a docs/ path." : whyNot(props.phase)}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setReason(e.target.value)}
      />
      <button
        data-waive-docs
        disabled={!can("waive-docs")}
        style={{ width: "100%", marginTop: SP.xs }}
        title="Documentation is not needed for this cut, for the reason above."
        onClick={() => {
          const trimmed = reason.trim();
          if (!trimmed) return;
          post({ action: "waive-docs", text: trimmed });
        }}
      >
        Documentation not needed
      </button>
    </div>
  );
}

export function Rail(props: {
  push: SpacePush;
  /** Build lives on the work page and nowhere else: pressing it is the one
   *  act that cannot be undone, and it must not sit beside a reading the
   *  human has not been shown the work for. */
  canBuild: boolean;
}): JSX.Element {
  const { push } = props;
  const ready = push.ready;

  return (
    <div
      data-rail
      style={{
        width: 320,
        borderLeft: `1px solid ${C.border}`,
        overflowY: "auto",
        fontSize: FS.body,
        flexShrink: 0,
      }}
    >
      <div style={{ padding: 10 }}>
        <Parked push={push} />
        {push.runLog ? (
          <StepLog
            log={push.runLog}
            unit={push.run?.units.find((u) => u.id === push.runLog!.step)}
          />
        ) : null}

        {!props.canBuild ? null : ready.thinking ? (
          <div style={{ fontSize: FS.caption, opacity: O.dim, marginBottom: 14 }}>
            Still working out what to build — nothing can be committed until every subject is
            thought through.
          </div>
        ) : ready.subjects ? (
          <section data-build-section style={{ marginBottom: 14 }}>
            <div style={label}>Pressing this</div>
            <ul
              data-build-price
              style={{ fontSize: FS.caption, margin: 0, paddingLeft: SP.lg, lineHeight: 1.5 }}
            >
              <li>signs this work and mints a TEP number for it</li>
              {push.questions.length ? (
                <li>
                  records the machine's own answer to {push.questions.length} question
                  {push.questions.length === 1 ? "" : "s"} you have not answered — they are above the
                  graph, and answering one first replaces its answer with yours
                </li>
              ) : null}
              <li>
                locks the {ready.asks} sentence{ready.asks === 1 ? "" : "s"} behind it: from then on
                they are read-only and can only be changed by writing a new one
              </li>
              <li>
                starts the workers on {ready.promises} promise
                {ready.promises === 1 ? "" : "s"} — this is what spends money
              </li>
              <li>pushes a branch, which stays whether or not you accept what comes back</li>
              <li>
                nothing is merged until you accept the delivery. Once you do, this thinking space
                becomes the record of that decision and can no longer be deleted
              </li>
            </ul>
            <button
              data-open-cut-review
              disabled={!can("open-cut-review")}
              style={{ width: "100%", marginTop: SP.sm }}
              title={
                can("open-cut-review")
                  ? "Open the whole cut as a page you can read: every promise, where it lands, and what will prove it."
                  : whyNot(push.phase)
              }
              onClick={() => post({ action: "open-cut-review" })}
            >
              Read the cut review first
            </button>
            <DocsWaiver phase={push.phase} />
            <button
              data-build
              disabled={!can("build")}
              style={{ ...btn, width: "100%", marginTop: SP.sm }}
              title={can("build") ? "Sign this work and start the workers." : whyNot(push.phase)}
              onClick={() => post({ action: "build" })}
            >
              Sign and build {ready.subjects} subject{ready.subjects === 1 ? "" : "s"}
            </button>
            {push.buildRefusal ? (
              <div data-build-refusal style={{ fontSize: FS.body, color: C.bad, marginTop: SP.xs }}>
                {push.buildRefusal}
              </div>
            ) : null}
          </section>
        ) : null}

      </div>
    </div>
  );
}
