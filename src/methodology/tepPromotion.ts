/**
 * `resolveTepWritePath` (SP-th4wqd_SL-3 / TEP-th3i18 #14) — the promotion-aware
 * write-target decision for `write_tep`.
 *
 * Split-brain gap: once a TEP is **promoted** into a Project, its canonical home
 * moves out of the session board's `teps/` and into
 * `<product>/projects/<id>/teps/TEP-<id>.md` (see `store/projects.ts#projectTeps`
 * and the `promote_tep` tool). A naive `write_tep` keeps writing the session
 * board copy, so an update lands on a stale duplicate while the promoted copy —
 * the one everyone reads — drifts. This helper decides where the bytes should go
 * BEFORE the handler writes:
 *
 *   - the TEP is owned by exactly one project  → update that **project copy**
 *     (no session-board duplicate is created);
 *   - no project owns it                       → write the **session board** as
 *     before (a fresh or repo-local TEP);
 *   - more than one project claims it          → the promotion is **unresolvable**
 *     (an ambiguous home `promote_tep` is meant to keep singular). We *signal* a
 *     refusal pointing at `promote_tep` rather than guessing a copy; the calling
 *     handler turns the signal into a thrown error naming the tool.
 *
 * Pure (no fs / vscode): the "which projects own this TEP" lookup is resolved by
 * the caller (`discoverProjects` + `projectTeps` over `ctx.env.boardRoot`) and
 * passed in as {@link PromotedProject}[]. That keeps this unit-testable
 * vscode-free while `write_tep` drives the real seam via `dispatchTool` over a
 * `{env:{boardRoot}, boards}` fixture. Mirrors `implementsPromoteCheck`'s
 * accept/refuse-with-`promote_tep` shape so both promotion guards read alike.
 */

import { normalizeTepId } from "../store/implementsRef";
import { PROMOTE_TOOL } from "./implementsPromoteCheck";

export { PROMOTE_TOOL };

/**
 * A Project that may own the TEP, paired with the TEP ids its `teps/` holds.
 * The caller builds these from `discoverProjects(boardRoot)` joined with
 * `projectTeps(boardRoot, product, id)`. `teps` entries are prefix-tolerant
 * (`TEP-x` or `x`) — comparison is normalized.
 */
export interface PromotedProject {
  /** The Product (top sidecar dir) the project lives under. */
  product: string;
  /** The project id within its product. */
  id: string;
  /** TEP ids owned by this project's `teps/` (prefix-tolerant). */
  teps: string[];
}

/** A structured pointer to the remedy, surfaced when promotion is unresolvable. */
export interface TepPromoteRefusal {
  /** The tool to run — always `promote_tep`. */
  tool: typeof PROMOTE_TOOL;
  /** The bare TEP id (no `TEP-` prefix) whose home is ambiguous. */
  tepId: string;
  /** The competing project homes (`<product>/projects/<id>`) that each claim it. */
  candidates: string[];
}

/**
 * Where a `write_tep` should land:
 *   - `session`  — the TEP is not promoted; write the session board normally.
 *   - `project`  — exactly one project owns it; write/update that project copy at
 *                  `relativePath` (board-root-relative) and create no session dup.
 *   - `refuse`   — the promotion is unresolvable (ambiguous home); the handler
 *                  throws `message`, which names `promote_tep`.
 */
export type TepWritePath =
  | { kind: "session" }
  | {
      kind: "project";
      product: string;
      projectId: string;
      /** Board-root-relative path of the project copy. */
      relativePath: string;
    }
  | { kind: "refuse"; refuse: TepPromoteRefusal; message: string };

/** The project copy's board-root-relative path — matches `promote_tep`'s `movedTo`. */
export function projectTepPath(
  product: string,
  projectId: string,
  tepId: string,
): string {
  return `${product}/projects/${projectId}/teps/TEP-${normalizeTepId(tepId)}.md`;
}

/**
 * Decide where a `write_tep` for `tepId` must write, given the projects that may
 * own it (each carrying the TEP ids in its `teps/`).
 *
 * - Owned by exactly one project → `{ kind: "project", … }` (update the promoted
 *   copy; the handler must NOT also touch the session board).
 * - Owned by no project → `{ kind: "session" }` (write the session board copy).
 * - Owned by more than one project → `{ kind: "refuse", … }`: the promotion is
 *   unresolvable, so the handler refuses with a message naming `promote_tep`
 *   rather than split-braining yet another copy.
 *
 * @param tepId    the TEP id being written (with or without the `TEP-` prefix).
 * @param projects the candidate project homes + the TEP ids each owns.
 */
export function resolveTepWritePath(
  tepId: string,
  projects: PromotedProject[],
): TepWritePath {
  const want = normalizeTepId(tepId);
  const owners = projects.filter((p) =>
    p.teps.some((t) => normalizeTepId(t) === want),
  );

  if (owners.length === 0) return { kind: "session" };

  if (owners.length === 1) {
    const { product, id } = owners[0];
    return {
      kind: "project",
      product,
      projectId: id,
      relativePath: projectTepPath(product, id, want),
    };
  }

  const candidates = owners.map((p) => `${p.product}/projects/${p.id}`);
  return {
    kind: "refuse",
    refuse: { tool: PROMOTE_TOOL, tepId: want, candidates },
    message:
      `TEP-${want} is promoted into more than one project (${candidates.join(", ")}), ` +
      `so write_tep cannot resolve a single canonical home. A promoted TEP must ` +
      `live in exactly one project's teps/. Reconcile the duplicate with the ` +
      `${PROMOTE_TOOL} tool (it owns the single-home invariant), then retry write_tep.`,
  };
}
