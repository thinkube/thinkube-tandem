/**
 * `resolveTepWritePath` (SP-th4wqd_SL-3 / TEP-th3i18 #14) — the promotion-aware
 * write-target decision for `write_tep`.
 *
 * Split-brain gap: once a TEP is **promoted** into a Project, its canonical home
 * moves out of the session thinking space's `teps/` and into
 * `<product>/projects/<id>/teps/TEP-<id>.md` (see `store/projects.ts#projectTeps`
 * and the `promote_tep` tool). A naive `write_tep` keeps writing the session
 * thinking space copy, so an update lands on a stale duplicate while the promoted copy —
 * the one everyone reads — drifts. This helper decides where the bytes should go
 * BEFORE the handler writes:
 *
 *   - the TEP is owned by exactly one project  → update that **project copy**
 *     (no session-thinking space duplicate is created);
 *   - no project owns it                       → write the **session thinking space** as
 *     before (a fresh or repo-local TEP);
 *   - more than one project claims it          → the promotion is **unresolvable**
 *     (an ambiguous home `promote_tep` is meant to keep singular). We *signal* a
 *     refusal pointing at `promote_tep` rather than guessing a copy; the calling
 *     handler turns the signal into a thrown error naming the tool.
 *
 * Pure (no fs / vscode): the "which projects own this TEP" lookup is resolved by
 * the caller (`discoverProjects` + `projectTeps` over `ctx.env.thinkingSpaceRoot`) and
 * passed in as {@link PromotedProject}[]. That keeps this unit-testable
 * vscode-free while `write_tep` drives the real seam via `dispatchTool` over a
 * `{env:{thinkingSpaceRoot}, thinkingSpaces}` fixture. Mirrors `implementsPromoteCheck`'s
 * accept/refuse-with-`promote_tep` shape so both promotion guards read alike.
 */

import { normalizeTepId } from "../store/implementsRef";
import { PROMOTE_TOOL } from "./implementsPromoteCheck";

export { PROMOTE_TOOL };

/**
 * A Project that may own the TEP, paired with the TEP ids its `teps/` holds.
 * The caller builds these from `discoverProjects(thinkingSpaceRoot)` joined with
 * `projectTeps(thinkingSpaceRoot, product, id)`. `teps` entries are prefix-tolerant
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
 *   - `session`  — the TEP is not promoted; write the session thinking space normally.
 *   - `project`  — exactly one project owns it; write/update that project copy at
 *                  `relativePath` (thinking space-root-relative) and create no session dup.
 *   - `refuse`   — the promotion is unresolvable (ambiguous home); the handler
 *                  throws `message`, which names `promote_tep`.
 */
export type TepWritePath =
  | { kind: "session" }
  | {
      kind: "project";
      product: string;
      projectId: string;
      /** Thinking Space-root-relative path of the project copy. */
      relativePath: string;
    }
  | { kind: "refuse"; refuse: TepPromoteRefusal; message: string };

/** The project copy's thinking space-root-relative path — matches `promote_tep`'s
 *  `movedTo`. A promoted TEP is the nested org-tree dir `teps/TEP-{id}/tep.md`
 *  (a project uses the bare `teps/` root — no per-maintainer `<org>/` segment). */
export function projectTepPath(
  product: string,
  projectId: string,
  tepId: string,
): string {
  return `${product}/projects/${projectId}/teps/TEP-${normalizeTepId(tepId)}/tep.md`;
}

/**
 * Decide where a `write_tep` for `tepId` must write, given the projects that may
 * own it (each carrying the TEP ids in its `teps/`).
 *
 * **A TEP id is unique only within its (thinking space, org) scope — a Project keeps
 * its OWN numbering sequence, exactly like a Spec id is scoped per-TEP** (the same
 * invariant `promoteTep` enforces by RE-numbering into the target project's own
 * `nextTepId()` rather than preserving the origin number). So two *different*
 * projects legitimately minting their own "TEP-1" is the expected shape of scoped
 * numbering, not a collision — there is nothing to reconcile between them.
 *
 * - `callerProject` set (the caller's OWN `thinking_space:` already resolved to a
 *   specific project's store) → `{ kind: "session" }` **unconditionally**: that
 *   project is authoritative for its own `teps/` regardless of what any unrelated
 *   project's `teps/` independently contains under the same bare number. The
 *   cross-project scan below exists only to redirect an UNSCOPED (session/repo-local)
 *   caller to wherever a TEP was already promoted — it has no bearing once the
 *   caller has already named the project directly.
 * - Owned by exactly one project (unscoped caller) → `{ kind: "project", … }`
 *   (update the promoted copy; the handler must NOT also touch the session copy).
 * - Owned by no project → `{ kind: "session" }` (write the session thinking space copy).
 * - Owned by more than one project (unscoped caller, genuine caller-side ambiguity —
 *   "TEP-1" could mean either project's own TEP-1) → `{ kind: "refuse", … }`: the
 *   handler refuses, naming both candidates and directing the caller to retry with
 *   a project-scoped `thinking_space:` (or, if this really is one proposal
 *   double-promoted by mistake, to reconcile via `promote_tep`).
 *
 * @param tepId    the TEP id being written (with or without the `TEP-` prefix).
 * @param projects the candidate project homes + the TEP ids each owns.
 * @param callerProject the project the caller's own `thinking_space:` argument
 *   already resolved to, when its store IS a project's own store — bypasses the
 *   cross-project scan entirely (see above).
 */
export function resolveTepWritePath(
  tepId: string,
  projects: PromotedProject[],
  callerProject?: { product: string; id: string },
): TepWritePath {
  const want = normalizeTepId(tepId);

  // The caller already told us which project's TEP-{id} is meant — a project-scoped
  // call is authoritative for its own teps/ no matter what an unrelated project's
  // teps/ independently contains under the same bare number.
  if (callerProject) return { kind: "session" };

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
      `TEP-${want} exists in more than one project (${candidates.join(", ")}) — ` +
      `a bare "TEP-${want}" is ambiguous between them (TEP numbers are scoped per ` +
      `project, so this is normal, not necessarily an error). Retry with ` +
      `thinking_space=<one of the candidates above> to target that project's own ` +
      `TEP-${want} directly. If instead this is genuinely ONE proposal that got ` +
      `promoted into two projects by mistake, reconcile it with the ${PROMOTE_TOOL} tool.`,
  };
}
