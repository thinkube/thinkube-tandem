/**
 * The delivery report: what the run made true, and the one decision left.
 *
 * It has the whole page rather than a column beside the graph, because it
 * is read to decide — and it is read once, so what it costs to read is
 * the whole cost of deciding. Accept sits at the end of it, where a
 * reader arrives having read what they are accepting.
 */
import { Markdown } from "./Markdown";
import { C, FS, raised, SP } from "./type";
import { can, post, SpacePush } from "./vscode";

/** The way back in: the signed work runs again. It is offered on every
 *  delivery that is not accepted — withheld, refused by the gate, or still
 *  waiting for a decision. Signing happens once, so a delivery the gate
 *  will not accept would otherwise leave the work with no door at all. */
function RunAgain(props: { rerun: { id: string; tepId?: string } }): JSX.Element {
  return (
    <button
      data-rerun
      disabled={!can("rerun")}
      style={{ fontWeight: 600 }}
      title="Start the signed work again. Nothing is signed twice and nothing you wrote changes."
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
          <Markdown text={d.page} />
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
                    <RunAgain rerun={d.rerun} />
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
                    <RunAgain rerun={d.rerun} />
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <button
                  data-accept-delivery={d.id}
                  disabled={!can("accept-delivery")}
                  style={{ fontWeight: 600, padding: `${SP.xs}px ${SP.md}px` }}
                  title="Accept it — this merges the work on the project's forge."
                  onClick={() => post({ action: "accept-delivery", deliveryId: d.id })}
                >
                  Accept
                </button>
                <button
                  data-reject-delivery={d.id}
                  disabled={!can("reject-delivery")}
                  style={{ padding: `${SP.xs}px ${SP.md}px` }}
                  title="Not this — the work stays on its branch and the signed promises can run again."
                  onClick={() => post({ action: "reject-delivery", deliveryId: d.id })}
                >
                  Not this
                </button>
                {d.rerun ? <RunAgain rerun={d.rerun} /> : null}
                <span style={{ fontSize: FS.caption, color: C.quiet }}>
                  Try it first — every “see it” line above is a way in.
                </span>
              </>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
