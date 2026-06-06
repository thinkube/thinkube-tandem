/**
 * Pure projection: Tandem slice records → kanban Board. No vscode, no fs — the
 * ThinkubeFilesAdapter does the I/O and calls these. Unit-tested directly.
 *
 * Each slice file (`.thinkube/specs/SP-{id}/SL-{m}.md`) becomes one card whose
 * string `id` IS the human handle `SP-{id}_SL-{m}` — that handle is the card's
 * identity across the host↔webview boundary (SP-7). Spec ids are opaque strings
 * (base36-epoch for new Specs, legacy integers for old ones), so there is no
 * numeric card encoding; colour and the parent chip group by the parent Spec id.
 */
import { Board, BoardColumn, TaskCard } from "../types";
import {
  classifySpecChange,
  SpecChangeKind,
} from "../../../../methodology/specChange";
import {
  extractAcceptanceCriteria,
  type AcceptanceItem,
} from "../../../../methodology/qualityGates";

export const TANDEM_COLUMNS: ReadonlyArray<{ id: string; title: string }> = [
  { id: "column-ready", title: "Ready" },
  { id: "column-doing", title: "Doing" },
  { id: "column-done", title: "Done" },
];

const STATUS_TO_COLUMN: Record<string, string> = {
  ready: "column-ready",
  doing: "column-doing",
  done: "column-done",
};

const COLUMN_TO_STATUS: Record<string, "ready" | "doing" | "done"> = {
  "column-ready": "ready",
  "column-doing": "doing",
  "column-done": "done",
};

const PALETTE_SLUGS = [
  "crimson",
  "amber",
  "lime",
  "teal",
  "azure",
  "indigo",
  "violet",
  "magenta",
  "slate",
];

/** 32-bit FNV-1a hash → unsigned int. Stable colour key for opaque string ids. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Card colour by parent Spec id, so a Spec's slices share a hue. */
export function paletteForParent(specId: string): string {
  return PALETTE_SLUGS[hashString(specId) % PALETTE_SLUGS.length];
}

export function statusToColumnId(status: string | undefined): string {
  return STATUS_TO_COLUMN[(status ?? "ready").toLowerCase()] ?? "column-ready";
}

export function columnIdToStatus(columnId: string): "ready" | "doing" | "done" {
  return COLUMN_TO_STATUS[columnId] ?? "ready";
}

/** The canonical human handle for a slice, e.g. `SP-tw7n0g_SL-3`. */
export function sliceHandle(specId: string, sliceNumber: number): string {
  return `SP-${specId}_SL-${sliceNumber}`;
}

export interface SliceInput {
  /** Parent Spec id — an opaque string (base36-epoch, or a legacy integer). */
  specNumber: string;
  sliceNumber: number;
  title: string;
  body?: string;
  /** Frontmatter `status:` — ready | doing | done | archived. */
  status?: string;
  due?: string;
  priority?: string;
  /** Slice frontmatter `verified_req_hash` (the /pair-next stamp). */
  stampedReqHash?: string;
  /** Parent Spec's current requirement-hash (computed by the adapter). */
  currentReqHash?: string;
  parentUpdatedAt?: string;
  updatedAt?: string;
  /** Delivery provenance captured on move-to-Done (SP-2): commit SHA. */
  commit?: string;
  /** Full URL to `commit` on the remote host, derived from the git remote. */
  commitUrl?: string;
  /** Pull-request URL carrying the slice. */
  pr?: string;
}

/**
 * Project slice records into a Board. Archived slices are excluded — they keep
 * their files (to hold their numbers; archive-don't-delete) but don't appear on
 * the active board.
 */
export interface SpecMeta {
  /** Spec frontmatter `accepted:` present — the human-accept was recorded. */
  accepted: boolean;
  /** Every acceptance criterion on the Spec is checked. */
  allAcsChecked: boolean;
  /** The Spec's `## Acceptance Criteria` as a checklist — shown on the card. */
  criteria: AcceptanceItem[];
  /** Spec frontmatter `archived: true` — its cards drop off the board (TEP-tg86v7). */
  archived: boolean;
}

