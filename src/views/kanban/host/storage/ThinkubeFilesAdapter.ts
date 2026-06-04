/**
 * ThinkubeFilesAdapter — the files-first kanban storage (ADR-0001/0007).
 *
 * Renders the board *over* committed `.thinkube/specs/SP-{n}/SL-{m}.md` slice
 * files via `ThinkubeStore`, behind the existing `StorageAdapter` interface.
 * The GitHub-only optional methods (`createTask`, `setParent`, `promoteToChain`,
 * `listParentSpecs`) are deliberately omitted — they encode the spine being
 * retired; proper slice creation arrives with the trimmed interface + `/slice`
 * (migration phases 5–7). Until then this adapter exists alongside the
 * GitHub-backed one (additive expand-contract); wiring it as the board's source
 * is Phase 6.
 *
 * The pure projection (slice → Board, id synthesis, status↔column, staleness)
 * lives in `sliceBoard.ts` and is unit-tested; this file is the I/O wrapper.
 */
import * as vscode from "vscode";

import { Board } from "../types";
import { StorageAdapter } from "../StorageAdapter";
import { ThinkubeStore } from "../../../../store/ThinkubeStore";
import type { Frontmatter } from "../../../../store/frontmatter";
import { requirementHash } from "../../../../methodology/specChange";
import {
  buildSliceBoard,
  columnIdToStatus,
  decodeCardNumber,
  SliceInput,
  sliceHandle,
} from "./sliceBoard";

const SLICE_PATH_RE = /specs\/SP-(\d+)\/SL-(\d+)\.md$/;

export class ThinkubeFilesAdapter implements StorageAdapter {
  private readonly _onExternalChange = new vscode.EventEmitter<Board>();
  readonly onExternalChange = this._onExternalChange.event;
  private storeSub: vscode.Disposable | undefined;

  constructor(
    private readonly store: ThinkubeStore,
    readonly scope: string,
  ) {}

  /** Begin reflecting external `.thinkube/` edits into the board. Idempotent. */
  watchExternal(): void {
    if (this.storeSub) return;
    this.storeSub = this.store.onChanged((c) => {
      if (c.kind === "slice" || c.kind === "spec") void this.fireReload();
    });
  }

  dispose(): void {
    this.storeSub?.dispose();
    this.storeSub = undefined;
    this._onExternalChange.dispose();
  }

  async load(): Promise<Board> {
    // Per-Spec requirement-hash, computed once per Spec (specs are few).
    const reqHashBySpec = new Map<number, string>();
    for (const specNumber of await this.store.listSpecDirs()) {
      const doc = await this.store.getFile(
        this.store.pathForSpecDoc(specNumber),
      );
      if (doc?.body) reqHashBySpec.set(specNumber, requirementHash(doc.body));
    }

    const inputs: SliceInput[] = [];
    for (const rel of await this.store.listSlices()) {
      const m = SLICE_PATH_RE.exec(rel);
      if (!m) continue;
      const specNumber = Number(m[1]);
      const sliceNumber = Number(m[2]);
      const parsed = await this.store.getFile(rel);
      const fm: Frontmatter = parsed?.frontmatter ?? {};
      inputs.push({
        specNumber,
        sliceNumber,
        title: sliceTitle(parsed?.body, sliceHandle(specNumber, sliceNumber)),
        body: parsed?.body,
        status: fm.status,
        due: fm.due,
        priority: fm.priority,
        stampedReqHash: fm.verified_req_hash,
        currentReqHash: reqHashBySpec.get(specNumber),
      });
    }
    return buildSliceBoard(inputs, this.scope);
  }

  async save(board: Board): Promise<void> {
    // Write-through: persist each card's column as its slice `status:`. Only
    // files whose status actually changed are rewritten.
    for (const card of Object.values(board.tasks)) {
      const ref = this.refForCard(card.id, card.issueNumber);
      if (!ref) continue;
      const rel = this.store.pathForSlice(ref.specNumber, ref.sliceNumber);
      const parsed = await this.store.getFile(rel);
      if (!parsed) continue;
      const target = columnIdToStatus(card.columnId);
      if (parsed.frontmatter?.status === target) continue;
      const fm: Frontmatter = { ...(parsed.frontmatter ?? {}), status: target };
      await this.store.writeFile(rel, fm, parsed.body);
    }
  }

  async updateIssue(
    issueNumber: number,
    fields: { title?: string; body?: string },
  ): Promise<void> {
    const { specNumber, sliceNumber } = decodeCardNumber(issueNumber);
    const rel = this.store.pathForSlice(specNumber, sliceNumber);
    const parsed = await this.store.getFile(rel);
    if (!parsed) return;
    const body =
      fields.body ?? replaceTitleLine(parsed.body, fields.title) ?? parsed.body;
    await this.store.writeFile(rel, parsed.frontmatter, body);
  }

  async setDueDate(issueNumber: number, date: string | null): Promise<void> {
    const { specNumber, sliceNumber } = decodeCardNumber(issueNumber);
    const rel = this.store.pathForSlice(specNumber, sliceNumber);
    const parsed = await this.store.getFile(rel);
    if (!parsed) return;
    const fm: Frontmatter = { ...(parsed.frontmatter ?? {}) };
    if (date) fm.due = date;
    else delete fm.due;
    await this.store.writeFile(rel, fm, parsed.body);
  }

  /** Resolve a card to its (spec, slice) — prefer the handle, fall back to the number. */
  private refForCard(
    id: string,
    issueNumber?: number,
  ): { specNumber: number; sliceNumber: number } | undefined {
    const m = /^SP-(\d+)_SL-(\d+)$/.exec(id);
    if (m) return { specNumber: Number(m[1]), sliceNumber: Number(m[2]) };
    if (issueNumber != null) return decodeCardNumber(issueNumber);
    return undefined;
  }

  private async fireReload(): Promise<void> {
    this._onExternalChange.fire(await this.load());
  }
}

/** Card title = the slice body's first non-empty line (heading marker stripped). */
function sliceTitle(body: string | undefined, fallback: string): string {
  if (!body) return fallback;
  for (const line of body.split(/\r?\n/)) {
    const t = line.replace(/^#+\s*/, "").trim();
    if (t) return t;
  }
  return fallback;
}

/** Replace the first non-empty body line with `title` (for inline title edits). */
function replaceTitleLine(
  body: string,
  title: string | undefined,
): string | undefined {
  if (title === undefined) return undefined;
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) {
      lines[i] = title;
      return lines.join("\n");
    }
  }
  return title;
}
