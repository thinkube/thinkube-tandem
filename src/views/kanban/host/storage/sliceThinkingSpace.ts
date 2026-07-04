/**
 * Pure projection: Tandem slice records → kanban Thinking Space. No vscode, no fs — the
 * ThinkubeFilesAdapter does the I/O and calls these. Unit-tested directly.
 *
 * Each slice file (`.thinkube/specs/SP-{id}/SL-{m}.md`) becomes one card whose
 * string `id` IS the human handle `SP-{id}_SL-{m}` — that handle is the card's
 * identity across the host↔webview boundary (SP-7). Spec ids are opaque strings
 * (base36-epoch for new Specs, legacy integers for old ones), so there is no
 * numeric card encoding; colour and the parent chip group by the parent Spec id.
 */
import { ThinkingSpace, ThinkingSpaceColumn, TaskCard } from "../types";
import { buildUnitDag } from "../../../../services/orchestratorCore";
import { sliceHandle as treeSliceHandle } from "../../../../store/treePaths";
import {
  classifySpecChange,
  SpecChangeKind,
} from "../../../../methodology/specChange";
import {
  extractAcceptanceCriteria,
  type AcceptanceItem,
} from "../../../../methodology/qualityGates";
import { isRetiredStatus } from "../../../../methodology/sliceLifecycle";

export const TANDEM_COLUMNS: ReadonlyArray<{ id: string; title: string }> = [
  { id: "column-ready", title: "Ready" },
  { id: "column-doing", title: "Doing" },
  { id: "column-attention", title: "Needs Attention" },
  { id: "column-done", title: "Done" },
];

const STATUS_TO_COLUMN: Record<string, string> = {
  ready: "column-ready",
  doing: "column-doing",
  "requires-attention": "column-attention",
  done: "column-done",
};

type SliceStatus = "ready" | "doing" | "requires-attention" | "done";

