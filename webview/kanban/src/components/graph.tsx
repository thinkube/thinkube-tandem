/**
 * Control-center graph view (SP-tgs8nz SL-4): the **work-unit DAG** rendered as a node per
 * worker (execution unit), not per slice. Each slice's `workUnits` (expanded host-side from
 * `work_units` via the scheduler's batching) becomes one node — shown idle before dispatch and
 * coloured live as an Agent SDK worker runs on it. A slice with no work units yields a single
 * node (= the slice handle), so legacy slices render as before. Node ids align with the live
 * `runningWorkers` / `parkedWorkers` keys, so clicking a running node floats out *that SDK
 * worker's* JSON-log, and a parked (needs-input) node answers it via `/attend`. Pure
 * presentation over the thinking space the host already sends.
 */
import { useMemo } from "react";
import { useGlobalState } from "../utils/context";
import { postToHost } from "../utils/vscode";
import { lookupPalette } from "../utils/palette";
import { TaskCard, WorkUnitNode } from "../types";

/** Base node colour by the parent slice's column (status). */
const STATUS_SLUG: Record<string, string> = {
  "column-ready": "indigo",
  "column-doing": "azure",
  "column-attention": "amber",
  "column-done": "lime",
};

const RUNNING_COLOR = "#3fb950"; // a live SDK worker on this unit
const PARKED_COLOR = "#d29922"; // a needs-input worker awaiting an answer

function baseColor(columnId: string): string {
  return lookupPalette(STATUS_SLUG[columnId] ?? "slate").accent;
}

const NODE_W = 210;
const NODE_H = 56;
const COL_GAP = 80;
const ROW_GAP = 22;

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Strip the `SP-{id}_` prefix so the label reads `SL-1#eu-2` (or `SL-1` for a legacy node). */
function shortId(id: string): string {
  return id.replace(/^SP-[^_]+_/, "");
}

type UnitState =
  | "running"
  | "parked"
  | "done"
  | "attention"
  | "active"
  | "ready";

interface UnitNode {
  id: string;
  card: TaskCard;
  unit: WorkUnitNode;
  state: UnitState;
  accent: string;
  /** Effective dependency node-ids (slice-handle deps expanded to their unit ids). */
  deps: string[];
}

function unitStateOf(card: TaskCard, unitId: string): UnitState {
  if ((card.runningWorkers ?? []).includes(unitId)) return "running";
  if ((card.parkedWorkers ?? []).includes(unitId)) return "parked";
  // A unit that completed stays done (lime) even if its slice later lands in requires-attention
  // (a slice-level verify failure ≠ this unit failing) — the slice issue shows as a border below.
  if ((card.doneWorkers ?? []).includes(unitId)) return "done";
  switch (card.columnId) {
    case "column-done":
      return "done";
    case "column-attention":
      return "attention";
    case "column-doing":
      return "active";
    default:
      return "ready";
  }
}

function accentFor(state: UnitState, card: TaskCard): string {
  if (state === "running") return RUNNING_COLOR;
  if (state === "parked") return PARKED_COLOR;
  return baseColor(card.columnId);
}

