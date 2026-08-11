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
import { post, SpacePush } from "./vscode";

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
            ) : d.blocked ? (
              // Not offered, because it would be refused. A button that
              // cannot work says the work is ready to go into the project,
              // which over a page of red checks is the machine lying about
              // the one decision it exists to support.
              <div data-cannot-accept={d.id} style={{ fontSize: FS.body, color: C.bad }}>
                <strong>This cannot be accepted.</strong> {d.blocked}
              </div>
            ) : (
              <>
                <button
                  data-accept-delivery={d.id}
                  style={{ fontWeight: 600, padding: `${SP.xs}px ${SP.md}px` }}
                  title="Accept it — this merges the work on the project's forge."
                  onClick={() => post({ action: "accept-delivery", deliveryId: d.id })}
                >
                  Accept
                </button>
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