const COLUMN_TO_STATUS: Record<string, SliceStatus> = {
  "column-ready": "ready",
  "column-doing": "doing",
  "column-attention": "requires-attention",
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

export function columnIdToStatus(columnId: string): SliceStatus {
  return COLUMN_TO_STATUS[columnId] ?? "ready";
}

/** The canonical human handle for a slice, e.g. `SP-tw7n0g_SL-3`. */
export function sliceHandle(specId: string, sliceNumber: number): string {
  return `SP-${specId}_SL-${sliceNumber}`;
}

/**
 * The grouping key + card identity for a slice's parent Spec. In the org-scoped
 * nested tree a bare `SP-m` repeats across TEPs, so a slice carrying a
 * `tepNumber` keys on the tep-qualified `TEP-n_SP-m`; a legacy (flat) slice keys
 * on its bare opaque spec id. Cards, colour, the per-Spec tally, and the
 * acceptance close-card all group on this key.
 */
function specKeyOf(s: SliceInput): string {
  return s.tepNumber != null
    ? `TEP-${s.tepNumber}_SP-${s.specNumber}`
    : s.specNumber;
}

/**
 * The slice's card handle: the tep-qualified `TEP-n_SP-m_SL-k` flattening for a
 * nested-tree slice (so cross-spec `depends_on`, branches, and worktrees stay
 * unique when bare SP/SL numbers repeat), else the legacy `SP-{id}_SL-{m}`.
 */
function handleOf(s: SliceInput): string {
  return s.tepNumber != null
    ? treeSliceHandle(s.tepNumber, Number(s.specNumber), s.sliceNumber)
    : sliceHandle(s.specNumber, s.sliceNumber);
}

/** The acceptance close-card id for a parent-spec grouping key. */
function acceptIdForKey(specKey: string, nested: boolean): string {
  return nested ? `${specKey}_accept` : `SP-${specKey}_accept`;
}

export interface SliceInput {
  /** Parent Spec id — an opaque string (base36-epoch, or a legacy integer). */
  specNumber: string;
  /**
   * Parent TEP number when the slice was discovered in the org-scoped nested
   * tree (`<org>/teps/TEP-n/SP-m/SL-k.md`, SP-th8m5b / TEP-th8lzj). Present ⇒ the
   * card handle flattens to the tep-qualified `TEP-n_SP-m_SL-k` form and the
   * slice groups under the tep-qualified spec key `TEP-n_SP-m`, so bare SP/SL
   * numbers that repeat across TEPs never collide. Omitted ⇒ the legacy flat
   * `SP-{id}_SL-{m}` handle and bare-spec-id grouping (back-compat).
   */
  tepNumber?: number;
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
  /** Slice frontmatter `parallel_group` — the named concurrency group (SP-tgpwbm). */
  parallelGroup?: string;
  /** Slice frontmatter `assignee` — current owner; empty until the arbiter claims it. */
  assignee?: string;
  /** Slice frontmatter `files` — the declared machine-readable file set. */
  files?: string[];
  /** Slice frontmatter `depends_on` — dependency handles (slice-DAG edges). */
  dependsOn?: string[];
  /** Slice frontmatter `work_units` — the execution-aware units (SP-tgs8gb). */
  workUnits?: {
    footprint: string[];
    depends_on?: string[];
    execution: "serial" | "mechanize" | "fan-out";
    note?: string;
  }[];
  /** Effective clustering tags (SP-tgvil2) — `tags` folded with legacy `theme`. */
  tags?: string[];
}

/**
 * Project slice records into a Thinking Space. Archived slices are excluded — they keep
 * their files (to hold their numbers; archive-don't-delete) but don't appear on
 * the active thinking space.
 */
export interface SpecMeta {
  /** Spec frontmatter `accepted:` present — the human-accept was recorded. */
  accepted: boolean;
  /** Every acceptance criterion on the Spec is checked. */
  allAcsChecked: boolean;
  /** The Spec's `## Acceptance Criteria` as a checklist — shown on the card. */
  criteria: AcceptanceItem[];
  /** Spec frontmatter `archived: true` — its cards drop off the thinking space (TEP-tg86v7). */
  archived: boolean;
  /** Spec frontmatter `superseded:` present (SP-6/14) — deliberately not building it; the
   *  acceptance card's Orchestrate action is disabled (a superseded Spec is not advanceable). */
  superseded: boolean;
}

/**
 * Derive a Spec's close-card state from its doc. `accepted` is true when the
 * `accepted:` stamp is present (set by `accept_spec`); `allAcsChecked` requires
 * at least one AC and every box checked (mirrors `gateSpecAcceptance`, which
 * refuses a Spec with no `## Acceptance Criteria`); `criteria` is the checklist
 * the card renders so the human sees what they're signing off. The I/O wrappers
 * (the adapter, the MCP `list_thinking_space`) read the doc; this keeps the rule in one
 * place.
 */
export function deriveSpecMeta(
  frontmatter:
    | { accepted?: unknown; archived?: unknown; superseded?: unknown }
    | undefined,
  body: string | undefined,
): SpecMeta {
  const accepted = frontmatter?.accepted != null && frontmatter.accepted !== "";
  const criteria = extractAcceptanceCriteria(body ?? "");
  return {
    accepted,
    allAcsChecked: criteria.length > 0 && criteria.every((i) => i.checked),
    criteria,
    archived: frontmatter?.archived === true,
    superseded:
      typeof frontmatter?.superseded === "string" &&
      frontmatter.superseded.trim().length > 0,
  };
}

export function buildSliceThinkingSpace(
  slices: SliceInput[],
  scope: string,
  specMeta?: ReadonlyMap<string, SpecMeta>,
): ThinkingSpace {
  const tasks: Record<string, TaskCard> = {};
  const byColumn = new Map<string, string[]>();
  for (const c of TANDEM_COLUMNS) byColumn.set(c.id, []);
  // Per-Spec slice tally → the acceptance card's readiness. Keyed by the
  // (possibly tep-qualified) spec grouping key so SP-m's that repeat across TEPs
  // stay distinct, and carrying `tep` so the close card can be formatted.
  const specSlices = new Map<
    string,
    { total: number; done: number; nested: boolean }
  >();

  const ordered = [...slices].sort(
    (a, b) =>
      specKeyOf(a).localeCompare(specKeyOf(b)) || a.sliceNumber - b.sliceNumber,
  );

  // ── One DAG — the one that executes ─────────────────────────────────────────
  // Resolve work-unit dependencies the SAME way the orchestrator's scheduler does:
  // `buildUnitDag` over a whole Spec's slices at once (NOT one slice at a time). The
  // old per-slice call blinded the panel to cross-slice `consumes` edges — the scheduler
  // resolved them, the rendered graph didn't. Grouped per Spec to match the scheduler's
  // scope (it orchestrates one Spec at a time), over only the renderable slices so no edge
  // points at an archived/retired card. `buildUnitDag` is the single edge-resolution entry
  // point; this caller and the orchestrator now feed it the same shape — they cannot drift.
  const unitNodesBySlice = new Map<string, ReturnType<typeof buildUnitDag>>();
  const slicesBySpec = new Map<string, SliceInput[]>();
  for (const s of ordered) {
    const st = (s.status ?? "").toLowerCase();
    if (st === "archived" || isRetiredStatus(s.status ?? "")) continue;
    if (specMeta?.get(specKeyOf(s))?.archived) continue;
    const k = specKeyOf(s);
    const arr = slicesBySpec.get(k);
    if (arr) arr.push(s);
    else slicesBySpec.set(k, [s]);
  }
  for (const group of slicesBySpec.values()) {
    for (const u of buildUnitDag(
      group.map((s) => ({
        handle: handleOf(s),
        status: s.status ?? "",
        requires: s.dependsOn ?? [],
        files: s.files ?? [],
        workUnits: s.workUnits ?? [],
      })),
    )) {
      const arr = unitNodesBySlice.get(u.slice);
      if (arr) arr.push(u);
      else unitNodesBySlice.set(u.slice, [u]);
    }
  }

  for (const s of ordered) {
    if ((s.status ?? "").toLowerCase() === "archived") continue;
    // A retired slice (SP-th4wqd) is terminal-and-DISTINCT-from-Done: it drops off the
    // active thinking space and (via the skipped tally below) out of its Spec's slice count, so a
    // re-cut Spec can still close. Its SL-{m} stays reserved on disk (numbering reads files,
    // not the thinking space projection), so a retired number is never reused.
    if (isRetiredStatus(s.status ?? "")) continue;
    const specKey = specKeyOf(s);
    // An archived parent Spec drops off the thinking space entirely (TEP-tg86v7): skip its
    // slices, which (via the tally below) also suppresses its acceptance card.
    if (specMeta?.get(specKey)?.archived) continue;
    const id = handleOf(s);
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
      colorSlug: paletteForParent(specKey),
      parentId: specKey,
      updatedAt: s.updatedAt,
      dueDate: s.due,
      priority: s.priority,
      specStale: specChange === "requirements",
      specChange,
      commit: s.commit,
      commitUrl: s.commitUrl,
      pr: s.pr,
      dependsOn: s.dependsOn,
      tags: s.tags,
      // The slice's execution-unit nodes, projected from the canonical per-Spec DAG
      // computed above (so cross-slice `consumes` edges show exactly as the scheduler
      // resolves them). Ids (`${handle}#eu-${i}`) align with the live runningWorkers keys;
      // a slice with no work_units contributes one node (= its handle).
      workUnits: (unitNodesBySlice.get(id) ?? []).map((u) => ({
        id: u.id,
        shape: u.shape,
        note: u.note,
        dependsOn: u.requires,
      })),
    };
    tasks[id] = card;
    byColumn.get(columnId)?.push(id);
    const agg = specSlices.get(specKey) ?? {
      total: 0,
      done: 0,
      nested: s.tepNumber != null,
    };
    agg.total++;
    if ((s.status ?? "").toLowerCase() === "done") agg.done++;
    specSlices.set(specKey, agg);
  }

  // One close card per Spec that has slices (TEP-0010), auto-derived — not a
  // slice file. It carries the Spec's acceptance-criteria checklist + slice
  // progress so the human sees what they're signing off. An accepted Spec's card
  // rests in Done (a record, kept not hidden); an unaccepted Spec's card sits in
  // Ready, its "Approve & close" button gated by `acceptReady` (all slices Done
  // AND all ACs checked). Historical Specs are stamped `accepted:` so they rest
  // in Done rather than begging in Ready.
  for (const [specKey, agg] of specSlices) {
    const meta = specMeta?.get(specKey);
    const accepted = meta?.accepted ?? false;
    const acceptReady =
      agg.total > 0 && agg.done === agg.total && (meta?.allAcsChecked ?? false);
    const id = acceptIdForKey(specKey, agg.nested);
    // The legacy flat card shows `SP-{id}`; a nested card's key already carries
    // the `TEP-n_SP-m` qualification, so show it verbatim.
    const description = agg.nested ? specKey : `SP-${specKey}`;
    const columnId = accepted ? "column-done" : "column-ready";
    tasks[id] = {
      id,
      description,
      columnId,
      colorSlug: paletteForParent(specKey),
      parentId: specKey,
      isAcceptance: true,
      accepted,
      acceptReady,
      superseded: meta?.superseded ?? false,
      acceptanceCriteria: meta?.criteria ?? [],
      slicesDone: agg.done,
      slicesTotal: agg.total,
    };
    byColumn.get(columnId)?.push(id);
  }

  const columns: ThinkingSpaceColumn[] = TANDEM_COLUMNS.map((c) => ({
    id: c.id,
    title: c.title,
    tasksIds: byColumn.get(c.id) ?? [],
  }));
  return { columns, tasks, scope };
}
