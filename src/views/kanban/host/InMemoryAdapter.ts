/**
 * In-memory adapter — the chunk-5 smoke target.
 *
 * Seeds the six methodology columns (Spec, Ready, In Progress, Review,
 * Verify, Done — per §Appendix C) with demo tasks distributed across three
 * simulated epics. Each epic gets a different palette slug, so the
 * color-by-ancestry semantic is visible end-to-end even before the GitHub
 * Projects adapter wires up real parent links in chunk 7.
 *
 * Saves are kept in memory only — sufficient for the acceptance test
 * (drag-and-drop reorders persist within the session). A page reload
 * snaps back to the seed, which is what we want for a smoke fixture.
 */
import { Board, BoardColumn } from "./types";
import { StorageAdapter } from "./StorageAdapter";

const COLUMN_DEFS: ReadonlyArray<{ id: string; title: string }> = [
  { id: "column-spec", title: "Spec" },
  { id: "column-ready", title: "Ready" },
  { id: "column-in-progress", title: "In Progress" },
  { id: "column-review", title: "Review" },
  { id: "column-verify", title: "Verify" },
  { id: "column-done", title: "Done" },
];

interface SeedTask {
  id: string;
  epicNumber: number;
  issueNumber: number;
  columnId: string;
  description: string;
}

// Three demo epics across the board. Epic numbers are stable so the
// palette mapping (see webview's paletteForEpic) returns the same color
// across reloads.
const SEED_TASKS: ReadonlyArray<SeedTask> = [
  {
    id: "task-101",
    epicNumber: 11,
    issueNumber: 101,
    columnId: "column-spec",
    description: "Draft auth flow spec",
  },
  {
    id: "task-102",
    epicNumber: 11,
    issueNumber: 102,
    columnId: "column-ready",
    description: "Wire login UI to /session",
  },
  {
    id: "task-103",
    epicNumber: 11,
    issueNumber: 103,
    columnId: "column-in-progress",
    description: "Persist refresh token in secure storage",
  },
  {
    id: "task-201",
    epicNumber: 12,
    issueNumber: 201,
    columnId: "column-spec",
    description: "Plan billing import job",
  },
  {
    id: "task-202",
    epicNumber: 12,
    issueNumber: 202,
    columnId: "column-in-progress",
    description: "Stripe webhook → invoice mapper",
  },
  {
    id: "task-203",
    epicNumber: 12,
    issueNumber: 203,
    columnId: "column-review",
    description: "Backfill historical invoices",
  },
  {
    id: "task-301",
    epicNumber: 13,
    issueNumber: 301,
    columnId: "column-verify",
    description: "Performance regression test",
  },
  {
    id: "task-302",
    epicNumber: 13,
    issueNumber: 302,
    columnId: "column-done",
    description: "Migrate logs to OTel exporter",
  },
];

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

function paletteForEpic(epicNumber: number): string {
  return PALETTE_SLUGS[Math.floor(epicNumber) % PALETTE_SLUGS.length];
}

function buildSeed(): Board {
  const tasks: Record<string, import("./types").TaskCard> = {};
  const tasksByColumn = new Map<string, string[]>();
  for (const def of COLUMN_DEFS) tasksByColumn.set(def.id, []);

  for (const t of SEED_TASKS) {
    tasks[t.id] = {
      id: t.id,
      description: t.description,
      columnId: t.columnId,
      colorSlug: paletteForEpic(t.epicNumber),
      issueNumber: t.issueNumber,
      epicNumber: t.epicNumber,
    };
    tasksByColumn.get(t.columnId)?.push(t.id);
  }

  const columns: BoardColumn[] = COLUMN_DEFS.map((def) => ({
    id: def.id,
    title: def.title,
    tasksIds: tasksByColumn.get(def.id) ?? [],
  }));

  return { columns, tasks, scope: "In-memory demo" };
}

export class InMemoryAdapter implements StorageAdapter {
  readonly scope = "In-memory demo";
  private board: Board = buildSeed();

  async load(): Promise<Board> {
    // Return a deep-ish clone so the webview can mutate without
    // aliasing back into our cache.
    return JSON.parse(JSON.stringify(this.board)) as Board;
  }

  async save(board: Board): Promise<void> {
    this.board = board;
  }
}
