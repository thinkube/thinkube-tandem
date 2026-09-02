/**
 * The rail beside the graphs: what the machine is doing right now, what it
 * has delivered, and the one press that commits.
 *
 * Nothing here asks for a decision the machine could make itself, and
 * nothing here repeats what is shown elsewhere — your asks live under the
 * box you write them in, and what was read from them on the reading page.
 */
import { useEffect, useRef, useState } from "react";
import { can, post, refusalSentence, SpacePush } from "./vscode";
import { C, FS, O, SAID, SP, label, labelIn } from "./type";
import { proofOfPass } from "../../../src/surfaces/surfaceContract";
import { parseBrief } from "../../../src/surfaces/briefText";

/**
 * What a unit builds, in its parts: each promise in the person's words,
 * where it lands as a file and a name, and what must be true when it is
 * done — never the brief's one unbroken line.
 */
function Builds(props: { what: string }): JSX.Element {
  const built = parseBrief(props.what);
  if (!built.length) return <div style={{ fontSize: FS.caption, whiteSpace: "pre-wrap" }}>{props.what}</div>;
  return (
    <div data-builds style={{ display: "flex", flexDirection: "column", gap: SP.md }}>
      {built.map((b, i) => (
        <div key={i} data-builds-promise>
          <div style={{ fontFamily: SAID, fontSize: FS.title, lineHeight: 1.45 }}>{b.promise}</div>
          {b.lands.length ? (
            <ul style={{ listStyle: "none", margin: `${SP.xs}px 0 0`, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              {b.lands.map((l, j) => (
                <li key={j} style={{ fontSize: FS.caption, color: C.quiet, overflowWrap: "anywhere" }} title={l.signature}>
                  <code style={{ fontSize: FS.caption }}>{l.path}</code>
                  {l.name ? (
                    <>
                      {" › "}
                      <code style={{ fontSize: FS.caption, color: "inherit" }}>{l.name}</code>
                    </>
                  ) : null}
                  {l.isNew ? <span> · new file</span> : null}
                  {l.signature ? (
                    <div style={{ fontFamily: "var(--vscode-editor-font-family, monospace)", fontSize: 10, opacity: O.dim, whiteSpace: "pre-wrap", marginLeft: SP.md }}>
                      {l.signature}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {b.criteria.length ? (
            <ul style={{ margin: `${SP.xs}px 0 0`, paddingLeft: SP.lg, fontSize: FS.caption, lineHeight: 1.5 }}>
              {b.criteria.map((c, j) => (
                <li key={j}>{c}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** The run's own steps, by the name a person reads. */
const PHASE_TITLES: Record<string, string> = {
  door: "The door — preparing the tree",
  gate: "The closing gate — every check, on the real state",
  delivery: "The delivery — handing it over",
  run: "The run",
};

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
      {/* The card's title first — the promise, in the person's words — and
          the step's own name under it, for the developer reading the log. */}
      {unit?.promiseLabel ? (
        <div style={{ fontFamily: SAID, fontSize: FS.heading, lineHeight: 1.4 }} title={unit.promiseLabel.full}>
          {unit.promiseLabel.label}
        </div>
      ) : null}
      {!unit && PHASE_TITLES[log.step] ? (
        <div style={{ fontSize: FS.heading, lineHeight: 1.4 }}>{PHASE_TITLES[log.step]}</div>
      ) : null}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong style={{ fontSize: FS.body, color: unit?.promiseLabel || PHASE_TITLES[log.step] ? C.quiet : "inherit" }}>{log.step}</strong>
      </div>
      {unit ? (
        <>
          <div style={{ fontSize: FS.caption, color: C.quiet }}>
            {unit.role === "test" ? "writes the checks" : unit.role === "maintain" ? "brings the tests under" : "writes the code"}
          </div>
          {unit.what ? (
            <>
              <div style={label}>What it builds</div>
              <Builds what={unit.what} />
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
        {log.lines.join("\n") || proofOfPass(0).text}
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

export function Rail(props: {
  push: SpacePush;
  /** Build lives on the work page and nowhere else: pressing it is the one
   *  act that cannot be undone, and it must not sit beside a reading the
   *  human has not been shown the work for. */
  canBuild: boolean;
}): JSX.Element | null {
  const { push } = props;
  const ready = push.ready;
  const doc = push.documentation;
  const docSettled = doc.state === "landed" || doc.state === "exempt";
  const [docReason, setDocReason] = useState("");
  const docReasonReady = docReason.trim().length > 0;
  // A rail with nothing to say draws nothing: an empty column beside a page
  // is a rule down the screen with no reason on it.
  const parked = push.run?.parked?.length ?? 0;
  const says = parked > 0 || !!push.runLog || (props.canBuild && (ready.thinking || ready.subjects > 0));
  if (!says) return null;

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
                  : refusalSentence("open-cut-review", push.phase)
              }
              onClick={() => post({ action: "open-cut-review" })}
            >
              Read the cut review first
            </button>
            {doc.state === "landed" ? (
              <div data-docs-landed style={{ fontSize: FS.caption, color: C.quiet, marginTop: SP.sm }}>
                Lands documentation: {doc.landings.join(", ")}
              </div>
            ) : doc.state === "exempt" ? (
              <div data-docs-exempt style={{ fontSize: FS.caption, color: C.quiet, marginTop: SP.sm }}>
                Documentation not needed: {doc.reason}
              </div>
            ) : (
              <div data-docs-exemption style={{ marginTop: SP.sm }}>
                <label htmlFor="docs-exemption-reason" style={label}>
                  This lands no documentation — say why it is not needed
                </label>
                <textarea
                  id="docs-exemption-reason"
                  data-docs-exemption-reason
                  rows={2}
                  style={{ width: "100%", fontSize: FS.body, marginTop: 2 }}
                  placeholder="documentation is not needed here because…"
                  value={docReason}
                  onChange={(e) => setDocReason(e.target.value)}
                  onBlur={() => {
                    if (docReasonReady) post({ action: "exempt-docs", reason: docReason });
                  }}
                />
              </div>
            )}
            <button
              data-build
              disabled={!can("build") || !(docSettled || docReasonReady)}
              style={{ ...btn, width: "100%", marginTop: SP.sm }}
              title={
                !docSettled && !docReasonReady
                  ? "Say why documentation is not needed, or ground a docs/ page, before signing."
                  : can("build")
                    ? "Sign this work and start the workers."
                    : refusalSentence("build", push.phase)
              }
              onClick={() => {
                if (!docSettled && docReasonReady) post({ action: "exempt-docs", reason: docReason });
                post({ action: "build" });
              }}
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
