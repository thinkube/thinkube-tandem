/**
 * Control requests: the filesystem hand-off from the standalone (Claude-Code-
 * spawned) Kanban MCP server to the Extension Host.
 *
 * The MCP server runs in its own process with no `vscode` API, so an action
 * that only the host can do — opening a Claude session in a Spec's worktree —
 * can't be called directly. Rather than invent a socket, we reuse the thinking space's
 * own MCP→host channel: the **filesystem**. The thinking space already works this way —
 * `move_slice` writes a slice `.md` and a `vscode.FileSystemWatcher` on the
 * thinking space dir reacts (`ThinkubeStore`). A control request is the same idea for a
 * one-shot action: the MCP writes a tiny JSON request into a watched control
 * dir, the host consumes it (and deletes it — fire-once) and runs the command.
 *
 * Deliberately decoupled from the agent-teams `THINKUBE_TMUX_SHIM_SOCK` bridge,
 * which is tmux-emulation-only and gated on an opt-in feature.
 *
 * This module is the **pure** core: the request shape, its serialize/parse, and
 * a router that dispatches by `kind`. The file I/O (the MCP write, the host
 * watcher) is the untested shell, like the thinking space's watcher.
 */

/** Open the Spec's worktree session (the button `thinkube.specs.startWorktree`). */
export interface StartWorktreeRequest {
  kind: "start-worktree";
  /** The Spec id (the `SP-{id}` whose worktree to open). */
  spec: string;
  /** The code repo the Spec belongs to, so the host needn't re-map spec→repo.
   *  Optional — the host falls back to the active workspace folder. */
  repo?: string;
}

/**
 * Open the review panel for a spec/tep (the `open_review` MCP tool → host bridge,
 * SP-6/3). The detached MCP server writes this request; the host resolves it to
 * `openReviewFromHost({kind, id}, {storageDir, docPath, thinkingSpaceDir})` and
 * mounts the `ReviewPanel` whose Approve button mints the gate's approval token.
 * The MCP writer's shape (`kanbanMcpServer.openReview`) is the contract parsed here.
 */
export interface OpenReviewRequest {
  kind: "open-review";
  /** The reviewed subject kind — `spec` or `tep` (`openReviewFromHost`'s `kind`). */
  subjectKind: "spec" | "tep";
  /** The canonical subject id (`TEP-6/SP-9` for a spec, `TEP-6` for a tep). */
  id: string;
  /** The kind-namespaced subject key the gate keys on (`spec:TEP-6/SP-9`). */
  subjectKey: string;
  /** Pre-resolved absolute path of the reviewed document (the MCP knows its root). */
  docPath: string;
  /** The thinking space dir — a fallback resolver for `docPath` when absent. */
  thinkingSpaceDir?: string;
}

/** The discriminated union of control requests. New kinds are peers here. */
export type ControlRequest = StartWorktreeRequest | OpenReviewRequest;

/** Serialize a control request to the on-disk JSON line. */
export function serializeControlRequest(req: ControlRequest): string {
  return JSON.stringify(req) + "\n";
}

/**
 * Parse a control-request file's contents. Tolerant: malformed JSON or an
 * unrecognized/!well-formed kind yields `undefined` (the host skips it) rather
 * than throwing — a stray file never crashes the watcher.
 */
export function parseControlRequest(text: string): ControlRequest | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const o = parsed as Record<string, unknown>;
  switch (o.kind) {
    case "start-worktree":
      if (typeof o.spec !== "string" || !o.spec) return undefined;
      return {
        kind: "start-worktree",
        spec: o.spec,
        ...(typeof o.repo === "string" && o.repo ? { repo: o.repo } : {}),
      };
    case "open-review":
      // `docPath` is the load-bearing field (the host mounts the panel on it);
      // subjectKind/id/subjectKey identify the gate subject. All required but
      // `thinkingSpaceDir` (a fallback resolver the MCP normally also supplies).
      if (
        (o.subjectKind !== "spec" && o.subjectKind !== "tep") ||
        typeof o.id !== "string" ||
        !o.id ||
        typeof o.subjectKey !== "string" ||
        !o.subjectKey ||
        typeof o.docPath !== "string" ||
        !o.docPath
      )
        return undefined;
      return {
        kind: "open-review",
        subjectKind: o.subjectKind,
        id: o.id,
        subjectKey: o.subjectKey,
        docPath: o.docPath,
        ...(typeof o.thinkingSpaceDir === "string" && o.thinkingSpaceDir
          ? { thinkingSpaceDir: o.thinkingSpaceDir }
          : {}),
      };
    default:
      return undefined; // unknown control kind
  }
}

/** Handlers a control-request router dispatches to, one per request kind. */
export interface ControlRequestHandlers<T> {
  startWorktree(spec: string): T;
  openReview(req: OpenReviewRequest): T;
}

/**
 * Route a control request to its handler by `kind`. Distinct kinds reach
 * distinct handlers — this is the seam AC8 unit-tests (a `start-worktree`
 * request routes to `startWorktree`, never to another kind's path).
 */
export function routeControlRequest<T>(
  req: ControlRequest,
  handlers: ControlRequestHandlers<T>,
): T {
  switch (req.kind) {
    case "start-worktree":
      return handlers.startWorktree(req.spec);
    case "open-review":
      return handlers.openReview(req);
  }
}

/** The filename for a start-worktree request (one file per Spec, fire-once). */
export function startWorktreeRequestFile(spec: string): string {
  // Encode the spec so an exotic id can't escape the control dir.
  const safe = Buffer.from(spec, "utf8").toString("hex");
  return `start-worktree-${safe}.json`;
}