export function GraphView(): JSX.Element {
  const { state } = useGlobalState();

  const { nodes, edges, specs, width, height } = useMemo(() => {
    // Slice cards only — exclude the auto-derived acceptance close-cards.
    const cards = Object.values(state.tasks).filter((t) => !t.isAcceptance);

    // A slice with no work_units still carries one synthetic unit (= its handle) from the host,
    // so every card contributes ≥1 node. Map slice handle → its unit ids (to expand slice-level
    // deps, which name a slice handle, into edges between the actual unit nodes).
    const unitsBySlice = new Map<string, string[]>();
    for (const c of cards)
      unitsBySlice.set(
        c.id,
        (c.workUnits ?? [{ id: c.id, shape: "serial" }]).map((u) => u.id),
      );

    const unitNodes: UnitNode[] = [];
    for (const c of cards) {
      const units = c.workUnits ?? [{ id: c.id, shape: "serial" as const }];
      for (const u of units) {
        const st = unitStateOf(c, u.id);
        // A dep may name a unit id (passes through) or a sibling slice handle (expand to its
        // units, so a cross-slice dependency draws edges between the real worker nodes).
        const deps = (u.dependsOn ?? []).flatMap(
          (d) => unitsBySlice.get(d) ?? [d],
        );
        unitNodes.push({
          id: u.id,
          card: c,
          unit: u,
          state: st,
          accent: accentFor(st, c),
          deps,
        });
      }
    }
    const byId = new Map(unitNodes.map((n) => [n.id, n]));

    // Layer each node by its longest dependency chain (topological depth).
    const depthCache = new Map<string, number>();
    const depthOf = (id: string, seen: Set<string> = new Set()): number => {
      const cached = depthCache.get(id);
      if (cached != null) return cached;
      if (seen.has(id)) return 0; // cycle guard
      seen.add(id);
      const deps = (byId.get(id)?.deps ?? []).filter((d) => byId.has(d));
      const d = deps.length
        ? 1 + Math.max(...deps.map((x) => depthOf(x, new Set(seen))))
        : 0;
      depthCache.set(id, d);
      return d;
    };

    const layers = new Map<number, UnitNode[]>();
    for (const n of unitNodes) {
      const d = depthOf(n.id);
      const arr = layers.get(d) ?? [];
      arr.push(n);
      layers.set(d, arr);
    }

    const pos = new Map<string, { x: number; y: number }>();
    let maxRows = 0;
    for (const [d, arr] of layers) {
      arr.forEach((n, i) =>
        pos.set(n.id, { x: d * (NODE_W + COL_GAP), y: i * (NODE_H + ROW_GAP) }),
      );
      maxRows = Math.max(maxRows, arr.length);
    }
    const maxDepth = layers.size ? Math.max(...layers.keys()) : 0;

    const placed = unitNodes.map((n) => {
      const p = pos.get(n.id) ?? { x: 0, y: 0 };
      return { node: n, x: p.x, y: p.y };
    });
    const lines = unitNodes.flatMap((n) =>
      n.deps
        .filter((d) => byId.has(d))
        .map((d) => ({
          key: `${d}->${n.id}`,
          from: pos.get(d) ?? { x: 0, y: 0 },
          to: pos.get(n.id) ?? { x: 0, y: 0 },
        })),
    );
    const specIds = [
      ...new Set(cards.map((c) => c.parentId).filter((p): p is string => !!p)),
    ].sort();
    // The auto-derived acceptance close-card carries the Spec's delivery state (TEP-0010):
    // `acceptReady` (every slice Done + every AC checked) gates Accept; `accepted` rests it.
    const acceptCards = new Map<string, TaskCard>();
    for (const t of Object.values(state.tasks))
      if (t.isAcceptance && t.parentId) acceptCards.set(t.parentId, t);
    // A Spec is orchestratable iff it has a dispatchable slice — ready (fresh) or
    // requires-attention (re-runnable). All-Done (or only in-flight) → nothing to dispatch.
    // Accept/Reject (SP-tgzyfy_SL-2) are the human exits on the delivery report: Accept the
    // gated merge (enabled only when every AC is checked), Reject opens a primed rework session.
    const specs = specIds.map((id) => {
      const acc = acceptCards.get(id);
      const accepted = !!acc?.accepted;
      // SP-6/14: a superseded Spec is not advanceable — its Orchestrate action is
      // disabled (the host command also refuses, this just hides the dead button).
      const superseded = !!acc?.superseded;
      return {
        id,
        superseded,
        canRun:
          !superseded &&
          cards.some(
            (c) =>
              c.parentId === id &&
              (c.columnId === "column-ready" ||
                c.columnId === "column-attention"),
          ),
        accepted,
        canAccept: !!acc?.acceptReady && !accepted,
        canReject: !!acc && !accepted,
      };
    });
    return {
      nodes: placed,
      edges: lines,
      specs,
      width: (maxDepth + 1) * (NODE_W + COL_GAP),
      height: maxRows * (NODE_H + ROW_GAP) + ROW_GAP,
    };
  }, [state.tasks]);

  if (nodes.length === 0) {
    return (
      <div style={{ padding: 24, opacity: 0.7 }}>No work to graph yet.</div>
    );
  }

  const edgeColor = "var(--vscode-editorIndentGuide-background, #888)";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          padding: "8px 16px",
          borderBottom: "1px solid var(--vscode-panel-border, #333)",
        }}
      >
        <span style={{ fontSize: 11, opacity: 0.7, marginRight: 4 }}>
          Orchestrate
        </span>
        {specs.map((s) => {
          // A button's shared look; `enabled`/`secondary` vary cursor, opacity, and palette.
          const btn = (enabled: boolean, secondary?: boolean) => ({
            cursor: enabled ? "pointer" : "default",
            opacity: enabled ? 1 : 0.4,
            border: "1px solid var(--vscode-button-border, transparent)",
            background: secondary
              ? "var(--vscode-button-secondaryBackground, var(--vscode-button-background))"
              : "var(--vscode-button-background)",
            color: secondary
              ? "var(--vscode-button-secondaryForeground, var(--vscode-button-foreground))"
              : "var(--vscode-button-foreground)",
            borderRadius: 6,
            padding: "3px 10px",
            fontSize: 12,
            fontWeight: 600,
          });
          // Show the Accept/Reject exits once the Spec has an acceptance card (a delivery to
          // act on) — Accept gated on every AC checked, Reject opens a primed rework session.
          const showExits = s.canAccept || s.canReject || s.accepted;
          return (
            <span
              key={s.id}
              style={{ display: "inline-flex", gap: 4, alignItems: "center" }}
            >
              <button
                disabled={!s.canRun}
                title={
                  s.canRun
                    ? `Run the makespan scheduler on SP-${s.id} — dispatch its ready, footprint-disjoint units across N workers`
                    : s.superseded
                      ? `SP-${s.id} is superseded — unsupersede it first if you mean to build it`
                      : `SP-${s.id}: nothing to orchestrate — all slices are Done (or in flight)`
                }
                onClick={
                  s.canRun
                    ? () => postToHost({ kind: "orchestrate", spec: s.id })
                    : undefined
                }
                style={btn(s.canRun)}
              >
                ▶ SP-{s.id}
              </button>
              {showExits && (
                <>
                  <button
                    disabled={!s.canAccept}
                    title={
                      s.accepted
                        ? `SP-${s.id} is already accepted`
                        : s.canAccept
                          ? `Accept SP-${s.id} — merge spec/SP-${s.id} → main (every AC checked)`
                          : `SP-${s.id}: can't accept yet — every slice must be Done and every AC checked`
                    }
                    onClick={
                      s.canAccept
                        ? () => postToHost({ kind: "accept", spec: s.id })
                        : undefined
                    }
                    style={btn(s.canAccept)}
                  >
                    {s.accepted ? "✓ Accepted" : "✓ Accept"}
                  </button>
                  <button
                    disabled={!s.canReject}
                    title={
                      s.canReject
                        ? `Reject SP-${s.id} — open a Claude session primed with the delivery report to rework it`
                        : `SP-${s.id}: nothing to reject`
                    }
                    onClick={
                      s.canReject
                        ? () => postToHost({ kind: "reject", spec: s.id })
                        : undefined
                    }
                    style={btn(s.canReject, true)}
                  >
                    ✗ Reject
                  </button>
                </>
              )}
            </span>
          );
        })}
      </div>
      <div style={{ overflow: "auto", padding: 16, flex: 1 }}>
        <svg width={Math.max(width, 1)} height={Math.max(height, 1)}>
          <defs>
            <marker
              id="tk-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill={edgeColor} />
            </marker>
          </defs>
          {edges.map((e) => (
            <line
              key={e.key}
              x1={e.from.x + NODE_W}
              y1={e.from.y + NODE_H / 2}
              x2={e.to.x}
              y2={e.to.y + NODE_H / 2}
              stroke={edgeColor}
              strokeWidth={1.5}
              markerEnd="url(#tk-arrow)"
            />
          ))}
          {nodes.map(({ node, x, y }) => {
            const { card, unit, state: st, accent } = node;
            // Slice-level requires-attention (e.g. a red verify) — shown as an amber border + ⚑
            // on its nodes, so a unit that itself succeeded stays lime while the slice issue is visible.
            const sliceAttention = card.columnId === "column-attention";
            const borderColor =
              sliceAttention && st !== "attention" ? PARKED_COLOR : accent;
            // Actionable when: running (open its live log), parked (answer it), or its slice needs
            // attention (open the worktree to investigate + fix — attention is never just "retry").
            const wantsAttend = st === "parked" || sliceAttention;
            const clickable = st === "running" || wantsAttend;
            const onClick =
              st === "running"
                ? () => postToHost({ kind: "float-out", handle: node.id })
                : wantsAttend
                  ? () => postToHost({ kind: "attend", handle: card.id })
                  : undefined;
            const subtitle = unit.note ?? card.description;
            const title =
              st === "running"
                ? `${node.id} — click to open its live SDK-worker log`
                : st === "parked"
                  ? `${node.id} asked a question — click to answer (/attend)`
                  : sliceAttention
                    ? `${card.id} needs attention — click to open its worktree and investigate`
                    : `${node.id}${unit.note ? ` — ${unit.note}` : ""}`;
            return (
              <g
                key={node.id}
                transform={`translate(${x},${y})`}
                style={clickable ? { cursor: "pointer" } : undefined}
                onClick={
                  onClick
                    ? (e) => {
                        e.stopPropagation();
                        onClick();
                      }
                    : undefined
                }
              >
                <title>{title}</title>
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  fill="var(--vscode-editor-background)"
                  stroke={borderColor}
                  strokeWidth={sliceAttention ? 2.5 : 2}
                  strokeDasharray={st === "ready" ? "4 3" : undefined}
                />
                <rect width={6} height={NODE_H} rx={3} fill={accent} />
                {sliceAttention && (
                  <text
                    x={NODE_W - 16}
                    y={23}
                    fill={PARKED_COLOR}
                    fontSize={13}
                  >
                    ⚑
                  </text>
                )}
                <text
                  x={16}
                  y={22}
                  fill="var(--vscode-foreground)"
                  fontSize={12}
                  fontWeight={600}
                >
                  {truncate(shortId(node.id), 22)}
                </text>
                <text
                  x={16}
                  y={40}
                  fill="var(--vscode-descriptionForeground, #aaa)"
                  fontSize={10}
                >
                  {truncate(subtitle, 30)}
                </text>
                {/* Shape tag bottom-left; status word bottom-right. */}
                <text
                  x={16}
                  y={NODE_H - 6}
                  fill={accent}
                  fontSize={9}
                  opacity={0.85}
                >
                  {unit.shape}
                </text>
                {/* A "view log" affordance on every worker that has run (done / failed / running /
                  parked) — click to float out its JSON-log for debugging, even after a reload. */}
                {st !== "ready" && (
                  <text
                    x={NODE_W - 30}
                    y={15}
                    fill="var(--vscode-descriptionForeground, #aaa)"
                    fontSize={12}
                    style={{ cursor: "pointer" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      postToHost({ kind: "float-out", handle: node.id });
                    }}
                  >
                    <title>{`${node.id} — view this worker's log`}</title>≣
                  </text>
                )}
                {st === "running" && (
                  <>
                    <text
                      x={NODE_W - 58}
                      y={NODE_H - 6}
                      fill={RUNNING_COLOR}
                      fontSize={9}
                    >
                      running
                    </text>
                    <circle cx={NODE_W - 14} cy={16} r={5} fill={RUNNING_COLOR}>
                      <animate
                        attributeName="opacity"
                        values="1;0.3;1"
                        dur="1.2s"
                        repeatCount="indefinite"
                      />
                    </circle>
                  </>
                )}
                {st === "parked" && (
                  <>
                    <text
                      x={NODE_W - 78}
                      y={NODE_H - 6}
                      fill={PARKED_COLOR}
                      fontSize={9}
                    >
                      needs input
                    </text>
                    <circle
                      cx={NODE_W - 14}
                      cy={16}
                      r={5}
                      fill={PARKED_COLOR}
                    />
                  </>
                )}
                {st === "done" && (
                  <text
                    x={NODE_W - 36}
                    y={NODE_H - 6}
                    fill={accent}
                    fontSize={9}
                  >
                    done
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
