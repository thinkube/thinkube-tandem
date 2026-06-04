/**
 * Pure projection: Tandem slice records → kanban Board. No vscode, no fs — the
 * ThinkubeFilesAdapter does the I/O and calls these. Unit-tested directly.
 *
 * Each slice file (`.thinkube/specs/SP-{n}/SL-{m}.md`) becomes one card. Slices
 * are numbered per-Spec, so the slice number alone isn't unique on a board; the
 * webview's numeric postMessage protocol (`issueNumber`) is satisfied by a
 * deterministic, reversible encoding of `(specNumber, sliceNumber)` — see
 * `cardNumberFor` / `decodeCardNumber`. The card's string `id` is the human
 * handle `SP-{n}_SL-{m}`. Colour and the parent chip group by the parent Spec.
 *
 * NB (ADR-0007): the locked "the stored number IS the slice number" decision
 * predates per-Spec numbering; once slices restart at SL-1 per Spec, a single
 * number can't be both unique and equal to the slice number, so `issueNumber`
 * is the (spec, slice) composite. Still numeric, so the webview protocol is
 * untouched.
 */
import { Board, BoardColumn, TaskCard } from "../types";
import {
  classifySpecChange,
  SpecChangeKind,
} from "../../../../methodology/specChange";

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

/** Card colour by parent Spec, so a Spec's slices share a hue. */
export function paletteForParent(specNumber: number): string {
  return PALETTE_SLUGS[Math.abs(Math.floor(specNumber)) % PALETTE_SLUGS.length];
}

/** Slices per Spec the composite numeric id can hold before colliding. */
export const SLICE_NUMBER_BASE = 100000;

/** Deterministic, stable, unique numeric id for the webview protocol. */
export function cardNumberFor(specNumber: number, sliceNumber: number): number {
  return specNumber * SLICE_NUMBER_BASE + sliceNumber;
}

export function decodeCardNumber(n: number): {
  specNumber: number;
  sliceNumber: number;
} {
  return {
    specNumber: Math.floor(n / SLICE_NUMBER_BASE),
    sliceNumber: n % SLICE_NUMBER_BASE,
  };
}

export function statusToColumnId(status: string | undefined): string {
  return STATUS_TO_COLUMN[(status ?? "ready").toLowerCase()] ?? "column-ready";
}

export function columnIdToStatus(columnId: string): "ready" | "doing" | "done" {
  return COLUMN_TO_STATUS[columnId] ?? "ready";
}

/** The canonical human handle for a slice, e.g. `SP-3_SL-42`. */
export function sliceHandle(specNumber: number, sliceNumber: number): string {
  return `SP-${specNumber}_SL-${sliceNumber}`;
}

export interface SliceInput {
  specNumber: number;
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
export function buildSliceBoard(slices: SliceInput[], scope: string): Board {
  const tasks: Record<string, TaskCard> = {};
  const byColumn = new Map<string, string[]>();
  for (const c of TANDEM_COLUMNS) byColumn.set(c.id, []);

  const ordered = [...slices].sort(
    (a, b) => a.specNumber - b.specNumber || a.sliceNumber - b.sliceNumber,
  );

  for (const s of ordered) {
    if ((s.status ?? "").toLowerCase() === "archived") continue;
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
      issueNumber: cardNumberFor(s.specNumber, s.sliceNumber),
      parentNumber: s.specNumber,
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
  }

  const columns: BoardColumn[] = TANDEM_COLUMNS.map((c) => ({
    id: c.id,
    title: c.title,
    tasksIds: byColumn.get(c.id) ?? [],
  }));
  return { columns, tasks, scope };
}