/**
 * Derive a Spec's close-card state from its doc. `accepted` is true when the
 * `accepted:` stamp is present (set by `accept_spec`); `allAcsChecked` requires
 * at least one AC and every box checked (mirrors `gateSpecAcceptance`, which
 * refuses a Spec with no `## Acceptance Criteria`); `criteria` is the checklist
 * the card renders so the human sees what they're signing off. The I/O wrappers
 * (the adapter, the MCP `list_board`) read the doc; this keeps the rule in one
 * place.
 */
export function deriveSpecMeta(
  frontmatter: { accepted?: unknown; archived?: unknown } | undefined,
  body: string | undefined,
): SpecMeta {
  const accepted = frontmatter?.accepted != null && frontmatter.accepted !== "";
  const criteria = extractAcceptanceCriteria(body ?? "");
  return {
    accepted,
    allAcsChecked: criteria.length > 0 && criteria.every((i) => i.checked),
    criteria,
    archived: frontmatter?.archived === true,
  };
}

export function buildSliceBoard(
  slices: SliceInput[],
  scope: string,
  specMeta?: ReadonlyMap<string, SpecMeta>,
): Board {
  const tasks: Record<string, TaskCard> = {};
  const byColumn = new Map<string, string[]>();
  for (const c of TANDEM_COLUMNS) byColumn.set(c.id, []);
  // Per-Spec slice tally → the acceptance card's readiness.
  const specSlices = new Map<string, { total: number; done: number }>();

  const ordered = [...slices].sort(
    (a, b) =>
      a.specNumber.localeCompare(b.specNumber) || a.sliceNumber - b.sliceNumber,
  );

  for (const s of ordered) {
    if ((s.status ?? "").toLowerCase() === "archived") continue;
    // An archived parent Spec drops off the board entirely (TEP-tg86v7): skip its
    // slices, which (via the tally below) also suppresses its acceptance card.
    if (specMeta?.get(s.specNumber)?.archived) continue;
    const id = sliceHandle(s.specNumber, s.sliceNumber);
    const columnId = statusToColumnId(s.status);
    const specChange: SpecChangeKind = classifySpecChange({
      stampedReqHash: s.stampedReqHash,
      currentReqHash: s.currentReqHash,
      parentUpdatedAt: s.parentUpdatedAt,
      taskUpdatedAt: s.updatedAt,
    });
    const card: TaskCard = {
      id,
      description: s.title,
      body: s.body,
      columnId,
      colorSlug: paletteForParent(s.specNumber),
      parentId: s.specNumber,
      updatedAt: s.updatedAt,
      dueDate: s.due,
      priority: s.priority,
      specStale: specChange === "requirements",
      specChange,
      commit: s.commit,
      commitUrl: s.commitUrl,
      pr: s.pr,
    };
    tasks[id] = card;
    byColumn.get(columnId)?.push(id);
    const agg = specSlices.get(s.specNumber) ?? { total: 0, done: 0 };
    agg.total++;
    if ((s.status ?? "").toLowerCase() === "done") agg.done++;
    specSlices.set(s.specNumber, agg);
  }

  // One close card per Spec that has slices (TEP-0010), auto-derived — not a
  // slice file. It carries the Spec's acceptance-criteria checklist + slice
  // progress so the human sees what they're signing off. An accepted Spec's card
  // rests in Done (a record, kept not hidden); an unaccepted Spec's card sits in
  // Ready, its "Approve & close" button gated by `acceptReady` (all slices Done
  // AND all ACs checked). Historical Specs are stamped `accepted:` so they rest
  // in Done rather than begging in Ready.
  for (const [specId, agg] of specSlices) {
    const meta = specMeta?.get(specId);
    const accepted = meta?.accepted ?? false;
    const acceptReady =
      agg.total > 0 && agg.done === agg.total && (meta?.allAcsChecked ?? false);
    const id = `SP-${specId}_accept`;
    const columnId = accepted ? "column-done" : "column-ready";
    tasks[id] = {
      id,
      description: `SP-${specId}`,
      columnId,
      colorSlug: paletteForParent(specId),
      parentId: specId,
      isAcceptance: true,
      accepted,
      acceptReady,
      acceptanceCriteria: meta?.criteria ?? [],
      slicesDone: agg.done,
      slicesTotal: agg.total,
    };
    byColumn.get(columnId)?.push(id);
  }

  const columns: BoardColumn[] = TANDEM_COLUMNS.map((c) => ({
    id: c.id,
    title: c.title,
    tasksIds: byColumn.get(c.id) ?? [],
  }));
  return { columns, tasks, scope };
}
