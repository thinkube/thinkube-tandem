#!/usr/bin/env node
// MUST be the first import: installs the require-hook that redirects
// `require('vscode')` to our subprocess stub. See `installVscodeStub.ts`.
import "./installVscodeStub";

/**
 * Stdio MCP server for the Thinkube methodology kanban (files-first / Tandem).
 *
 * Thinking Space-independent (ADR-0007 Phase-6 decision): ONE server serves every
 * enabled thinking space. Each tool takes an optional `thinking space` parameter resolved per
 * call, so a session can work across thinkingSpaces and a thinking space enabled mid-session
 * is immediately addressable — no relaunch. When `thinking space` is omitted the
 * session's own repo is used (the repo containing this process's cwd; Claude
 * Code spawns `.mcp.json` servers with the session's cwd).
 *
 * Thinking Space addressing: the canonical id is the repo's HOME-RELATIVE path
 * (e.g. `apps/vllm`, `thinkube-platform/core/thinkube`). The workspace
 * organization is semantic, so bare basenames are systemically ambiguous
 * (template vs deployed app) and are NEVER resolved — an unknown id fails
 * with candidate suggestions, and `list_thinking_spaces` supplies the vocabulary.
 * Absolute paths are also accepted.
 *
 * Source of truth: the committed `specs/SP-{n}/SL-{m}.md` slice files in the
 * thinking space's sidecar namespace (`<thinking space-root>/<container>/<rel>`, ADR-0008), plus
 * the parent `SP-{n}/spec.md` documents. There is NO GitHub here —
 * this server reads and writes only through `ThinkubeStore` and projects the
 * thinking space with the same pure `sliceThinkingSpace.ts` logic the panel uses, so the MCP
 * surface and the kanban panel always agree.
 *
 * State plumbing: this is a separate Node process, so settings come in via
 * environment variables (baked into `.mcp.json` by the bundle installer, or
 * injected by the VS Code provider):
 *
 *   THINKUBE_ROOTS            path-delimiter-separated directories scanned for
 *                             thinkingSpaces (repos whose sidecar thinking space dir exists).
 *                             Optional — defaults to the session's own repo.
 *   THINKUBE_ALLOW_AI_WRITES  "true" | "false" — gates every mutating tool.
 *                             One global flag: solo platform, git is the undo
 *                             (ADR-0007 Phase-6 decision).
 *   THINKUBE_WORKSPACE        legacy single-thinking space binding; honoured as a
 *                             fallback root / default thinking space so `.mcp.json`
 *                             files from older bundle installs keep working.
 *   THINKUBE_THINKING_SPACE_ROOT       central thinking space root (SP-8): thinkingSpaces live at
 *                             <root>/<container>/<rel>, not co-located.
 *   THINKUBE_FOLDERS          JSON [{name,path}] of workspace folders; the
 *                             folder name supplies the namespace container.
 *
 * Logging: stderr only. VS Code captures it under the MCP server's output
 * channel; never print to stdout — that channel is the protocol stream.
 */
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { requirementHash } from "../methodology/specChange";
import { sectionPatch } from "../methodology/sectionPatch";
import { specSectionsPresent } from "../methodology/specStructure";
import { sliceFilesResolveInRepo } from "../methodology/sliceRepoGuard";
import {
  // Slice lifecycle contract (SP-th4wqd_SL-1): the single source the `move_slice`
  // / `update_slice` handlers and their dispatch test agree on for retire + re-cut.
  // The status literal, the "reason required" rule, and the re-cut footprint check
  // are NEVER re-spelled here — they are consumed so the wiring and test can't drift.
  RETIRED_STATUS,
  isRetiredStatus,
  validateRetireReason,
  recutSliceFrontmatter,
  hasRecutFields,
  type SliceRecut,
} from "../methodology/sliceLifecycle";
import { resolveSpecId } from "../methodology/idMinting";
import {
  validateParallelGroup,
  validateDag,
  // Contract-first gate (SP-th4wqi): consumed from parallelSlices.ts — the pure
  // check, its teaching message, and the shared opt-out field name. NEVER
  // redefined here; a second definition is exactly the contract divergence this
  // gate exists to prevent (the SP-th4wqe AC#3 failure).
  contractFirstCheck,
  CONTRACT_FIRST_RULE_MSG,
  CONTRACT_FIRST_OPTOUT_FIELD,
  // Undeclared cross-unit read gate (SP-6/2 AC2): consumed from parallelSlices.ts —
  // the pure check whose verdict the create_slice gate chain enforces. The rule
  // message is carried in the verdict (never restated here), so a reworded rule
  // can't drift between the check and the refusal it produces.
  undeclaredReadsCheck,
  normalizeFilePath,
  type ContractFirstWorkUnit,
  type ParallelSliceInput,
} from "../methodology/parallelSlices";
import { buildUnitDag, type SliceForDag } from "../services/orchestratorCore";
import {
  CONTROL_DIR_ENV,
  serializeControlRequest,
  startWorktreeRequestFile,
} from "./controlRequests";
import {
  gateSliceSatisfiesToDone,
  gateSpecAcceptance,
  gateSliceDocsToDone,
  resolveDocsObligation,
  type DocsGateMode,
} from "../methodology/qualityGates";
import { ThinkubeStore } from "../store/ThinkubeStore";
import { isThinkingSpaceDir } from "./thinkingSpaceDetection";
import { resolveServerConfig, type ServerConfigFile } from "./serverConfig";
import type { Frontmatter, ParsedFile } from "../store/frontmatter";
import {
  effectiveTags,
  parseFrontmatter,
  serializeFrontmatter,
} from "../store/frontmatter";
import {
  resolveTepWritePath,
  type PromotedProject,
} from "../methodology/tepPromotion";
import { groupByTag, type TaggedItem } from "../store/tags";
import { discoverProducts } from "../store/products";
import { discoverProjects, projectTeps } from "../store/projects";
import {
  parseImplements,
  normalizeTepId,
  formatImplements,
  rewriteImplementsForPromote,
  resolvesTo,
  type ParsedImplements,
} from "../store/implementsRef";
import {
  tepApprovalGate,
  tepComplete,
  type ImplementingSpec,
} from "../methodology/tepLifecycle";
import { stampOnEnteringDone } from "../github/sliceProvenance";
import { linkedWorktreeInfo } from "../services/WorktreeService";
import {
  readyGate,
  acRequirementHash,
  AC_CERT_HASH_KEY,
  emitAcVerifications,
  type AcVerdict,
} from "../services/openingGate";
// SP-6/1 (TEP-6): `write_spec` runs the verifiability audit itself and signs only what its own
// audit produced — the agent-supplied `ac_verifications` map is no longer honored. The signing
// secret lives only in the server's globalStorage (`loadOrCreateSecret`), the provenance signature
// is HMAC'd over `(acRequirementHash, ac_verifications)` (`signAcVerifications`) and stamped under
// `AC_SIGNATURE_KEY`, and the audit runner is the stub-injectable seam (`AuditRunner`) so the
// handler's *honor the verdict, sign on pass, refuse otherwise* enforcement is unit-testable with a
// fixed stub instead of a live model call.
import {
  AC_SIGNATURE_KEY,
  loadOrCreateSecret,
  signAcVerifications,
} from "../services/acSignature";
import {
  createSdkAuditRunner,
  deriveVerificationCommands,
  type AuditAc,
  type AuditRunner,
} from "../services/auditorRunner";
import {
  verificationRunnable,
  repoStateFromTsconfig,
  type RepoState,
} from "../services/verificationRunnable";
import {
  implementsPromoteCheck,
  type PromoteLocator,
} from "../methodology/implementsPromoteCheck";
import { ConcurrencyLock } from "../services/concurrencyLock";
import {
  thinkingSpaceDirForNamespace,
  namespaceForRepo,
  repoPathForNamespace,
  type WorkspaceFolderRef,
} from "../store/thinkingSpaceNamespace";
import {
  buildSliceThinkingSpace,
  deriveSpecMeta,
  SliceInput,
  sliceHandle,
  SpecMeta,
} from "../views/kanban/host/storage/sliceThinkingSpace";

interface ServerEnv {
  roots: string[];
  /** Workspace folders with names — supply the namespace container (SP-8). */
  folders: WorkspaceFolderRef[];
  /** Central thinking space root; when set, thinkingSpaces live at <root>/<container>/<rel>. */
  thinkingSpaceRoot?: string;
  allowAIWrites: boolean;
  /** → Done docs gate mode (TEP-tgh6iy): advisory warns, blocking refuses. */
  docsGateMode: DocsGateMode;
  legacyWorkspace?: string;
}

/** The machine-level config file the extension writes (TEP-tgvwct Phase 3) so
 *  the plugin-shipped server self-configures without per-repo `.mcp.json` env
 *  injection. Missing / unparseable → null (env + cwd discovery still apply). */
function readConfigFile(): ServerConfigFile | null {
  const dir =
    process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
  try {
    return JSON.parse(
      fsSync.readFileSync(path.join(dir, "thinkube-mcp.json"), "utf8"),
    ) as ServerConfigFile;
  } catch {
    return null;
  }
}

/** Effective config: `THINKUBE_*` env (back-compat) → machine-level file → cwd
 *  discovery (in ThinkingSpaceRegistry). See `serverConfig.resolveServerConfig`. */
function readEnv(): ServerEnv {
  return resolveServerConfig(process.env, readConfigFile(), path.delimiter);
}

function log(msg: string): void {
  process.stderr.write(`[thinkube-mcp] ${msg}\n`);
}

async function main(): Promise<void> {
  const env = readEnv();
  const thinkingSpaces = new ThinkingSpaceRegistry(env);
  log(
    `booting: roots=[${env.roots.join(", ")}] writes=${env.allowAIWrites} (thinking_space= required per call; cwd is not a thinking space criterion)`,
  );

  // Dynamic import: the MCP SDK is ESM-only, this entrypoint is CJS.
  const sdkServer: any =
    await import("@modelcontextprotocol/sdk/server/index.js");
  const sdkStdio: any =
    await import("@modelcontextprotocol/sdk/server/stdio.js");
  const sdkTypes: any = await import("@modelcontextprotocol/sdk/types.js");

  const server = new sdkServer.Server(
    { name: "thinkube-kanban", version: "0.2.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  // SP-6/1 (TEP-6): turn on the `ac_verifications` provenance path when the extension hands us a
  // private globalStorage dir for the signing key. The secret never leaves this process; the audit
  // runner is the real headless-Claude one (lazy SDK import, so no cost until a `write_spec` runs).
  // Absent dir ⇒ signing stays off and `write_spec` keeps the legacy param path (forward-compatible).
  let signingSecret: Buffer | undefined;
  let auditRunner: AuditRunner | undefined;
  const signingKeyDir = process.env.THINKUBE_SIGNING_KEY_DIR?.trim();
  if (signingKeyDir) {
    try {
      signingSecret = loadOrCreateSecret(signingKeyDir);
      auditRunner = createSdkAuditRunner({ log });
      log("ac_verifications signing: on (secret loaded from globalStorage)");
    } catch (err) {
      signingSecret = undefined;
      auditRunner = undefined;
      log(`ac_verifications signing: off (${(err as Error).message})`);
    }
  }

  const ctx: HandlerContext = {
    env,
    thinkingSpaces,
    lock: new ConcurrencyLock(),
    auditRunner,
    signingSecret,
  };
  registerHandlers(server, sdkTypes, ctx);

  const transport = new sdkStdio.StdioServerTransport();
  await server.connect(transport);
  log("connected");
}

// ─── Thinking Space registry ─────────────────────────────────────────────────────────

export interface ThinkingSpaceInfo {
  /** Canonical id: home-relative path (absolute when outside $HOME). */
  id: string;
  /** Basename — display only, never an address. */
  name: string;
  /** Absolute repo path. */
  path: string;
  /** The thinking space dir (the `.thinkube`-equivalent) — central or co-located (SP-8). */
  thinkingSpaceDir: string;
  /**
   * True when this entry is a linked git worktree (SP-5/SP-9), not a standalone
   * thinking space: it shares its canonical repo's namespace. Listed separately so the
   * thinking space vocabulary stays a list of logical Thinking Spaces, not checkouts.
   */
  worktree?: boolean;
}

const DISCOVERY_TTL_MS = 10_000;
const MAX_WALK_DEPTH = 3;

/**
 * Discovers thinkingSpaces under the configured roots and resolves `thinking space` arguments to
 * `ThinkubeStore`s. Discovery mirrors the navigator's `discoverRepos`: a
 * directory containing `.git` is a repo and a leaf; it is a thinking space iff its thinking space
 * dir exists — the central sidecar namespace (ADR-0008) or a co-located
 * `.thinkube/`. Linked worktrees map to their canonical repo's namespace.
 */
export class ThinkingSpaceRegistry {
  private readonly env: ServerEnv;
  private readonly roots: string[];
  private readonly stores = new Map<string, ThinkubeStore>();
  private discovered: ThinkingSpaceInfo[] | undefined;
  private discoveredAt = 0;

  constructor(env: ServerEnv) {
    this.env = env;
    // Discovery roots come from CONFIGURATION only (thinkingSpaceRoot + the configured
    // roots). process.cwd() is never consulted — cwd is not a criterion for the
    // thinking space axis (passed explicitly per call) nor the repo axis (the spec's
    // `repo:`); it is only ever the worktree a process happens to run in, a
    // downstream consequence, never an input.
    const roots = [...env.roots];
    if (env.legacyWorkspace) roots.push(env.legacyWorkspace);
    this.roots = [...new Set(roots)];
  }

  list(forceRefresh = false): ThinkingSpaceInfo[] {
    const now = Date.now();
    if (
      !this.discovered ||
      forceRefresh ||
      now - this.discoveredAt > DISCOVERY_TTL_MS
    ) {
      const found = new Map<string, ThinkingSpaceInfo>();
      for (const root of this.roots) {
        walkForThinkingSpaces(root, 0, found, this.env);
      }
      this.discovered = [...found.values()].sort((a, b) =>
        a.id.localeCompare(b.id),
      );
      this.discoveredAt = now;
    }
    return this.discovered;
  }

  /**
   * Resolve a `thinking space` argument to a store. Omitted → the session's own
   * thinking space. Canonical id or absolute path → that thinking space. Anything else —
   * including a bare basename, even a currently-unique one — fails with
   * candidate suggestions ("currently unique" is one deploy away from
   * ambiguous).
   */
  resolve(thinkingSpaceArg: string | undefined): ThinkubeStore {
    if (
      this.env.thinkingSpaceRoot &&
      !fsSync.existsSync(this.env.thinkingSpaceRoot)
    ) {
      throw new Error(
        `Thinking Space repo not available: thinkube.thinkingSpace.root (${this.env.thinkingSpaceRoot}) does not exist — clone or mount the thinking space repo.`,
      );
    }
    if (thinkingSpaceArg === undefined || thinkingSpaceArg.trim() === "") {
      // No default thinking space — every thinking space-scoped call MUST name its thinking space, so the
      // session can never silently act on the wrong thinking space (the cwd's repo thinking space
      // is NOT assumed). Pass `thinking_space=<id>` explicitly.
      throw new Error(
        "A thinking space is required: pass `thinking_space=<id>` — the thinking space's home-relative id (e.g. `thinkube-platform/core/thinkube`) or a `<product>/projects/<id>` project namespace. There is no default thinking space; call list_thinking_spaces for the available ids." +
          this.missingThinkingSpaceRootHint(),
      );
    }

    const arg = thinkingSpaceArg.trim();
    if (path.isAbsolute(arg)) {
      const thinkingSpaceDir = thinkingSpaceDirOf(arg, this.env);
      if (!isThinkingSpaceDir(thinkingSpaceDir)) {
        throw new Error(
          `"${arg}" is not a thinking space — no thinking space-shaped thinking space directory at ${thinkingSpaceDir}.` +
            this.missingThinkingSpaceRootHint(),
        );
      }
      return this.storeFor(arg, thinkingSpaceDir);
    }

    const thinkingSpaces = this.list();
    const exact = thinkingSpaces.find((b) => b.id === normalizeId(arg));
    if (exact) return this.storeFor(exact.path, exact.thinkingSpaceDir);

    // A Project is a first-class but CODE-LESS thinking space at `<product>/projects/<id>`
    // in the sidecar root, addressable by that namespace. It has no code repo, so
    // its store path IS its thinking space dir; its member specs carry `repo:` naming the
    // working repo the orchestrator branches a worktree in. This is what makes a
    // project fully tool-managed (write_spec/create_slice/get_thinkube_file target
    // it like any thinking space) rather than a half-thinking space special-cased around.
    if (this.env.thinkingSpaceRoot && /(^|\/)projects\/[^/]+\/?$/.test(arg)) {
      const projDir = path.join(this.env.thinkingSpaceRoot, ...arg.split("/"));
      if (isThinkingSpaceDir(projDir)) return this.storeFor(projDir, projDir);
    }

    // Never resolve fuzzy/basename matches — suggest instead.
    const needle = arg.toLowerCase();
    const candidates = thinkingSpaces
      .filter(
        (b) =>
          b.name.toLowerCase() === needle ||
          b.id.toLowerCase().includes(needle),
      )
      .map((b) => b.id);
    const hint =
      candidates.length > 0
        ? ` Did you mean: ${candidates.join(", ")}?`
        : " Call list_thinking_spaces for the available ids.";
    throw new Error(
      `Unknown thinking space "${arg}" — thinkingSpaces are addressed by their home-relative id (e.g. thinkube-platform/core/thinkube), never by bare name.${hint}`,
    );
  }

  /**
   * Hint appended to "not a thinking space" errors when no thinking space root is configured —
   * the common cause is a missing `thinkube.thinkingSpace.root` / `THINKUBE_THINKING_SPACE_ROOT`
   * for a thinking space that lives in a central sidecar. Without it we'd resolve to a
   * fabricated co-located `.thinkube/` (TEP-tghb9t). Empty when one IS set.
   */
  private missingThinkingSpaceRootHint(): string {
    return this.env.thinkingSpaceRoot
      ? ""
      : " (No thinkube.thinkingSpace.root / THINKUBE_THINKING_SPACE_ROOT is configured — if this repo's thinking space lives in a central sidecar, that setting is required.)";
  }

  private storeFor(repoPath: string, thinkingSpaceDir: string): ThinkubeStore {
    let store = this.stores.get(repoPath);
    if (!store) {
      store = new ThinkubeStore(repoPath, thinkingSpaceDir);
      this.stores.set(repoPath, store);
    }
    return store;
  }
}

function isThinkingSpace(dir: string): boolean {
  // Legacy co-located thinking space: a `<dir>/.thinkube/` that is thinking space-shaped (has
  // `specs/`). A bare `.thinkube/` holding something else (e.g. an api-token
  // store) is NOT a thinking space — see thinkingSpaceDetection.ts (TEP-tghb9t).
  return isThinkingSpaceDir(path.join(dir, ".thinkube"));
}

/**
 * The thinking space dir for a repo: central `<thinking space-root>/<namespace>` when a thinking space
 * root is configured and the repo maps to a namespace, else the co-located
 * `<repo>/.thinkube` (legacy default + fallback for unmapped paths). Mirrors
 * the navigator's resolver (SP-8).
 */
function thinkingSpaceDirOf(repoPath: string, env: ServerEnv): string {
  if (env.thinkingSpaceRoot) {
    // A linked worktree shares its canonical Spec's thinking space (SP-9): map it to the
    // canonical repo's namespace, not the worktree's own out-of-folder path. So
    // a worktree session's default thinking space + addressing both resolve to the same
    // central thinking space as the canonical repo.
    const wt = linkedWorktreeInfo(repoPath);
    const effective = path.resolve(wt ? wt.canonicalRepo : repoPath);
    // Co-located under the root: a thinking space that ALREADY lives inside the
    // thinking-space root keeps its org tree in place — resolving it must NOT
    // re-mirror it through a `<container>/<rel>` sidecar namespace. The sidecar
    // mapping exists to mirror a thinking space that lives OUTSIDE the root into
    // it; applying it to a path already inside the root double-applies the
    // container segment whenever the root coincides with a workspace folder
    // (here root == the "Tandem Board" folder, container `Tandem-Board`),
    // yielding a phantom `<root>/Tandem-Board/…` dir with the `<org>/teps` tree
    // lost. So a thinking space addressed by its absolute path resolves to the
    // SAME dir its `<product>/projects/<id>` namespace does — the path itself.
    const root = path.resolve(env.thinkingSpaceRoot);
    const rel = path.relative(root, effective);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      return effective;
    }
    const ns = namespaceForRepo(effective, env.folders);
    if (ns) return thinkingSpaceDirForNamespace(env.thinkingSpaceRoot, ns);
  }
  return path.join(repoPath, ".thinkube");
}

/** Canonical thinking space id: home-relative path (forward slashes), else absolute. */
function thinkingSpaceId(absPath: string): string {
  const rel = path.relative(os.homedir(), absPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return absPath;
  return rel.split(path.sep).join("/");
}

function normalizeId(id: string): string {
  return id.replace(/\\/g, "/").replace(/\/+$/, "");
}

function walkForThinkingSpaces(
  dir: string,
  depth: number,
  out: Map<string, ThinkingSpaceInfo>,
  env: ServerEnv,
): void {
  let entries: fsSync.Dirent[];
  try {
    entries = fsSync.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const gitEntry = entries.find((e) => e.name === ".git");
  if (gitEntry) {
    // A repo (`.git` dir) or a linked worktree (`.git` file) — a leaf. It is a
    // thinking space iff its thinking space dir exists. A worktree (SP-5/SP-9) carries NO thinking space of
    // its own: its thinking space is the CANONICAL Spec's central namespace, and it
    // displays as a worktree of its canonical repo.
    const abs = path.resolve(dir);
    const wt = gitEntry.isFile() ? linkedWorktreeInfo(abs) : undefined;
    const thinkingSpaceDir = thinkingSpaceDirOf(abs, env); // thinkingSpaceDirOf maps a worktree → canonical
    if (isThinkingSpaceDir(thinkingSpaceDir)) {
      const name = wt
        ? `${path.basename(wt.canonicalRepo)} · ${wt.name} worktree`
        : path.basename(abs);
      out.set(abs, {
        id: thinkingSpaceId(abs),
        name,
        path: abs,
        thinkingSpaceDir,
        worktree: !!wt,
      });
    }
    return; // a repo is a leaf — no nested thinkingSpaces
  }
  // Legacy: a co-located `.thinkube/` without a `.git` (e.g. a bare workspace).
  if (isThinkingSpace(dir)) {
    const abs = path.resolve(dir);
    out.set(abs, {
      id: thinkingSpaceId(abs),
      name: path.basename(abs),
      path: abs,
      thinkingSpaceDir: path.join(abs, ".thinkube"),
    });
    return;
  }
  if (depth >= MAX_WALK_DEPTH) return;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    walkForThinkingSpaces(path.join(dir, e.name), depth + 1, out, env);
  }
}

// ─── Handlers ───────────────────────────────────────────────────────────────

interface HandlerContext {
  env: ServerEnv;
  thinkingSpaces: ThinkingSpaceRegistry;
  /**
   * Serializes mutating thinking space writes per thinking space handle (#20). Optional so the
   * many test harnesses that hand-build a minimal `{ env, thinkingSpaces }` context keep
   * compiling; `dispatchTool` falls back to a module-level singleton
   * (`defaultThinkingSpaceWriteLock`) when it is absent, so writes are serialized either
   * way. Production (`main`) injects a fresh per-process lock.
   */
  lock?: ConcurrencyLock;
  /**
   * Cross-thinking space `implements:` promote locator consulted by `write_spec` (#3).
   * Injected so AC#3 can drive the real refusal through `dispatchTool` with a fake
   * locator (no thinking space fixture). Absent ⇒ `dispatchTool` builds the real, thinking space-
   * backed locator (`makeThinkingSpacePromoteLocator`) from this context. See
   * `methodology/implementsPromoteCheck` for the contract — the pure check lives
   * there and this only resolves "is this qualified TEP promoted?".
   */
  promoteLocator?: PromoteLocator;
  /**
   * The server-side verifiability audit runner `write_spec` runs over a Spec's ACs (SP-6/1 / TEP-6).
   * Injected so the handler's enforcement — *honor the verdict, sign on pass, refuse otherwise* — is
   * unit-testable with a fixed stub (`fixedAuditRunner`) in `env: local`; production (`main`) wires
   * the real headless-Claude runner (`createSdkAuditRunner`). Absent ⇒ signing is off and `write_spec`
   * falls back to the legacy `ac_verifications` param path (no provenance signature).
   */
  auditRunner?: AuditRunner;
  /**
   * The server signing secret loaded from globalStorage (`loadOrCreateSecret`), held only by the
   * server process and never seen by the agent. Its presence — together with {@link auditRunner} —
   * turns on the SP-6/1 provenance path: `write_spec` HMAC-signs the audited `ac_verifications` under
   * {@link AC_SIGNATURE_KEY} and stops honoring an agent-supplied map. Absent ⇒ legacy path.
   */
  signingSecret?: Buffer;
}

/**
 * The real, thinking space-backed promote locator for `write_spec` (#3). Only consulted by
 * `implementsPromoteCheck` for **qualified** (`<namespace>:TEP-<id>`) refs — bare
 * repo-local refs are accepted by the pure check without consulting us. Returns:
 *   - `true`  (promoted)   — the namespace is a project (`<product>/projects/<id>`)
 *                            whose `teps/` actually owns the TEP, OR we can't
 *                            classify (no thinking space root) so we accept rather than
 *                            block a write we can't reason about.
 *   - `false` (unpromoted) — a cross-thinking space ref whose TEP has not been promoted into
 *                            a project; `implementsPromoteCheck` refuses it, naming
 *                            `promote_tep`.
 */
function makeThinkingSpacePromoteLocator(ctx: HandlerContext): PromoteLocator {
  return (ref) => {
    const thinkingSpaceRoot = ctx.env.thinkingSpaceRoot;
    if (!thinkingSpaceRoot) return true; // can't classify → accept
    const m = /^([^/]+)\/projects\/([^/]+)$/.exec(ref.namespace);
    if (m) {
      const owned = projectTeps(thinkingSpaceRoot, m[1], m[2]).map(
        normalizeTepId,
      );
      return owned.includes(normalizeTepId(ref.id));
    }
    // A non-project (repo thinking space) namespace: a real cross-thinking space ref that hasn't
    // been promoted into a project.
    return false;
  };
}

/**
 * Process-wide fallback lock for `move_slice` / `accept_spec` when a caller did
 * not inject one via `ctx.lock` (e.g. unit tests). A single instance keyed by
 * thinking space handle is enough: per-handle slots keep different thinkingSpaces independent.
 */
const defaultThinkingSpaceWriteLock = new ConcurrencyLock();

function registerHandlers(server: any, types: any, ctx: HandlerContext): void {
  const writeGate = (toolName: string) => {
    if (!ctx.env.allowAIWrites) {
      throw new Error(
        `Tool "${toolName}" requires \`thinkube.kanban.allowAIWrites\` to be true (navigator mode is read-only).`,
      );
    }
  };

  server.setRequestHandler(types.ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFS,
  }));

  server.setRequestHandler(types.CallToolRequestSchema, async (req: any) => {
    const name = req.params.name as string;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await dispatchTool(name, args, ctx, writeGate);
      return {
        content: [
          {
            type: "text",
            text:
              typeof result === "string"
                ? result
                : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `${name} failed: ${(err as Error).message}`,
          },
        ],
      };
    }
  });

  server.setRequestHandler(types.ListResourcesRequestSchema, async () => ({
    resources: RESOURCE_DEFS,
  }));

  server.setRequestHandler(
    types.ReadResourceRequestSchema,
    async (req: any) => {
      const uri = req.params.uri as string;
      const text = await readResource(uri, ctx);
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text,
          },
        ],
      };
    },
  );
}

// ─── Tool definitions + dispatcher ──────────────────────────────────────────

/**
 * The optional `thinking space` parameter shared by every thinking space-scoped tool.
 */
const THINKING_SPACE_PARAM = {
  thinking_space: {
    type: "string",
    description:
      "REQUIRED — the thinking space this call acts on: the thinking space's home-relative id (e.g. `thinkube-platform/core/thinkube`), a `<product>/projects/<id>` project namespace, or an absolute path. There is NO default thinking space (a call must never silently act on the session's cwd repo thinking space). Bare repo names are not accepted (ambiguous) — call `list_thinking_spaces` for the ids.",
  },
} as const;

const TOOL_DEFS = [
  {
    name: "list_thinking_spaces",
    description:
      "Discover every Tandem thinking space across the configured roots: repos whose thinking space dir exists in the central sidecar namespace `<thinking space-root>/<container>/<rel>` (ADR-0008). Returns each thinking space's canonical id (home-relative path — the value to pass as `thinking space` to the other tools), name, and absolute path, plus which thinking space is this session's default. Linked git worktrees are omitted (they share their canonical repo's thinking space — address them by that repo's id). The semantic location is part of the id (`apps/…` = deployed app, `user-templates/…` = template, `thinkube-platform/…` = platform code).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_tags",
    description:
      "Aggregate the #hashtag mesh (SP-tgvil2) across every thinking space in the workspace. Returns each tag with its `count` and the `items` carrying it ({ thinking space: the thinking space id, handle: SP-{n} | SP-{n}_SL-{m} | TEP-{id}, kind }), sorted by tag. An item with N tags appears under all N; a tag clusters items from multiple thinkingSpaces (the cross-thinking space clustering layer — a project is a promoted tag). Folds a legacy `theme:` in as a tag.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_products",
    description:
      "List Products — the code-less top nodes of the hierarchy (SP-tgvjug / TEP-tgvh8p). A Product is a top-level directory in the sidecar thinking space root whose member Thinking Spaces are the thinking space namespaces nested under it. Returns each Product `{ id, name (from <product>/product.yaml, else the id), members: namespaces }`, sorted by id. Empty when no thinking space root is configured. Products generalize the old fixed Platform/Apps/Templates containers into arbitrary user-defined groupings; a Project (later) is a tag promoted under a Product.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_projects",
    description:
      "List Projects across all Products (SP-tgvkmt / TEP-tgvh8p). A Project is a bounded multi-repo effort = a promoted tag with a version-controlled home (`<product>/projects/<name>/project.yaml`). Returns each Project `{ product, id, name, state (open|done), tag, tep? }`, sorted. Empty when no thinking space root is configured. Use `get_project` to resolve a project's members (the items carrying its tag).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_project",
    description:
      "Get one Project's umbrella TEPs + its members (SP-tgvpbm). A Project is a code-less umbrella owning TEPs; its members are the specs (across thinkingSpaces) whose `implements:` resolves to one of those TEPs, plus their slices (inherited) — structural, not tags. Returns `{ project, teps: [TEP-id], members: [{ thinking space, handle, kind }] }`.",
    inputSchema: {
      type: "object",
      properties: {
        product: {
          type: "string",
          description:
            "The Product (top sidecar dir) the project lives under, e.g. `Platform`.",
        },
        id: {
          type: "string",
          description:
            "The project id (its directory name under `<product>/projects/`).",
        },
      },
      required: ["product", "id"],
      additionalProperties: false,
    },
  },
  {
    name: "promote_tep",
    description:
      "Promote a repo TEP into an existing Project's umbrella (SP-tgvpbm). Moves `TEP-<tep>` out of its repo's `teps/` into `<product>/projects/<id>/teps/`, then rewrites EVERY spec that implemented it (across thinkingSpaces) to the qualified umbrella ref — so all former implementers stay members and no dangling/bare ref remains. Returns `{ tep, movedTo, rewritten: [SP-handles] }`. The Project must already exist (create it with New Project first).",
    inputSchema: {
      type: "object",
      properties: {
        tep: {
          type: "string",
          description:
            "The TEP id to promote (with or without the `TEP-` prefix).",
        },
        product: {
          type: "string",
          description:
            "The Product the target project lives under, e.g. `Platform`.",
        },
        id: {
          type: "string",
          description: "The target project's id (under `<product>/projects/`).",
        },
      },
      required: ["tep", "product", "id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_thinking_space",
    description:
      "Current Tandem thinking space, projected from the committed `specs/SP-{n}/SL-{m}.md` slice files (in the thinking space's sidecar namespace). Returns the Ready / Doing / Done columns; each card carries its slice handle (`id`, e.g. `SP-3_SL-42`), title (`description`), and `specStale` / `specChange` (whether the parent Spec's requirements changed since the slice was last verified).",
    inputSchema: {
      type: "object",
      properties: { ...THINKING_SPACE_PARAM },
      additionalProperties: false,
    },
  },
  {
    name: "get_slice",
    description:
      "Read one slice file. Returns its handle, relative path, frontmatter, and body.",
    inputSchema: {
      type: "object",
      properties: {
        slice: {
          type: "string",
          description: "Slice handle, e.g. `SP-3_SL-42`.",
        },
        ...THINKING_SPACE_PARAM,
      },
      required: ["slice"],
      additionalProperties: false,
    },
  },
  {
    name: "get_thinkube_file",
    description:
      "Read a specific markdown file from the thinking space (frontmatter + body). Path is relative to the thinking space directory (the sidecar namespace).",
    inputSchema: {
      type: "object",
      properties: {
        relative_path: { type: "string", description: "e.g. specs/SP-50.md" },
        ...THINKING_SPACE_PARAM,
      },
      required: ["relative_path"],
      additionalProperties: false,
    },
  },
  {
    name: "move_slice",
    description:
      "Move a slice to a different column by setting its `status:` frontmatter. Status must be one of: Ready, Doing, Done, Requires-attention (a needs-human state the orchestrator sets when a worker can't resolve a problem — SP-tgs8nz; /attend returns it to the loop), or Retired. **Retired** (SP-th4wqd) is a TERMINAL state DISTINCT from Done — it records a required `reason` (a retire with no `reason` is refused), drops the slice off the active thinking space/frontier, and the → Done gate never runs for it; the slice file stays on disk so its `SL-{m}` stays reserved (the next slice is still `max+1`). Moving to Done is REFUSED unless every acceptance criterion the slice lists in `satisfies` is checked on the parent Spec (the error names the offending criterion); slices with no `satisfies` are not gated. The → Done **docs gate** (TEP-tgh6iy) also applies: a `docs: required` slice must have its documentation done — pass `docs_done: true` once you've updated the doc module. In blocking mode an unsatisfied obligation is refused; in advisory mode (default) the move returns a `docsWarning`. On a successful Done it stamps the slice's `verified_req_hash` from the parent Spec so a later requirement edit re-flags it stale.",
    inputSchema: {
      type: "object",
      properties: {
        slice: {
          type: "string",
          description: "Slice handle, e.g. `SP-3_SL-42`.",
        },
        status: {
          type: "string",
          enum: ["Ready", "Doing", "Done", "Requires-attention", "Retired"],
        },
        reason: {
          type: "string",
          description:
            "Why the slice is being retired — REQUIRED when `status: Retired` (a terminal state distinct from Done must record why); recorded as `reason` on the slice. Ignored for other statuses.",
        },
        docs_done: {
          type: "boolean",
          description:
            "Attest that a `docs: required` slice's documentation was updated in this slice (TEP-tgh6iy). Satisfies the → Done docs gate; persisted as `docs_done` on the slice. Only meaningful when moving to Done.",
        },
        ...THINKING_SPACE_PARAM,
      },
      required: ["slice", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "accept_spec",
    description:
      "Record the human acceptance of a Spec — the single end-of-Spec gate (TEP-0010). REFUSED unless every slice under the Spec is Done and every acceptance criterion is checked on the Spec (the error names the blocker). On success it stamps `accepted:` on the Spec, so the acceptance card may enter Done and the Spec's PR merge.",
    inputSchema: {
      type: "object",
      properties: {
        spec: {
          type: "string",
          description: "The Spec id (SP-{id}) to accept.",
        },
        ...THINKING_SPACE_PARAM,
      },
      required: ["spec"],
      additionalProperties: false,
    },
  },
  {
    name: "create_slice",
    description:
      "Create a new slice under a Spec in the canonical shape. The server allocates the SL number (per-Spec, archive-aware) and serializes the file (frontmatter + `# title` heading + detail body) — callers never pick numbers or format files. Refused when the parent Spec is missing or has an empty `## Acceptance Criteria` (the → Ready gate, enforced at creation). Title limit: 70 chars — detail belongs in the body.",
    inputSchema: {
      type: "object",
      properties: {
        spec: {
          type: "string",
          description:
            "Parent Spec id (the SP-{id} this slice belongs to) — an opaque string (base36-epoch for new Specs, a legacy integer for old ones).",
        },
        title: {
          type: "string",
          description:
            "The concrete capability delivered, ≤ 70 chars — becomes the card title.",
        },
        body: {
          type: "string",
          description:
            '2–4 lines of detail: what the coherent end-to-end cut includes and what the observable "done" looks like.',
        },
        parallel: {
          type: "boolean",
          description:
            "Shares no files/state with sibling slices (parallel-eligible).",
        },
        parallel_group: {
          type: "string",
          description:
            "Named concurrency group (SP-tgpwbm). Slices sharing a parallel_group may run in parallel worktrees, so their `files` sets must be disjoint — the server refuses a group whose members overlap, naming the conflicting files.",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description:
            'Repo-relative paths this slice will edit (its machine-readable file set), e.g. ["src/a.ts"]. The unit of disjointness for a parallel_group and, later, the ownership arbiter.',
        },
        satisfies: {
          type: "array",
          items: { type: "integer", minimum: 1 },
          description:
            "1-based AC ordinals this slice delivers (positions in the parent Spec's `## Acceptance Criteria`). Arms the → Done gate: the slice can't reach Done until each listed criterion is checked on the Spec.",
        },
        contract: {
          type: "string",
          description:
            "The slice's design-time CONTRACT (SP-6/3): the shared interface — the exact exports, types, signatures and behaviour — every work unit builds against, written by the slicer WHEN THE SLICE IS CREATED (~10–20 lines, not prose). It is injected verbatim into every worker's prompt (code AND held-out test alike), so the units agree on the seam WITHOUT reading each other's code. Because the contract pins the interface up front, a contract-defined slice needs `consumes` ONLY for a genuine produced-artifact dependency (a unit that ingests another unit's OUTPUT) — never for interface agreement — and its units are exempt from the contract-first gate (the contract IS the shared seam). Write the contract for any multi-unit slice.",
        },
        work_units: {
          type: "array",
          items: {
            type: "object",
            properties: {
              footprint: { type: "array", items: { type: "string" } },
              consumes: {
                type: "array",
                items: { type: "string" },
                description:
                  "Files a SIBLING unit produces that this unit reads — the contract-first reference and the authored dependency language. Naming a sibling's footprint here satisfies the contract-first gate (the unit is coordinated through that contract, not fanned out blind) and is resolved into a real dependency edge on the producing unit(s). It is a file, not a node-id, so it is authorable at create time even though the slice has no number yet.",
              },
              reads: {
                type: "array",
                items: { type: "string" },
                description:
                  "Files this unit READS but does not itself produce (SP-6/2). The declared read set the undeclared-cross-unit-read gate audits: any read that lands on a SIBLING unit's footprint with NO matching `consumes` is an undeclared cross-unit dependency and the slice is refused (naming the file and its producer) — add `consumes` for it so it is a real scheduling edge, or drop it. A read of a file no sibling produces is a pre-existing file and is fine. Declared (not inferred), so the gate runs at the door.",
              },
              execution: {
                type: "string",
                enum: ["serial", "mechanize", "fan-out"],
              },
              role: {
                type: "string",
                enum: ["code", "test"],
                description:
                  "Independent-verification role (SP-6/7). `code` (default) implements to the Spec's INTENT — the `## Acceptance Criteria` are stripped from its prompt. `test` is the held-out verifier: it KEEPS the ACs in its prompt and its footprint is the reserved `acceptance/` probe path, so the grade it authors is independent of the code-author. A code-author's own co-located test can never tick an AC green; only a held-out `acceptance/` probe (or an `env: assessment` AC) counts.",
              },
              note: { type: "string" },
              // Contract-first opt-out (SP-th4wqi). The property KEY is the shared
              // CONTRACT_FIRST_OPTOUT_FIELD constant so the schema's field name
              // can never drift from the name `contractFirstCheck` reads.
              [CONTRACT_FIRST_OPTOUT_FIELD]: {
                type: "boolean",
                description:
                  "Opt this unit out of the contract-first gate — accept a genuinely-independent `*.test.*`/integration `fan-out` unit that has no `consumes` even though it sits beside sibling implementation units. Use ONLY when the test truly shares no contract with its siblings; the default refusal exists because " +
                  CONTRACT_FIRST_RULE_MSG,
              },
            },
            required: ["footprint", "execution"],
            additionalProperties: false,
          },
          description:
            "Execution-aware work units (SP-tgs8gb): each { footprint (files/objects it touches), consumes? (files a sibling unit produces that this unit reads — the only dependency language), execution: serial|mechanize|fan-out, note? (the unit's task text — self-describing, required in practice for fan-out) }. Uniform data-parallel work collapses to one `mechanize` unit; heterogeneous → `fan-out` (one per object, each with its `note`); coupled → `serial`. The slice stays the validation envelope; work units are never independently gated. A `*.test.*`/integration `fan-out` unit with no `consumes` beside sibling implementers is refused by the contract-first gate (route it through a shared contract file via `consumes`, or set the opt-out flag for a genuinely-independent test). Express every dependency as `consumes`.",
        },
        docs: {
          type: "string",
          enum: ["required", "n/a"],
          description:
            "Documentation obligation (TEP-tgh6iy). `required` (default) arms the → Done docs gate for user-facing work; `n/a` skips it but requires `docs_reason`. Internal refactors / test-only / infra are `n/a`.",
        },
        docs_reason: {
          type: "string",
          description:
            "One-line justification, required when `docs: n/a` — why this slice needs no documentation.",
        },
        priority: {
          type: "string",
          enum: ["P0", "P1", "P2", "P3"],
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "Free-form clustering tags — the #hashtag mesh (SP-tgvil2): component (`keycloak`), concern (`security`), project (`rebrand`). Many-to-many, cross-thinking space (surfaced by `list_tags`).",
        },
        ...THINKING_SPACE_PARAM,
      },
      required: ["spec", "title", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "write_spec",
    description:
      "Write a Spec's document at `specs/SP-{id}/spec.md` in the thinking space (the sidecar namespace), creating it if absent. Replaces the markdown body; existing frontmatter (e.g. `accepted:`) is preserved, and `implements:` can be set via its parameter. Omit `spec` to mint a conflict-free base36-epoch id (parity with `write_tep`); pass it to update an existing Spec. The minted/given id is returned as `spec`. This is the thinking space-aware write path for `/spec-prepare` — use it instead of a raw file write, which would land outside the thinking space.",
    inputSchema: {
      type: "object",
      properties: {
        spec: {
          type: "string",
          description:
            "Spec id (the SP-{id}) — an opaque string (base36-epoch for new Specs, a legacy integer for old ones). Omit to mint a new base36-epoch id.",
        },
        body: {
          type: "string",
          description:
            "The full Spec markdown body (the `# title` heading + the four canonical sections).",
        },
        implements: {
          type: "string",
          description:
            "The TEP this Spec implements — a bare `TEP-<id>` (repo-local) or a qualified `<namespace>:TEP-<id>` (cross-thinking space / umbrella project). Sets the `implements:` frontmatter (the TEP↔spec link + umbrella membership, which `promote_tep` rewrites). Omit to leave it unchanged; empty string clears it.",
        },
        repo: {
          type: "string",
          description:
            "The WORKING repository for a project-member spec — a thinking space namespace (e.g. `thinkube-platform/core/thinkube-metadata`) the orchestrator branches a worktree in, independent of where the spec file lives under the project umbrella. Sets the `repo:` frontmatter. Omit to leave unchanged; empty clears it. A normal same-repo spec needs none (the orchestrator falls back to the thinking space's repo).",
        },
        ac_verifications: {
          type: "object",
          description:
            "The closing AI-verification gate's per-AC declaration (SP-tgzyfy / TEP-tgzx3p): a map keyed by 1-based AC ordinal → `{ run, env? }`, where `run` is the shell/playbook command that verifies that AC (exit 0 = pass) and `env` is `cluster` (an infra lifecycle) or `local`. The orchestrator runs the union as a full plan at Spec quiescence and gates Done/commit on all-green (no skip; red or un-runnable → requires-attention). Sets the `ac_verifications:` frontmatter; omit to leave unchanged, pass `{}` to clear.",
          additionalProperties: {
            type: "object",
            properties: {
              run: { type: "string" },
              env: {
                type: "string",
                enum: ["cluster", "local", "assessment"],
                description:
                  "`cluster` (an infra lifecycle) or `local` for a runnable command; `assessment` (SP-6/7 AC3) for a prose/UX/skill AC graded by a fresh independent assessor session (not the implementing worker) that returns pass/fail + rationale from the AC + intent + delivered artifact — no runnable command required.",
              },
            },
            required: ["run"],
            additionalProperties: false,
          },
        },
        ...THINKING_SPACE_PARAM,
      },
      required: ["body"],
      additionalProperties: false,
    },
  },
  {
    name: "patch_spec_section",
    description:
      "Replace exactly ONE named section of an existing Spec's body, leaving every other section byte-identical, and write the whole body back through the secret-scanning safe-write path. Use this for a single-section edit (e.g. updating `## Acceptance Criteria`) instead of the read-modify-write-whole-body dance — `write_spec` replaces the entire body, this surgically patches one section. The `section` is the heading text (without leading `#`s); the Spec must already exist. Frontmatter is preserved.",
    inputSchema: {
      type: "object",
      properties: {
        spec: {
          type: "string",
          description:
            "Spec id (the SP-{id}) whose section to patch — an opaque string (base36-epoch for new Specs, a legacy integer for old ones).",
        },
        section: {
          type: "string",
          description:
            "The heading of the section to replace — the heading text without the leading `#`s (e.g. `Acceptance Criteria`).",
        },
        content: {
          type: "string",
          description:
            "The replacement content for that named section. Every other section of the Spec is left byte-identical.",
        },
        ...THINKING_SPACE_PARAM,
      },
      required: ["spec", "section", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "update_slice",
    description:
      "Update a slice in place, keeping its `SL-{m}` number. Pass `body` to replace the markdown body (frontmatter is preserved; the body's first line must be the `# title` heading — if the new body lacks one, the existing title is re-attached and the input is treated as detail, so a card can never become heading-less). **Re-cut (SP-th4wqd):** pass `files` / `satisfies` / `work_units` to REPLACE the slice's footprint fields without re-creating it — a re-scope. A provided field replaces wholesale (an empty array clears it); an omitted field is left untouched. A re-cut whose declared footprint (any `files` path or `work_units[].footprint` path) escapes the thinking space repo is REFUSED with the same rejection `create_slice` gives — the check routes through the shared repo guard, not a copy. `body` is optional: omit it for a pure re-cut and the body is left unchanged.",
    inputSchema: {
      type: "object",
      properties: {
        slice: {
          type: "string",
          description: "Slice handle, e.g. `SP-3_SL-42`.",
        },
        body: {
          type: "string",
          description:
            "Replacement markdown body (first line must be the `# title` heading). Omit to leave the body unchanged (e.g. for a pure re-cut).",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "Replace the slice's clustering tags (SP-tgvil2). Omit to leave tags unchanged; pass `[]` to clear.",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description:
            "Re-cut (SP-th4wqd): REPLACE the slice's machine-readable file set (repo-relative paths). Omit to leave unchanged; pass `[]` to clear. Validated against the thinking space repo with the same guard `create_slice` uses — a path that escapes the repo is refused.",
        },
        satisfies: {
          type: "array",
          items: { type: "integer", minimum: 1 },
          description:
            "Re-cut (SP-th4wqd): REPLACE the 1-based AC ordinals this slice delivers. Omit to leave unchanged; pass `[]` to clear.",
        },
        contract: {
          type: "string",
          description:
            "Re-cut: REPLACE the slice's design-time contract (SP-6/3 — the shared interface, compilable signatures, injected into every worker's prompt). Omit to leave unchanged. A re-scope that changes the seam must revise the contract here, never by hand-editing frontmatter.",
        },
        work_units: {
          type: "array",
          items: {
            type: "object",
            properties: {
              footprint: { type: "array", items: { type: "string" } },
              consumes: {
                type: "array",
                items: { type: "string" },
                description:
                  "Files a SIBLING unit produces that this unit reads — the contract-first reference and the authored dependency language. Naming a sibling's footprint here satisfies the contract-first gate and is resolved into a real dependency edge on the producing unit(s). It is a file, not a node-id.",
              },
              execution: {
                type: "string",
                enum: ["serial", "mechanize", "fan-out"],
              },
              role: {
                type: "string",
                enum: ["code", "test"],
                description:
                  "Independent-verification role (SP-6/7). `code` (default) sees the Spec's intent only; `test` is the held-out verifier (keeps the ACs, footprint under the reserved `acceptance/` path).",
              },
              note: { type: "string" },
              [CONTRACT_FIRST_OPTOUT_FIELD]: {
                type: "boolean",
                description:
                  "Opt this unit out of the contract-first gate — accept a genuinely-independent `*.test.*`/integration `fan-out` unit with no `consumes` beside sibling implementers. Use ONLY when the test truly shares no contract with its siblings; the default refusal exists because " +
                  CONTRACT_FIRST_RULE_MSG,
              },
            },
            required: ["footprint", "execution"],
            additionalProperties: false,
          },
          description:
            "Re-cut (SP-th4wqd): REPLACE the slice's execution-aware work units. Omit to leave unchanged; pass `[]` to clear. Each unit's `footprint` is checked against the thinking space repo with the same guard `create_slice` uses. Express dependencies as `consumes` (a sibling unit's produced file).",
        },
        ...THINKING_SPACE_PARAM,
      },
      required: ["slice"],
      additionalProperties: false,
    },
  },
  {
    name: "write_tep",
    description:
      "Write a Tandem Enhancement Proposal at `teps/TEP-<id>.md` in the thinking space (the sidecar namespace), creating it if absent (TEP-0009). The thinking space-aware write path for `/tep` — use it instead of a raw file write. Omit `tep` to mint a conflict-free base36-epoch id; pass it to update an existing TEP. On create, the body defaults to the `TEP-TEMPLATE.md` scaffold and canonical frontmatter (kind/id/status/created/implemented_by) is filled; on update, existing frontmatter is preserved. `title`/`status` set those fields. Promotion-aware (TEP-th3i18 #14): if the TEP has been promoted into a Project (its canonical home moved to `<product>/projects/<id>/teps/`), the update lands on that **project copy** — no stale duplicate is left on the session thinking space; if more than one project claims it the write is refused, pointing you at `promote_tep` to reconcile the single home.",
    inputSchema: {
      type: "object",
      properties: {
        tep: {
          type: "string",
          description:
            "TEP id (with or without the `TEP-` prefix). Omit to mint a new base36-epoch id.",
        },
        title: { type: "string", description: "TEP title (frontmatter)." },
        status: {
          type: "string",
          description:
            "Lifecycle status: proposed | accepted (approved-to-build) | implemented (delivered — refused until every implementing Spec is accepted) | superseded.",
        },
        body: {
          type: "string",
          description:
            "The TEP markdown body. Omit on create to scaffold from TEP-TEMPLATE.md.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "Clustering tags for the TEP — the #hashtag mesh (SP-tgvil2), surfaced cross-thinking space by `list_tags`.",
        },
        ...THINKING_SPACE_PARAM,
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "write_retro_note",
    description:
      "Append a retro note to today's `retros/{YYYY-MM-DD}.md` in the thinking space.",
    inputSchema: {
      type: "object",
      properties: { body: { type: "string" }, ...THINKING_SPACE_PARAM },
      required: ["body"],
      additionalProperties: false,
    },
  },
  {
    name: "start_spec_worktree",
    description:
      "Open the Spec's git worktree session (the 'Start Spec in Worktree' action) without a manual button — so a session that just sliced a Spec can hand off directly into a thinking space-connected worktree pair session. Writes a one-shot control request the Extension Host picks up via a file watcher (the same MCP→host filesystem channel the thinking space uses), which runs `thinkube.specs.startWorktree` (create-or-reuse + thinking space-root inject + open session). Requires the host to be running.",
    inputSchema: {
      type: "object",
      properties: {
        spec: {
          type: "string",
          description:
            "The Spec id (the SP-{id}) whose worktree session to open — an opaque string (base36-epoch or a legacy integer).",
        },
        ...THINKING_SPACE_PARAM,
      },
      required: ["spec"],
      additionalProperties: false,
    },
  },
];

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  ctx: HandlerContext,
  writeGate: (n: string) => void,
): Promise<unknown> {
  if (name === "list_thinking_spaces") return listThinkingSpaces(ctx);
  if (name === "list_tags") return listTags(ctx);
  if (name === "list_products") return listProducts(ctx);
  if (name === "list_projects") return listProjects(ctx);
  if (name === "get_project")
    return getProject(ctx, asString(args, "product"), asString(args, "id"));
  if (name === "promote_tep") {
    writeGate(name);
    return promoteTep(
      ctx,
      asString(args, "tep"),
      asString(args, "product"),
      asString(args, "id"),
    );
  }

  // Every other tool is thinking space-scoped: resolve the store per call.
  const store = ctx.thinkingSpaces.resolve(optString(args, "thinking_space"));

  // Per-handle write lock (#20): `move_slice` / `accept_spec` do a
  // read-modify-write of the thinking space, so two interleaving on the SAME thinking space race
  // — the second clobbers the first ("last write wins"). Serialize them per
  // thinking space handle so a queued op only reads state after the in-flight write has
  // landed. The handle is the thinking space dir (a stable absolute path); distinct
  // thinkingSpaces stay independent.
  const writeLock = ctx.lock ?? defaultThinkingSpaceWriteLock;
  const thinkingSpaceHandle = store.thinkubeDir;

  switch (name) {
    case "list_thinking_space":
      return listThinkingSpace(store);
    case "get_slice":
      return getSlice(store, asString(args, "slice"));
    case "get_thinkube_file":
      return getThinkubeFile(store, asString(args, "relative_path"));
    case "move_slice":
      writeGate(name);
      return writeLock.runExclusive(thinkingSpaceHandle, () =>
        moveSlice(store, asString(args, "slice"), asString(args, "status"), {
          docsGateMode: ctx.env.docsGateMode,
          docsDone: optBoolean(args, "docs_done"),
          reason: optString(args, "reason"),
        }),
      );
    case "accept_spec":
      writeGate(name);
      return writeLock.runExclusive(thinkingSpaceHandle, () =>
        acceptSpec(
          store,
          typeof args.spec === "number"
            ? String(args.spec)
            : asString(args, "spec"),
        ),
      );
    case "create_slice": {
      writeGate(name);
      // Resolve a bare SP number to its composite `<tep>/<sp>` (SP numbers are
      // per-TEP) up front, so the TEP-approval gate and createSlice below act on
      // the same real spec — not an ambiguous bare id that mis-resolves.
      const createSpecId = await resolveCompositeSpecId(
        () => store.listSpecDirs(),
        typeof args.spec === "number"
          ? String(args.spec)
          : asString(args, "spec"),
      );
      // Approval gate (SP-th4wqg_SL-1, TEP-th3i18 #25): a slice may not reach
      // Ready while the parent Spec's `implements:` TEP is not yet `accepted`
      // (approved-to-build). Resolve the TEP's status via thinking space context and run
      // the pure `tepApprovalGate` before `createSlice` does any work, so the
      // refusal (naming the TEP + its status) fires at the door.
      await assertTepApproved(ctx, store, createSpecId);
      return createSlice(
        store,
        {
          // Spec id is a string (base36-epoch); tolerate a numeric integer id
          // from callers that still pass a number (legacy specs).
          spec: createSpecId,
          title: asString(args, "title"),
          body: asString(args, "body"),
          depends_on: optStringArray(args, "depends_on"),
          parallel: optBoolean(args, "parallel"),
          parallel_group: optString(args, "parallel_group"),
          files: optStringArray(args, "files"),
          satisfies: optNumberArray(args, "satisfies"),
          contract: optString(args, "contract"),
          // The execution-aware work units (SP-tgs8gb). Forwarded verbatim — createSlice
          // validates each unit's footprint and serializes the array to frontmatter. Without
          // this line the schema accepts work_units but the handler silently drops it (the
          // bug that left every created slice with no work_units).
          work_units: Array.isArray(args.work_units)
            ? (args.work_units as {
                footprint: string[];
                depends_on?: string[];
                consumes?: string[];
                reads?: string[];
                execution: string;
                role?: string;
                note?: string;
              }[])
            : undefined,
          docs: optString(args, "docs"),
          docs_reason: optString(args, "docs_reason"),
          priority: optString(args, "priority"),
          tags: optStringArray(args, "tags"),
        },
        // SP-6/1 provenance: hand `createSlice` the server signing secret so its
        // → Ready gate verifies the `ac_verifications` signature (not the
        // reproducible hash) and refuses a Spec whose auditor was skipped. Absent
        // ⇒ legacy hash-only gate.
        ctx.signingSecret,
      );
    }
    case "write_spec": {
      writeGate(name);
      // #3 cross-thinking space learnability: refuse an `implements:` naming a TEP on
      // another thinking space that hasn't been promoted into a project — the link would
      // dangle. The locator is injected (AC#3 drives this with a fake) or built
      // from the thinking space context here.
      const implementsRaw = optString(args, "implements");
      const promoteCheck = await implementsPromoteCheck(
        implementsRaw,
        ctx.promoteLocator ?? makeThinkingSpacePromoteLocator(ctx),
      );
      if (!promoteCheck.ok) throw new Error(promoteCheck.message);
      // #6 minting: `spec` is optional — when omitted, mint a fresh base36-epoch
      // id via the store allocator (parity with `write_tep`). The pure
      // `resolveSpecId` helper owns the decision; we inject the allocator.
      // Parent TEP (from `implements:` — bare `TEP-n` or qualified `<ns>:TEP-n`)
      // scopes a NEW spec's `SP-m` allocation; its id is the composite `${tep}/${m}`.
      const parentTep = implementsRaw
        ? implementsRaw.trim().split(":").pop()!.trim().replace(/^TEP-/i, "")
        : undefined;
      const specId = await resolveSpecId(
        typeof args.spec === "number"
          ? String(args.spec)
          : optString(args, "spec"),
        async () => {
          if (!parentTep)
            throw new Error(
              "write_spec needs `implements: TEP-<n>` to place a new spec under its TEP.",
            );
          return `${parentTep}/${await store.nextSpecNumber(parentTep)}`;
        },
      );
      // A Spec doc lives at the composite `<tep>/<spec>` location (pathForSpecDoc).
      // The mint path already returns that composite; a caller-PROVIDED id may be the
      // bare SP NUMBER (`2`) — the shape `/spec-prepare` passes (`spec: {n}`) — which
      // must be composed with its parent TEP (from `implements:`) to resolve
      // `teps/TEP-<tep>/SP-<m>/spec.md`. Without this a bare numeric fell through to
      // `pathForSpecDoc("2")` → `TEP-2/SP-undefined`, silently creating a stray,
      // wrong-placed doc instead of updating the intended spec. A bare numeric with no
      // `implements:` can't be located, so refuse rather than write a stray. Opaque
      // ids and already-composite (`<tep>/<spec>`) ids are used verbatim.
      let composedSpecId = specId;
      if (!specId.includes("/") && /^\d+$/.test(specId)) {
        if (!parentTep)
          throw new Error(
            `write_spec needs \`implements: TEP-<n>\` to resolve the bare spec id \`${specId}\` to its \`TEP-<n>/SP-${specId}\` location.`,
          );
        composedSpecId = `${parentTep}/${specId}`;
      }
      // SP-6/1 provenance: when the server holds a signing secret AND an audit runner, the audit
      // runs server-side. It must run where the CODE lives — the spec's WORKING repo (`repo:`),
      // NOT store.workspaceRoot (the project-umbrella root has no package.json / repo-conventions,
      // so the audit can neither read the code nor derive the real verification recipe — that's why
      // it fabricated `npx vitest`). Resolve `repo:` (this call's arg, else the spec's existing
      // frontmatter) to its path; fall back to the thinking space repo for a normal same-repo spec.
      const auditOn =
        ctx.auditRunner !== undefined && ctx.signingSecret !== undefined;
      let auditCwd = store.workspaceRoot;
      if (auditOn) {
        const existingForRepo = await store.getFile(
          store.pathForSpecDoc(composedSpecId),
        );
        const repoNs =
          optString(args, "repo") ??
          (typeof existingForRepo?.frontmatter?.repo === "string"
            ? existingForRepo.frontmatter.repo.trim()
            : undefined);
        const resolved = repoNs
          ? repoPathForNamespace(repoNs, ctx.env.folders)
          : undefined;
        if (resolved && fsSync.existsSync(resolved)) auditCwd = resolved;
      }
      return writeSpec(
        store,
        composedSpecId,
        asString(args, "body"),
        implementsRaw,
        // The closing gate's per-AC declaration (SP-tgzyfy). Forwarded verbatim — writeSpec
        // normalizes + serializes it to the `ac_verifications:` frontmatter; undefined leaves
        // any existing map intact, `{}` clears it. NOTE (SP-6/1): when signing is on (the audit
        // context below is supplied), this agent-supplied map is *ignored* — `write_spec` runs the
        // audit itself and signs only what its own audit produced.
        args.ac_verifications !== undefined &&
          typeof args.ac_verifications === "object" &&
          !Array.isArray(args.ac_verifications)
          ? (args.ac_verifications as Record<string, unknown>)
          : undefined,
        optString(args, "repo"),
        auditOn
          ? {
              runner: ctx.auditRunner!,
              secret: ctx.signingSecret!,
              cwd: auditCwd,
            }
          : undefined,
      );
    }
    case "patch_spec_section":
      writeGate(name);
      return patchSpecSection(
        store,
        typeof args.spec === "number"
          ? String(args.spec)
          : asString(args, "spec"),
        asString(args, "section"),
        asString(args, "content"),
      );
    case "update_slice":
      writeGate(name);
      return updateSlice(
        store,
        asString(args, "slice"),
        // Body is optional (a pure re-cut needn't restate it).
        optString(args, "body"),
        optStringArray(args, "tags"),
        // Re-cut footprint fields (SP-th4wqd): a provided field replaces, omitted
        // is left untouched. Forwarded verbatim; updateSlice routes them through
        // the shared repo guard before writing.
        {
          files: optStringArray(args, "files"),
          satisfies: optNumberArray(args, "satisfies"),
          work_units: Array.isArray(args.work_units)
            ? (args.work_units as Frontmatter["work_units"])
            : undefined,
          contract: optString(args, "contract"),
        },
      );
    case "write_tep": {
      writeGate(name);
      const tepStatus = optString(args, "status");
      const tepArg = optString(args, "tep");
      // Completeness gate (SP-th4wqg_SL-3, TEP-th3i18 #26): `implemented` is the
      // terminal "delivered" status — refuse it while any implementing Spec is
      // still unaccepted (the TEP hasn't actually been delivered). Resolve the
      // TEP's implementing Specs via thinking space context and run the pure `tepComplete`.
      if (tepStatus === "implemented" && tepArg) {
        await assertTepComplete(ctx, store, tepArg);
      }
      // #14 — pass the full handler context so `writeTep` can resolve a promoted
      // TEP to its project copy (thinkingSpaceRoot + thinkingSpaces), not split-brain the session
      // thinking space. `ctx` is last + optional so the existing `writeTep(store, args)`
      // call sites (tagsTools.test) keep compiling.
      return writeTep(
        store,
        {
          tep: tepArg,
          title: optString(args, "title"),
          status: tepStatus,
          body: optString(args, "body"),
          tags: optStringArray(args, "tags"),
        },
        ctx,
      );
    }
    case "write_retro_note":
      writeGate(name);
      return writeRetroNote(store, asString(args, "body"));
    case "start_spec_worktree":
      writeGate(name);
      return startSpecWorktree(
        typeof args.spec === "number"
          ? String(args.spec)
          : asString(args, "spec"),
        store.workspaceRoot,
      );
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ─── Tool implementations ───────────────────────────────────────────────────

/**
 * Hand off "open this Spec's worktree session" to the Extension Host (AC8). The
 * MCP process can't open a VS Code session itself, so it writes a one-shot
 * control request into the host-published `THINKUBE_CONTROL_DIR`; the host's
 * file watcher consumes it and runs `thinkube.specs.startWorktree` (the same
 * create-or-reuse + thinking space-root inject + open-session machinery as the button,
 * SL-7). Reuses the thinking space's filesystem MCP→host channel — not the tmux bridge.
 */
async function startSpecWorktree(spec: string, repo: string): Promise<unknown> {
  const dir = process.env[CONTROL_DIR_ENV];
  if (!dir) {
    throw new Error(
      `${CONTROL_DIR_ENV} is not set, so the worktree hand-off can't reach the extension. Open the worktree from the Specs view button, or re-install the methodology bundle so the MCP env carries it.`,
    );
  }
  await fsSync.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, startWorktreeRequestFile(spec));
  await fsSync.promises.writeFile(
    file,
    serializeControlRequest({ kind: "start-worktree", spec, repo }),
    "utf8",
  );
  return { ok: true, spec, request: file };
}

// Org-scoped tree (TEP-th8lzj): a slice file is `<org>/teps/TEP-n/SP-m/SL-k.md`;
// the spec id is the composite `${tep}/${spec}` and its handle is the
// tep-qualified `TEP-n_SP-m`, the slice handle `TEP-n_SP-m_SL-k`.
const SLICE_PATH_RE = /teps\/TEP-(\d+)\/SP-(\d+)\/SL-(\d+)\.md$/;
const SLICE_HANDLE_RE = /^TEP-(\d+)_SP-(\d+)_SL-(\d+)$/;

/** The tep-qualified handle for a composite spec id (`${tep}/${spec}`). */
function specHandle(specId: string): string {
  const [tep, sp] = specId.split("/");
  return `TEP-${tep}_SP-${sp}`;
}
/** The slice handle from a SLICE_PATH_RE / SLICE_HANDLE_RE match `[_, tep, spec, slice]`. */
function sliceHandleFromMatch(m: RegExpExecArray): string {
  return `TEP-${m[1]}_SP-${m[2]}_SL-${m[3]}`;
}
/** The composite spec id (`${tep}/${spec}`) from such a match. */
function specIdFromMatch(m: RegExpExecArray): string {
  return `${m[1]}/${m[2]}`;
}
const VALID_STATUSES = [
  "ready",
  "doing",
  "done",
  "requires-attention",
  // Terminal, distinct from `done` (SP-th4wqd_SL-1) — read from the shared
  // contract so the wiring never re-spells the literal. A retired slice drops off
  // the active frontier but its file (and so its SL-{m}) stays on disk.
  RETIRED_STATUS,
] as const;

function listThinkingSpaces(ctx: HandlerContext): unknown {
  // A linked worktree shares its canonical repo's thinking space (it is addressable via
  // that repo's id), so it is not its own Thinking Space — omit worktree
  // checkouts so the vocabulary lists logical thinkingSpaces, not checkouts.
  return {
    // No default thinking space — every thinking space-scoped tool must pass `thinking_space=` explicitly.
    thinkingSpaces: ctx.thinkingSpaces
      .list(true)
      .filter((b) => !b.worktree)
      .map((b) => ({
        id: b.id,
        name: b.name,
        path: b.path,
      })),
  };
}

/** Collect every tagged item (spec / TEP / slice) in one thinking space's store. */
async function collectTaggedItems(
  store: ThinkubeStore,
  thinkingSpaceId: string,
  out: TaggedItem[],
): Promise<void> {
  for (const t of await store.listTeps()) {
    const tags = effectiveTags(
      (await store.getFile(t.relativePath))?.frontmatter,
    );
    if (tags.length)
      out.push({ thinkingSpaceId, handle: `TEP-${t.id}`, kind: "tep", tags });
  }
  for (const spec of await store.listSpecDirs()) {
    const tags = effectiveTags(
      (await store.getFile(store.pathForSpecDoc(spec)))?.frontmatter,
    );
    if (tags.length)
      out.push({
        thinkingSpaceId,
        handle: specHandle(spec),
        kind: "spec",
        tags,
      });
  }
  for (const rel of await store.listSlices()) {
    const m = SLICE_PATH_RE.exec(rel);
    if (!m) continue;
    const tags = effectiveTags((await store.getFile(rel))?.frontmatter);
    if (tags.length)
      out.push({
        thinkingSpaceId,
        handle: sliceHandleFromMatch(m),
        kind: "slice",
        tags,
      });
  }
}

export interface TagAggregate {
  tag: string;
  count: number;
  items: { thinking_space: string; handle: string; kind: string }[];
}

/**
 * Walk a set of thinkingSpaces, collect their tagged items, and group by tag — the pure
 * core of `list_tags` (exported for testing against tmp stores; the registry
 * walk in `listTags` is the thin glue over it).
 */
export async function aggregateTagsAcrossThinkingSpaces(
  thinkingSpaces: { thinkingSpaceId: string; store: ThinkubeStore }[],
): Promise<TagAggregate[]> {
  const items: TaggedItem[] = [];
  for (const b of thinkingSpaces)
    await collectTaggedItems(b.store, b.thinkingSpaceId, items);
  return [...groupByTag(items).entries()]
    .map(([tag, its]) => ({
      tag,
      count: its.length,
      items: its.map((i) => ({
        thinking_space: i.thinkingSpaceId,
        handle: i.handle,
        kind: i.kind,
      })),
    }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

/** `list_tags` — aggregate tags across every (non-worktree) thinking space in the workspace. */
async function listTags(ctx: HandlerContext): Promise<unknown> {
  const thinkingSpaces = ctx.thinkingSpaces
    .list(true)
    .filter((b) => !b.worktree)
    .map((b) => ({
      thinkingSpaceId: b.id,
      store: ctx.thinkingSpaces.resolve(b.id),
    }));
  return { tags: await aggregateTagsAcrossThinkingSpaces(thinkingSpaces) };
}

/** `list_products` — Products (code-less top nodes) discovered from the sidecar
 * thinking space root, each with its member namespaces. Empty when no thinking space root is set. */
export function listProducts(ctx: HandlerContext): unknown {
  return {
    products: ctx.env.thinkingSpaceRoot
      ? discoverProducts(ctx.env.thinkingSpaceRoot)
      : [],
  };
}

/** `list_projects` — every product's Projects (manifests) discovered from the
 * sidecar thinking space root. Empty when no thinking space root is set. */
export function listProjects(ctx: HandlerContext): unknown {
  return {
    projects: ctx.env.thinkingSpaceRoot
      ? discoverProjects(ctx.env.thinkingSpaceRoot)
      : [],
  };
}

/**
 * `get_project` — a Project's manifest + its members (SP-tgvpbm). A Project is a
 * code-less umbrella owning TEPs; its members are the specs (across thinkingSpaces) whose
 * `implements:` resolves to one of the project's umbrella TEPs, PLUS each such
 * spec's slices (inherited). Membership is structural (`implements:`), not tags.
 * Throws if the project is unknown.
 */
export async function getProject(
  ctx: HandlerContext,
  product: string,
  id: string,
): Promise<unknown> {
  const thinkingSpaceRoot = ctx.env.thinkingSpaceRoot;
  const project = (
    thinkingSpaceRoot ? discoverProjects(thinkingSpaceRoot) : []
  ).find((p) => p.product === product && p.id === id);
  if (!project) {
    throw new Error(
      `No project "${product}/${id}" under the thinking space root.`,
    );
  }
  const projectNamespace = `${product}/projects/${id}`;
  const tepIds = projectTeps(thinkingSpaceRoot!, product, id).map(
    normalizeTepId,
  );

  const members: { thinking_space: string; handle: string; kind: string }[] =
    [];
  // Per-umbrella-TEP implementing Specs (id + accepted stamp), for completeness.
  const implByTep = new Map<string, ImplementingSpec[]>();
  for (const t of tepIds) implByTep.set(t, []);
  for (const b of ctx.thinkingSpaces.list(true).filter((bb) => !bb.worktree)) {
    const store = ctx.thinkingSpaces.resolve(b.id);
    for (const spec of await store.listSpecDirs()) {
      const fm = (await store.getFile(store.pathForSpecDoc(spec)))?.frontmatter;
      const ref = parseImplements(
        typeof fm?.implements === "string" ? fm.implements : undefined,
      );
      // A member's `implements:` is qualified to this project's namespace and an
      // umbrella TEP it owns. (A bare ref is repo-local → never a project member.)
      if (
        !ref ||
        ref.namespace !== projectNamespace ||
        !tepIds.includes(ref.id)
      ) {
        continue;
      }
      members.push({
        thinking_space: b.id,
        handle: specHandle(spec),
        kind: "spec",
      });
      implByTep.get(ref.id)!.push({
        id: specHandle(spec),
        accepted: typeof fm?.accepted === "string" ? fm.accepted : undefined,
      });
      // Slices inherit membership from their spec.
      for (const rel of await store.listSlices(spec)) {
        const m = SLICE_PATH_RE.exec(rel);
        if (m)
          members.push({
            thinking_space: b.id,
            handle: sliceHandleFromMatch(m),
            kind: "slice",
          });
      }
    }
  }
  // Org-scoped tree: a project's member specs are NESTED under its umbrella TEPs
  // (`<project>/<org>/teps/TEP-n/SP-m/`) — promote_tep relocated them there. Read
  // them location-based; each carries `repo:` = its WORKING repository (the repo
  // the orchestrator branches a worktree in), which is what we surface as the
  // member's `thinking space`. (The cross-thinking space sweep above only catches any legacy
  // flat-model member still living in a repo thinking space with a qualified `implements:`.)
  const projDir = path.join(thinkingSpaceRoot!, product, "projects", id);
  const projStore = new ThinkubeStore(projDir, projDir);
  for (const spec of await projStore.listSpecDirs()) {
    const tep = normalizeTepId(spec.split("/")[0]);
    if (!tepIds.includes(tep)) continue;
    const fm = (await projStore.getFile(projStore.pathForSpecDoc(spec)))
      ?.frontmatter;
    const workingRepo =
      typeof fm?.repo === "string" && fm.repo.trim()
        ? fm.repo.trim()
        : projectNamespace;
    members.push({
      thinking_space: workingRepo,
      handle: specHandle(spec),
      kind: "spec",
    });
    implByTep.get(tep)!.push({
      id: specHandle(spec),
      accepted: typeof fm?.accepted === "string" ? fm.accepted : undefined,
    });
    for (const rel of await projStore.listSlices(spec)) {
      const m = SLICE_PATH_RE.exec(rel);
      if (m)
        members.push({
          thinking_space: workingRepo,
          handle: sliceHandleFromMatch(m),
          kind: "slice",
        });
    }
  }

  // Completeness (SP-th4wqg_SL-2): a TEP is complete only when every implementing
  // Spec is `accepted`; otherwise `openSpecs` names the unaccepted ones. Surfaced
  // per-umbrella-TEP plus an aggregate (the project is complete iff all its TEPs
  // are). The pure derivation is `tepComplete`.
  const completeness = tepIds.map((t) => {
    const r = tepComplete(t, implByTep.get(t) ?? []);
    return { tep: `TEP-${t}`, complete: r.complete, openSpecs: r.openSpecs };
  });
  return {
    project,
    teps: tepIds.map((t) => `TEP-${t}`),
    members,
    completeness,
    complete: completeness.length > 0 && completeness.every((c) => c.complete),
    openSpecs: [...new Set(completeness.flatMap((c) => c.openSpecs))],
  };
}

/** A thinking space's sidecar namespace = its thinking space dir relative to the thinking space root. */
function namespaceOfThinkingSpaceDir(
  thinkingSpaceRoot: string,
  thinkingSpaceDir: string,
): string {
  return path
    .relative(thinkingSpaceRoot, thinkingSpaceDir)
    .split(path.sep)
    .join("/");
}

// ─── TEP-lifecycle gate wiring (SP-th4wqg) ──────────────────────────────────
// The pure decisions live in `methodology/tepLifecycle`; these functions only do
// the thinking space-backed RESOLUTION (a TEP's status, a TEP's implementing Specs) and
// hand the result to the pure gate — the cross-thinking space side `promoteTep` models.

/** A thinking space's namespace key for `resolvesTo`: its sidecar namespace when a thinking space
 *  root is configured, else its absolute thinking space dir (so same-thinking space bare refs still
 *  match and different thinkingSpaces stay distinct). */
function thinkingSpaceNamespace(
  thinkingSpaceRoot: string | undefined,
  store: ThinkubeStore,
): string {
  return thinkingSpaceRoot
    ? namespaceOfThinkingSpaceDir(thinkingSpaceRoot, store.thinkubeDir)
    : store.thinkubeDir;
}

/**
 * Resolve the lifecycle status of the TEP a Spec's `implements:` ref names —
 * across thinkingSpaces. A **bare** ref resolves to a TEP in the Spec's OWN thinking space
 * (`store`); a **qualified** `<namespace>:TEP-id` ref to
 * `<thinkingSpaceRoot>/<namespace>/teps/TEP-id.md` (the sidecar layout
 * `namespaceOfThinkingSpaceDir` inverts). Returns the resolved `status` string, or
 * `undefined` when the ref names no resolvable TEP — `tepApprovalGate` treats
 * that as not-accepted.
 */
async function resolveTepStatus(
  ctx: HandlerContext,
  store: ThinkubeStore,
  ref: ParsedImplements,
): Promise<string | undefined> {
  const readStatus = async (s: ThinkubeStore): Promise<string | undefined> => {
    const fm = (await s.getFile(s.pathForTep(ref.id)))?.frontmatter;
    return typeof fm?.status === "string" ? fm.status : undefined;
  };
  // Bare ref → the Spec's own thinking space owns the TEP.
  if (!ref.namespace) return readStatus(store);
  // Qualified ref → the thinking space dir is <thinkingSpaceRoot>/<namespace>.
  const thinkingSpaceRoot = ctx.env.thinkingSpaceRoot;
  if (!thinkingSpaceRoot) return undefined;
  const thinkingSpaceDir = path.join(
    thinkingSpaceRoot,
    ...ref.namespace.split("/"),
  );
  return readStatus(new ThinkubeStore(thinkingSpaceDir, thinkingSpaceDir));
}

/**
 * Approval gate (AC#1): refuse a `create_slice` → Ready when the parent Spec's
 * `implements:` TEP is not `accepted`. Resolves the TEP's status via thinking space
 * context and runs the pure `tepApprovalGate`; throws its refusal message
 * (naming the TEP + status) on a block. A Spec with no `implements:` — or a
 * missing Spec doc (left for `createSlice` to report) — passes.
 */
async function assertTepApproved(
  ctx: HandlerContext,
  store: ThinkubeStore,
  specId: string,
): Promise<void> {
  const specDoc = await store.getFile(store.pathForSpecDoc(specId));
  const implementsRaw =
    typeof specDoc?.frontmatter?.implements === "string"
      ? specDoc.frontmatter.implements
      : undefined;
  const ref = parseImplements(implementsRaw);
  if (!ref) return; // no TEP linked → nothing to approve.
  const status = await resolveTepStatus(ctx, store, ref);
  const verdict = tepApprovalGate(implementsRaw, status);
  if (!verdict.ok) throw new Error(verdict.message);
}

/**
 * Resolve, across all (non-worktree) thinkingSpaces, the Specs whose `implements:`
 * resolves to the TEP `tepId` owned by `targetNamespace`, projected to
 * {@link ImplementingSpec} (id + `accepted:` stamp). A bare ref resolves to its
 * own thinking space; a qualified ref to its explicit namespace (`resolvesTo`). The pure
 * `tepComplete` derives completeness from these.
 */
async function implementingSpecsOfTep(
  ctx: HandlerContext,
  targetNamespace: string,
  tepId: string,
): Promise<ImplementingSpec[]> {
  const thinkingSpaceRoot = ctx.env.thinkingSpaceRoot;
  const out: ImplementingSpec[] = [];
  for (const b of ctx.thinkingSpaces.list(true).filter((bb) => !bb.worktree)) {
    const s = ctx.thinkingSpaces.resolve(b.id);
    const specNs = thinkingSpaceNamespace(thinkingSpaceRoot, s);
    for (const spec of await s.listSpecDirs()) {
      const fm = (await s.getFile(s.pathForSpecDoc(spec)))?.frontmatter;
      const ref = parseImplements(
        typeof fm?.implements === "string" ? fm.implements : undefined,
      );
      if (ref && resolvesTo(ref, specNs, targetNamespace, tepId)) {
        out.push({
          id: specHandle(spec),
          accepted: typeof fm?.accepted === "string" ? fm.accepted : undefined,
        });
      }
    }
  }
  return out;
}

/**
 * Completeness gate (AC#3): refuse `write_tep status: implemented` while the TEP
 * isn't complete (some implementing Spec unaccepted). The TEP being written
 * lives in `store`, so its owning namespace is `store`'s; resolve its
 * implementing Specs and run the pure `tepComplete`, naming the open Spec(s).
 */
async function assertTepComplete(
  ctx: HandlerContext,
  store: ThinkubeStore,
  tepArg: string,
): Promise<void> {
  const tepId = normalizeTepId(tepArg);
  const targetNs = thinkingSpaceNamespace(ctx.env.thinkingSpaceRoot, store);
  const specs = await implementingSpecsOfTep(ctx, targetNs, tepId);
  const result = tepComplete(tepId, specs);
  if (!result.complete) {
    const open = result.openSpecs.length
      ? result.openSpecs.join(", ")
      : "(no implementing Spec is accepted yet)";
    throw new Error(
      `Cannot set TEP-${tepId} to "implemented": it is not complete. ` +
        `An "implemented" (delivered) TEP requires every implementing Spec to be ` +
        `accepted; still open: ${open}. Accept the open Spec(s) first, then retry.`,
    );
  }
}

/**
 * `promote_tep` (SP-tgvpbm) — move a repo TEP into an existing project's `teps/`
 * (making it an umbrella TEP) and rewrite **every** dependent spec's
 * `implements:` to the qualified umbrella ref, so all former implementers stay
 * members and no bare/dangling ref to the moved TEP remains. Targets an existing
 * project; refuses otherwise. Returns the moved path + the rewritten spec handles.
 */
export async function promoteTep(
  ctx: HandlerContext,
  tepArg: string,
  product: string,
  projectId: string,
): Promise<unknown> {
  const thinkingSpaceRoot = ctx.env.thinkingSpaceRoot;
  if (!thinkingSpaceRoot) throw new Error("No thinking space root configured.");
  const tepId = normalizeTepId(tepArg);
  const project = discoverProjects(thinkingSpaceRoot).find(
    (p) => p.product === product && p.id === projectId,
  );
  if (!project) {
    throw new Error(
      `No project "${product}/${projectId}" — create it first (New Project).`,
    );
  }
  const projectNamespace = `${product}/projects/${projectId}`;
  const thinkingSpaces = ctx.thinkingSpaces
    .list(true)
    .filter((b) => !b.worktree);

  // Locate the TEP's origin thinking space (the repo whose teps/ holds TEP-{id}).
  let origin:
    | { thinkingSpaceDir: string; namespace: string; tepDirRel: string }
    | undefined;
  for (const b of thinkingSpaces) {
    const store = ctx.thinkingSpaces.resolve(b.id);
    if ((await store.listTeps()).some((t) => normalizeTepId(t.id) === tepId)) {
      origin = {
        thinkingSpaceDir: store.thinkubeDir,
        namespace: namespaceOfThinkingSpaceDir(
          thinkingSpaceRoot,
          store.thinkubeDir,
        ),
        // Org-scoped tree (TEP-th8lzj): a TEP is the dir `<org>/teps/TEP-n/`
        // (its `SP-m` specs nested inside), not a flat `teps/TEP-n.md`.
        tepDirRel: path.dirname(store.pathForTep(tepId)),
      };
      break;
    }
  }
  if (!origin)
    throw new Error(`TEP-${tepId} not found in any repo thinking space.`);
  if (origin.namespace === projectNamespace) {
    throw new Error(`TEP-${tepId} is already under ${projectNamespace}.`);
  }

  // RE-ID into the project's scope. The org-scoped sequential scheme makes a
  // TEP's number unique only within a (thinking space, org) scope, so a project keeps its
  // OWN TEP sequence — preserving the origin number would collide with the
  // project's existing TEP-{n} (or leave its numbering non-contiguous). Allocate
  // the project's next free number and resolve the destination through the
  // project's OWN store, so the TEP lands under whatever `teps` root the project
  // actually uses (`<org>/teps` for a migrated project, bare `teps` for a fresh
  // one) — NOT a hardcoded bare `teps`, which would be invisible to a project
  // whose other TEPs live under `<org>/teps`.
  const projectDir = path.join(
    thinkingSpaceRoot,
    product,
    "projects",
    projectId,
  );
  const projectStore = new ThinkubeStore(projectDir, projectDir);
  const newId = await projectStore.nextTepId();
  const movedTepRel = projectStore.pathForTep(newId); // org-aware, BEFORE the move
  const destTepDirRel = path.dirname(movedTepRel);

  // Move the TEP's whole nested dir (`<org>/teps/TEP-old/` — tep.md + its SP-m
  // specs) into the project under the re-allocated number. Slice handles derive
  // from the PATH, so the nested spec/slice handles re-id with the moved dir —
  // only the link layer needs rewiring.
  const src = path.join(origin.thinkingSpaceDir, origin.tepDirRel);
  const dest = path.join(projectDir, destTepDirRel);
  fsSync.mkdirSync(path.dirname(dest), { recursive: true });
  fsSync.renameSync(src, dest);

  // Keep the moved TEP's own frontmatter id in sync with its new dir number.
  const movedDoc = await projectStore.getFile(movedTepRel);
  if (movedDoc) {
    await projectStore.writeFile(
      movedTepRel,
      { ...movedDoc.frontmatter, id: `TEP-${newId}` },
      movedDoc.body,
    );
  }

  // Sweep every thinking space's specs; rewrite each dependent's implements: to the
  // qualified umbrella ref at the NEW id (matched by the OLD one).
  const rewritten: string[] = [];
  for (const b of thinkingSpaces) {
    const store = ctx.thinkingSpaces.resolve(b.id);
    const specNs = namespaceOfThinkingSpaceDir(
      thinkingSpaceRoot,
      store.thinkubeDir,
    );
    for (const spec of await store.listSpecDirs()) {
      const rel = store.pathForSpecDoc(spec);
      const parsed = await store.getFile(rel);
      const fm = parsed?.frontmatter;
      const next = rewriteImplementsForPromote(
        specNs,
        typeof fm?.implements === "string" ? fm.implements : undefined,
        origin.namespace,
        tepId,
        projectNamespace,
        newId,
      );
      if (next && parsed) {
        await store.writeFile(
          rel,
          { ...(fm ?? {}), implements: next },
          parsed.body,
        );
        rewritten.push(specHandle(spec));
      }
    }
  }

  return {
    ok: true,
    tep: `TEP-${newId}`,
    fromTep: `TEP-${tepId}`,
    movedTo: `${projectNamespace}/${destTepDirRel}`,
    rewritten,
  };
}

/** Parse a slice handle (`SP-3_SL-42`) → its (spec, slice) numbers. */
function parseSliceHandle(handle: string): {
  specNumber: string;
  sliceNumber: number;
} {
  const m = SLICE_HANDLE_RE.exec(handle.trim());
  if (!m) {
    throw new Error(
      `Invalid slice handle "${handle}" — expected the form TEP-{n}_SP-{m}_SL-{k}.`,
    );
  }
  return { specNumber: specIdFromMatch(m), sliceNumber: Number(m[3]) };
}

/**
 * Card title = the slice body's first non-empty line (heading marker
 * stripped), clipped for display — legacy one-paragraph slices otherwise
 * leak a whole paragraph into the title. The file keeps the full text.
 */
function sliceTitle(body: string | undefined, fallback: string): string {
  if (!body) return fallback;
  for (const line of body.split(/\r?\n/)) {
    const t = line.replace(/^#+\s*/, "").trim();
    if (t) {
      if (t.length <= 80) return t;
      const cut = t.slice(0, 80);
      const at = cut.lastIndexOf(" ");
      return `${at > 40 ? cut.slice(0, at) : cut}…`;
    }
  }
  return fallback;
}

/**
 * Project the committed slice files into the Tandem thinking space. Mirrors
 * `ThinkubeFilesAdapter.load()`'s read loop (we don't instantiate the adapter —
 * it builds a vscode EventEmitter, and this subprocess only has a vscode stub).
 */
export async function listThinkingSpace(
  store: ThinkubeStore,
): Promise<unknown> {
  // Per-Spec requirement-hash, computed once per Spec (specs are few).
  const reqHashBySpec = new Map<string, string>();
  const specMeta = new Map<string, SpecMeta>();
  for (const specId of await store.listSpecDirs()) {
    const doc = await store.getFile(store.pathForSpecDoc(specId));
    const key = specHandle(specId); // TEP-n_SP-m, matches the projection's specKey
    if (doc?.body) reqHashBySpec.set(key, requirementHash(doc.body));
    specMeta.set(key, deriveSpecMeta(doc?.frontmatter, doc?.body));
  }

  const inputs: SliceInput[] = [];
  for (const rel of await store.listSlices()) {
    const m = SLICE_PATH_RE.exec(rel);
    if (!m) continue;
    const tepNumber = Number(m[1]);
    const specNumber = m[2];
    const sliceNumber = Number(m[3]);
    const specKey = `TEP-${tepNumber}_SP-${specNumber}`;
    const parsed = await store.getFile(rel);
    const fm: Frontmatter = parsed?.frontmatter ?? {};
    inputs.push({
      specNumber,
      tepNumber,
      sliceNumber,
      title: sliceTitle(parsed?.body, `${specKey}_SL-${sliceNumber}`),
      body: parsed?.body,
      status: fm.status,
      due: fm.due,
      priority: fm.priority,
      stampedReqHash: fm.verified_req_hash,
      currentReqHash: reqHashBySpec.get(specKey),
      tags: effectiveTags(fm),
    });
  }

  // Scope = the thinking space's canonical id, so cross-thinking space output is unambiguous.
  const scope = thinkingSpaceId(store.workspaceRoot);
  const thinkingSpace = buildSliceThinkingSpace(inputs, scope, specMeta);

  const columns = thinkingSpace.columns.map((col) => ({
    id: col.id,
    title: col.title,
    cards: col.tasksIds.map((id) => {
      const card = thinkingSpace.tasks[id];
      return {
        id: card.id,
        description: card.description,
        specStale: card.specStale,
        specChange: card.specChange,
        priority: card.priority,
        due: card.dueDate,
        ...(card.tags?.length ? { tags: card.tags } : {}),
        // Close card (TEP-0010): present only on the auto-derived
        // `SP-{id}_accept` card, so a reader can tell it from a slice and know
        // the Spec's sign-off state — accepted/ready, slice progress, and how
        // many criteria are checked.
        ...(card.isAcceptance
          ? {
              isAcceptance: true,
              accepted: card.accepted,
              acceptReady: card.acceptReady,
              slicesDone: card.slicesDone,
              slicesTotal: card.slicesTotal,
              criteriaChecked: (card.acceptanceCriteria ?? []).filter(
                (c) => c.checked,
              ).length,
              criteriaTotal: (card.acceptanceCriteria ?? []).length,
            }
          : {}),
      };
    }),
  }));

  return { scope: thinkingSpace.scope, columns };
}

async function getSlice(
  store: ThinkubeStore,
  handle: string,
): Promise<unknown> {
  const { specNumber, sliceNumber } = parseSliceHandle(handle);
  const rel = store.pathForSlice(specNumber, sliceNumber);
  const parsed = await store.getFile(rel);
  if (!parsed) throw new Error(`No slice file at ${store.thinkubeDir}/${rel}`);
  return {
    handle: store.sliceHandle(specNumber, sliceNumber),
    relativePath: rel,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
  };
}

async function getThinkubeFile(
  store: ThinkubeStore,
  relativePath: string,
): Promise<unknown> {
  // Org-aware: a caller may address the org tree by a bare `teps/…` path without
  // knowing the maintainer's org segment — the store rewrites it to `<org>/teps/…`
  // (a path already carrying the org, or a non-org dir, passes through). Keeps the
  // org invisible plumbing, matching write_spec/get_slice.
  const rel = store.resolveOrgRelativePath(relativePath);
  const parsed = await store.getFile(rel);
  if (!parsed) {
    throw new Error(`No thinking space file at ${store.thinkubeDir}/${rel}`);
  }
  return { relativePath: rel, frontmatter: parsed.frontmatter, body: parsed.body };
}

async function moveSlice(
  store: ThinkubeStore,
  handle: string,
  status: string,
  opts: { docsGateMode: DocsGateMode; docsDone?: boolean; reason?: string } = {
    docsGateMode: "advisory",
  },
): Promise<unknown> {
  const target = status.trim().toLowerCase() as (typeof VALID_STATUSES)[number];
  if (!VALID_STATUSES.includes(target)) {
    throw new Error(
      `Invalid status "${status}" — expected one of Ready, Doing, Done, Requires-attention, Retired.`,
    );
  }
  const { specNumber, sliceNumber } = parseSliceHandle(handle);
  const rel = store.pathForSlice(specNumber, sliceNumber);
  const parsed = await store.getFile(rel);
  if (!parsed) throw new Error(`No slice file at ${store.thinkubeDir}/${rel}`);

  // Retire (SP-th4wqd #5): `move_slice(…, "Retired", reason)` is a TERMINAL state
  // distinct from Done — it records a REQUIRED reason and then short-circuits, so
  // none of the → Done gates (satisfies / docs / baseline stamp) run for it. The
  // "reason required" rule lives in the shared `validateRetireReason`; a missing
  // reason throws before any write. The slice file is rewritten in place (its
  // SL-{m} stays on disk → reserved for the next `max+1`) but its `retired` status
  // drops it from the active frontier.
  if (isRetiredStatus(target)) {
    const validation = validateRetireReason(opts.reason);
    if (!validation.ok) throw new Error(validation.error);
    const retiredFm: Frontmatter = {
      ...(parsed.frontmatter ?? {}),
      status: RETIRED_STATUS as Frontmatter["status"],
      reason: validation.reason,
    };
    await store.writeFile(rel, retiredFm, parsed.body);
    return {
      ok: true,
      slice: store.sliceHandle(specNumber, sliceNumber),
      status: RETIRED_STATUS,
      reason: validation.reason,
      retired: true,
    };
  }

  // SP-6/7 AC7: reopening a slice of an ACCEPTED Spec must clear the Spec's `accepted:` stamp — a
  // Spec whose delivered work is being reworked is no longer accepted. Detect the OFF-Done move (the
  // slice was Done, the target is anything else) here, before the frontmatter is mutated below.
  const wasDone =
    String(parsed.frontmatter?.status ?? "").toLowerCase() === "done";
  const movingOffDone = wasDone && target !== "done";

  const fm: Frontmatter = { ...(parsed.frontmatter ?? {}), status: target };
  // Attest the documentation obligation (TEP-tgh6iy): a caller updating the doc
  // module in this slice passes docs_done so the gate below is satisfied.
  if (opts.docsDone === true) fm.docs_done = true;

  let baselineStamped = false;
  let gateSkipped: string | undefined;
  let docsWarning: string | undefined;
  if (target === "done") {
    // Read the parent Spec once — both the → Done gate and the baseline stamp
    // need its body. A read failure leaves `specBody` undefined; the gate then
    // sees zero criteria and refuses any slice that claims to satisfy one
    // (fail-closed for integrity), while ungated legacy slices still pass.
    let specBody: string | undefined;
    try {
      const doc = await store.getFile(store.pathForSpecDoc(specNumber));
      specBody = doc?.body;
    } catch (err) {
      process.stderr.write(
        `[thinkube-mcp] move_slice: reading parent Spec for ${handle} failed: ${(err as Error).message}\n`,
      );
    }

    // → Done gate (SP-6, mechanical half): the slice may enter Done only once
    // every AC it claims to satisfy is checked on the parent Spec. On refusal
    // we throw BEFORE any write — nothing is mutated and the error names the
    // offending criterion.
    const gate = gateSliceSatisfiesToDone({
      specBody,
      satisfies: parsed.frontmatter?.satisfies,
    });
    if (!gate.ok) throw new Error(gate.reason);
    gateSkipped = gate.gateSkipped;

    // → Done docs gate (TEP-tgh6iy): a `docs: required` slice must have its docs
    // done. Blocking mode refuses (throws before any write); advisory mode lets
    // the move through but returns a warning to surface in /pair-next.
    const docsGate = gateSliceDocsToDone({
      docs: typeof fm.docs === "string" ? fm.docs : undefined,
      docsDone: fm.docs_done === true,
      mode: opts.docsGateMode,
    });
    if (!docsGate.ok) throw new Error(docsGate.reason);
    docsWarning = docsGate.warning;

    // Stamp the verification baseline so a later requirement edit re-flags this
    // slice stale. Best-effort — never fail the (already-gated) move on a
    // hashing error.
    if (specBody) {
      try {
        fm.verified_req_hash = requirementHash(specBody);
        baselineStamped = true;
      } catch (err) {
        process.stderr.write(
          `[thinkube-mcp] move_slice: baseline stamp for ${handle} failed: ${(err as Error).message}\n`,
        );
      }
    }
    // Record delivery provenance (branch HEAD commit + open PR) at Done time.
    // Best-effort and isolated from the baseline stamp above — a git/gh failure
    // here must never block the move.
    try {
      await stampOnEnteringDone(fm, store.workspaceRoot);
    } catch (err) {
      process.stderr.write(
        `[thinkube-mcp] move_slice: provenance stamp for ${handle} failed: ${(err as Error).message}\n`,
      );
    }
  }

  await store.writeFile(rel, fm, parsed.body);

  // SP-6/7 AC7: clear the parent Spec's `accepted:` stamp when this slice moved OFF Done. An accepted
  // Spec whose slice is being reworked/reopened is no longer accepted — leaving the stamp would let the
  // Spec's PR merge on stale sign-off. Best-effort + idempotent: no stamp / a read failure is a no-op,
  // and only the `accepted` key is removed (every other frontmatter field + the body is preserved).
  let acceptanceCleared = false;
  if (movingOffDone) {
    try {
      const specRel = store.pathForSpecDoc(specNumber);
      const specDoc = await store.getFile(specRel);
      if (specDoc?.frontmatter && "accepted" in specDoc.frontmatter) {
        const { accepted: _dropped, ...rest } = specDoc.frontmatter as Record<
          string,
          unknown
        >;
        await store.writeFile(specRel, rest as Frontmatter, specDoc.body);
        acceptanceCleared = true;
      }
    } catch (err) {
      process.stderr.write(
        `[thinkube-mcp] move_slice: clearing accepted stamp for ${handle} failed: ${(err as Error).message}\n`,
      );
    }
  }

  return {
    ok: true,
    slice: store.sliceHandle(specNumber, sliceNumber),
    status: target,
    baselineStamped,
    ...(gateSkipped ? { gateSkipped } : {}),
    ...(docsWarning ? { docsWarning } : {}),
    ...(acceptanceCleared ? { acceptanceCleared } : {}),
  };
}

/**
 * Record the human acceptance of a Spec — TEP-0010's single end-of-Spec gate.
 * Refuses unless every slice under the Spec is Done and every acceptance
 * criterion is checked; on success stamps `accepted:` on the Spec doc so the
 * acceptance card may enter Done and the Spec's PR merge.
 */
async function acceptSpec(
  store: ThinkubeStore,
  spec: string,
): Promise<unknown> {
  const specRel = store.pathForSpecDoc(spec);
  const specDoc = await store.getFile(specRel);
  if (!specDoc) {
    throw new Error(`No spec at ${specRel} — nothing to accept.`);
  }
  const sliceStatuses: string[] = [];
  for (const rel of await store.listSlices(spec)) {
    const parsed = await store.getFile(rel);
    sliceStatuses.push(String(parsed?.frontmatter?.status ?? ""));
  }
  const gate = gateSpecAcceptance({ specBody: specDoc.body, sliceStatuses });
  if (!gate.ok) throw new Error(gate.reason);
  const accepted = new Date().toISOString();
  await store.writeFile(
    specRel,
    { ...specDoc.frontmatter, accepted },
    specDoc.body,
  );
  return { ok: true, spec, accepted };
}

/** Card-title character limit for `create_slice` (detail belongs in the body). */
const TITLE_MAX = 70;

/**
 * Create a slice in the canonical shape (SP-4): server-allocated per-Spec
 * number (archive-aware), slug uid, frontmatter + `# title` + detail body.
 * The → Ready gate is enforced at creation time: the parent Spec must exist
 * with a non-empty `## Acceptance Criteria`.
 */
/**
 * Resolve a `spec` arg to the composite `<tep>/<sp>` id the org tree is keyed by.
 * SP numbers are PER-TEP (SP-3 can exist under several TEPs), so a bare number is
 * resolved against `listSpecDirs()`: a unique match is used; an ambiguous one is
 * refused naming the candidate TEPs; an unknown bare id is returned verbatim so
 * the caller reports the real not-found path. An id that already carries a `/`
 * (composite or opaque) passes through untouched. This keeps `/slice`'s `spec: {n}`
 * shape working without ever silently resolving to the wrong — or a phantom — spec.
 */
export async function resolveCompositeSpecId(
  listSpecDirs: () => Promise<string[]>,
  id: string,
): Promise<string> {
  if (id.includes("/")) return id;
  const matches = (await listSpecDirs()).filter((s) => s.split("/")[1] === id);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous spec id "${id}" — SP-${id} exists under ${matches
        .map((m) => "TEP-" + m.split("/")[0])
        .join(", ")}. Pass the composite \`<tep>/${id}\` (e.g. \`${matches[0]}\`).`,
    );
  }
  return id;
}

export async function createSlice(
  store: ThinkubeStore,
  args: {
    spec: string;
    title: string;
    body: string;
    depends_on?: string[];
    parallel?: boolean;
    parallel_group?: string;
    files?: string[];
    satisfies?: number[];
    contract?: string;
    work_units?: {
      footprint: string[];
      depends_on?: string[];
      // Contract-first reference: files a sibling unit produces that this unit reads
      // (satisfies the gate + resolves to a dependency edge; authorable without a node-id).
      consumes?: string[];
      // Declared read set (SP-6/2): files this unit reads but does not produce. The
      // undeclared-cross-unit-read gate audits these against sibling productions.
      reads?: string[];
      execution: string;
      // Independent-verification role (SP-6/7): `code` (default) or `test` (the held-out verifier).
      role?: string;
      note?: string;
      // Contract-first opt-out (SP-th4wqi). The authoritative field name is the
      // shared `CONTRACT_FIRST_OPTOUT_FIELD` constant (the schema key + what
      // `contractFirstCheck` reads); this literal is the local TS view of it.
      contract_first_optout?: boolean;
    }[];
    priority?: string;
    docs?: string;
    docs_reason?: string;
    tags?: string[];
  },
  /**
   * SP-6/1 (TEP-6) provenance: the server signing secret (loaded from globalStorage by `main`,
   * held only by the server process, never seen by the agent). When supplied, the → Ready gate
   * enforces the `ac_verifications` provenance **signature** — `readyGate` trusts the server HMAC
   * over `(acRequirementHash, ac_verifications)`, not the reproducible hash — so a Spec whose
   * `write_spec` audit never ran (no signature) or whose ACs were edited after signing (invalid
   * signature) is refused, naming the missing/invalid provenance. Absent ⇒ legacy hash-only path.
   */
  signingSecret?: Buffer,
): Promise<unknown> {
  const title = args.title.trim();
  if (!title) throw new Error("title must not be empty.");
  if (title.length > TITLE_MAX) {
    throw new Error(
      `Title is ${title.length} chars — the limit is ${TITLE_MAX}. Title the concrete capability; detail belongs in the body.`,
    );
  }
  if (args.priority !== undefined && !/^P[0-3]$/.test(args.priority)) {
    throw new Error(`Invalid priority "${args.priority}" — expected P0…P3.`);
  }
  // `depends_on` is removed (SP-5/1): an authored, ungrounded dependency is no longer
  // accepted — refuse it at the door rather than silently drop an author's intent, and
  // name `consumes` as the grounded replacement. A slice's cross-slice dependency is
  // always a genuine artifact read, so express it as a unit `consumes`: the file(s) a
  // sibling unit produces that this slice's units read, which `buildUnitDag` resolves
  // into a real edge on the producing unit.
  if (args.depends_on?.length) {
    throw new Error(
      `Slice-level \`depends_on\` is no longer accepted (it was ungrounded — not an ` +
        `artifact a unit reads). Re-express the dependency as \`consumes\`: on the work_unit ` +
        `that reads it, list the file(s) a sibling unit produces; \`buildUnitDag\` resolves a ` +
        `real edge to that producing unit. (offending depends_on: ${args.depends_on.join(", ")})`,
    );
  }
  for (const n of args.satisfies ?? []) {
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(
        `satisfies entry "${n}" is not a positive integer (a 1-based AC ordinal).`,
      );
    }
  }
  for (const wu of args.work_units ?? []) {
    if (!Array.isArray(wu?.footprint) || wu.footprint.length === 0) {
      throw new Error(
        "each work_unit needs a non-empty `footprint` (the files/objects it touches).",
      );
    }
    if (!["serial", "mechanize", "fan-out"].includes(wu.execution)) {
      throw new Error(
        `work_unit execution "${wu.execution}" must be serial | mechanize | fan-out.`,
      );
    }
    // A work_unit `depends_on` is removed (SP-5/1): it was ungrounded (not a produced/
    // consumed artifact) AND unauthorable at create time (the slice has no number, so its
    // units have no `#eu-k` node-ids yet — the exact `#27` problem `consumes` solved).
    // Refuse it, naming `consumes` as the grounded replacement: name the file(s) a sibling
    // unit produces that this unit reads, and `buildUnitDag` resolves a real dependency edge
    // to the producing unit (multi-writer → all producers).
    if (wu.depends_on?.length) {
      throw new Error(
        `work_unit \`depends_on\` is no longer accepted (it was ungrounded and unauthorable ` +
          `before the slice has a number). Replace it with \`consumes\`: name the file(s) a ` +
          `SIBLING unit produces that this unit reads — a file, not a node-id — and the DAG ` +
          `resolves a real edge to that producer. (offending depends_on: ${wu.depends_on.join(", ")})`,
      );
    }
  }

  // Preliminary-control gate (SP-th1ddy_SL-2): a slice's declared footprint must
  // resolve **repo-relative inside the thinking space's own repo**. An absolute path, a
  // `..`-escaping path, or a different-repo path is structurally invalid — the
  // orchestrated worker runs from the thinking space repo's worktree root and could never
  // legally write it, so the slice would fail orchestration *after* a run is
  // burned. Refuse it at creation, naming the offending path. Both `files:` and
  // every work_unit `footprint` are footprints, so both are checked.
  const declaredFiles = [
    ...(args.files ?? []),
    ...(args.work_units ?? []).flatMap((wu) => wu.footprint ?? []),
  ];
  if (declaredFiles.length) {
    const repoCheck = sliceFilesResolveInRepo(
      store.workspaceRoot,
      declaredFiles,
    );
    if (!repoCheck.ok) throw new Error(repoCheck.reason);
  }

  // Documentation obligation (TEP-tgh6iy). Default `required` (fail closed);
  // `n/a` must justify. The rule lives in the methodology gates module.
  const docsResult = resolveDocsObligation({
    docs: args.docs,
    docs_reason: args.docs_reason,
  });
  if (!docsResult.ok) throw new Error(docsResult.reason);

  // Creation-time → Ready gate (TEP-tgzx3p, opening half): the parent Spec must
  // be present, carry acceptance criteria, and certify EVERY AC with a runnable
  // `ac_verifications` entry. The structural check lives in the pure `readyGate`;
  // the LLM auditor's verifiable | needs-reframe judgment runs in /spec-prepare,
  // which only emits a declaration for an AC it certifies, so an un-certified AC
  // arrives here with no entry and `readyGate` blocks it by ordinal.
  // Resolve a bare SP number (`3`, the shape `/slice`'s `spec: {n}` carries) to the
  // composite `<tep>/<sp>` id the org tree is keyed by. SP numbers are PER-TEP —
  // SP-3 can exist under several TEPs — so a bare id is resolved against the tree:
  // a unique match is used; an ambiguous one is refused naming the candidate TEPs.
  // (Without this the bare id fell through `pathForSpecDoc("3")` → `TEP-3/SP-undefined`
  // and then reported a MISLEADING legacy `specs/SP-3/spec.md` path for a spec that
  // exists under its TEP — silent misdirection instead of an actionable id error.)
  args.spec = await resolveCompositeSpecId(() => store.listSpecDirs(), args.spec);
  const specDoc = await store.getFile(store.pathForSpecDoc(args.spec));
  if (!specDoc) {
    throw new Error(
      `No spec at ${store.thinkubeDir}/${store.pathForSpecDoc(args.spec)} — run /spec-prepare ${args.spec} first.`,
    );
  }
  const acs = acceptanceCriteriaOrdinals(specDoc.body);
  if (acs.length === 0) {
    throw new Error(
      `SP-${args.spec} has no acceptance criteria (its slices would fail the → Ready gate) — run /spec-prepare ${args.spec} first.`,
    );
  }
  // Reuse the closing gate's serialization (`normalizeAcVerifications`) so the
  // map the gate reads is exactly the one the closing gate's `parseAcVerifications`
  // consumes — one serialization, both ends (TEP-tgzx3p).
  const rawVerifs = specDoc.frontmatter?.ac_verifications;
  const verifications = normalizeAcVerifications(
    rawVerifs && typeof rawVerifs === "object"
      ? (rawVerifs as Record<string, unknown>)
      : {},
  );
  // Re-audit baseline (SP-th4wqf_SL-3 / TEP-th3i18 #2): the `ac_verifications`
  // certification is keyed to a hash of the Spec's *Acceptance Criteria block*,
  // stamped under `AC_CERT_HASH_KEY` when /spec-prepare certifies (write_spec with
  // `ac_verifications`). Feed `readyGate` the Spec's CURRENT AC-block hash and the
  // stamped one: if the ACs were edited since certification (via a body-only
  // write_spec or a patch_spec_section of the AC section), the two diverge and the
  // structurally-complete map is still refused as `stale-certification` — re-cert
  // required. No stamp (a Spec certified before re-audit shipped) ⇒ never stale.
  // Provenance signature (SP-6/1 / TEP-6): when the server holds a signing
  // secret, signature enforcement is ON — `readyGate` verifies the server HMAC
  // over `(acRequirementHash, ac_verifications)` (stamped by `write_spec`'s own
  // audit under `AC_SIGNATURE_KEY`) instead of trusting the reproducible hash.
  // The agent can recompute `acRequirementHash` but can never produce this
  // signature (the secret never leaves the server), so a Spec whose auditor was
  // skipped — its `ac_verifications` hand-supplied with no signature, or signed
  // and then AC-edited — is refused below. No secret ⇒ the legacy hash-only
  // stale check still applies (forward-compatible).
  const certification = {
    currentHash: acRequirementHash(specDoc.body),
    stampedHash: specDoc.frontmatter?.[AC_CERT_HASH_KEY],
    ...(signingSecret !== undefined
      ? {
          secret: signingSecret,
          signature: specDoc.frontmatter?.[AC_SIGNATURE_KEY],
        }
      : {}),
  };
  // `readyGate` (SP-6/7) accepts an `env: "assessment"` entry as certified even though it carries no
  // runnable `run` — such an AC is graded by the closing gate's independent assessor, not this gate.
  const readyVerdict = readyGate(
    acs,
    verifications as Record<
      string,
      { run?: string; env?: "cluster" | "local" | "assessment" }
    >,
    certification,
  );
  if (!readyVerdict.ok) {
    // Structural block — an AC with no runnable declaration — names the ordinal.
    if ("ordinal" in readyVerdict) {
      throw new Error(
        `SP-${args.spec} AC ${readyVerdict.ordinal} has no runnable ac_verifications entry — every AC must be certified with a verification before → Ready. Run /spec-prepare ${args.spec} to certify each AC.`,
      );
    }
    // Provenance / staleness blocks (discriminated by `reason`). Each names the
    // missing or invalid provenance so skipping the auditor blocks slicing with a
    // clear, actionable error (SP-6/1, AC3).
    switch (readyVerdict.reason) {
      case "missing-signature":
        throw new Error(
          `SP-${args.spec}'s ac_verifications carry no provenance signature (\`${AC_SIGNATURE_KEY}\`) — the verifiability auditor was skipped and the map hand-supplied, which the → Ready gate refuses. Run /spec-prepare ${args.spec} so write_spec runs the audit and signs the result before → Ready.`,
        );
      case "invalid-signature":
        throw new Error(
          `SP-${args.spec}'s ac_verifications provenance signature (\`${AC_SIGNATURE_KEY}\`) is invalid — it does not verify under the server secret (forged, tampered, signed elsewhere, or the acceptance criteria were edited after signing). Recomputing the ac_verifications_hash does not satisfy the gate. Run /spec-prepare ${args.spec} to re-audit and re-sign before → Ready.`,
        );
      case "stale-certification":
        throw new Error(
          `SP-${args.spec}'s acceptance-criteria certification is stale — the ACs changed since they were certified. Run /spec-prepare ${args.spec} to re-certify each AC before → Ready.`,
        );
    }
  }

  // Runnable-verification precheck (SP-th4wqf_SL-1 / TEP-th3i18 #8). A *declared*
  // ac_verifications command is not yet a *runnable* one: a check like
  // `node --test out-test/mcp/foo.test.js` only runs if its source
  // (`src/mcp/foo.test.ts`) is registered in `tsconfig.test.json`'s `include`. An
  // unregistered source compiles to nothing, so `node --test` never finds it and
  // the AC reports ✓ over a check that never executed — the silent-green hole this
  // precheck closes. The structural readyGate above guarantees every AC now has a
  // declaration; here we prove each one can actually run.
  //
  // The shared predicate (`verificationRunnable`) is single-sourced; THIS handler
  // owns computing `repoState` from the repo's real `tsconfig.test.json` (the same
  // `include` the `npm test` toolchain compiles — SP-th1ddy reuse rule). That
  // wiring, not the predicate, is the load-bearing part (AC1).
  const repoState = repoStateForRunnableCheck(store.workspaceRoot);
  if (repoState) {
    for (const [ordinal, decl] of Object.entries(verifications)) {
      const verdict = verificationRunnable(decl, repoState);
      if (!verdict.ok) {
        throw new Error(
          `SP-${args.spec} AC ${ordinal}'s verification is not runnable — ${verdict.unrunnable}`,
        );
      }
    }
  }

  // Parallel-group disjointness (SP-tgpwbm AC1): a slice joining a
  // `parallel_group` must not claim a file already owned by a sibling in that
  // group. Validate the would-be set against existing siblings before writing.
  const group = args.parallel_group?.trim();
  if (group && (args.files?.length || args.work_units?.length)) {
    const siblings: ParallelSliceInput[] = [];
    for (const rel of await store.listSlices(args.spec)) {
      const m = SLICE_PATH_RE.exec(rel);
      if (!m) continue;
      const parsed = await store.getFile(rel);
      const sfm: Frontmatter = parsed?.frontmatter ?? {};
      siblings.push({
        handle: sliceHandleFromMatch(m),
        parallelGroup: sfm.parallel_group,
        files: sfm.files,
        workUnits: sfm.work_units,
      });
    }
    const result = validateParallelGroup([
      ...siblings,
      {
        handle: `${specHandle(args.spec)}_SL-(new)`,
        parallelGroup: group,
        files: args.files,
        workUnits: args.work_units,
      },
    ]);
    if (!result.ok) throw new Error(result.reason);
  }

  // Authoring-time DAG gate (TEP-th3i18 #17): build the Spec's work-unit DAG —
  // this new slice plus its siblings — and reject a malformed graph (a dangling
  // dependency or a cycle) **at creation**, not when a run is dispatched and
  // burned. `buildUnitDag` sources every edge from `consumes`+footprint over the
  // GLOBAL set of the Spec's units (SP-5/1), so the gate routes via `consumes`
  // only — no authored `depends_on` is consulted. The new slice's handle is a
  // placeholder (nothing depends on it yet — it can't be a dep target).
  {
    const dagSlices: SliceForDag[] = [];
    for (const rel of await store.listSlices(args.spec)) {
      const m = SLICE_PATH_RE.exec(rel);
      if (!m) continue;
      const sfm: Frontmatter = (await store.getFile(rel))?.frontmatter ?? {};
      dagSlices.push({
        handle: sliceHandleFromMatch(m),
        status: String(sfm.status ?? "ready"),
        files: Array.isArray(sfm.files) ? (sfm.files as string[]) : [],
        workUnits: Array.isArray(sfm.work_units)
          ? (sfm.work_units as SliceForDag["workUnits"])
          : [],
        satisfies: Array.isArray(sfm.satisfies)
          ? (sfm.satisfies as number[])
          : [],
      });
    }
    dagSlices.push({
      handle: `${specHandle(args.spec)}_SL-new`,
      status: "ready",
      files: args.files ?? [],
      workUnits: (args.work_units ?? []) as SliceForDag["workUnits"],
      satisfies: args.satisfies ?? [],
    });
    const dagVerdict = validateDag(
      buildUnitDag(dagSlices).map((u) => ({
        id: u.id,
        requires: u.requires,
      })),
    );
    if (!dagVerdict.ok) {
      throw new Error(
        `Work-unit DAG is malformed — refusing to create the slice:\n${dagVerdict.reason}\n` +
          `(Edges come from \`consumes\`+footprint — a unit depends on whoever produces the files it consumes; see the methodology work-units model.)`,
      );
    }
  }

  // Required design-time contract (SP-6/3). A multi-unit slice MUST declare a `contract` — the
  // shared interface (exact exports, types, signatures, behaviour) every unit, code AND held-out
  // test, builds against. It is injected into every worker prompt so parallel units agree on the
  // seam up front; that SUPERSEDES the old contract-first coordination gate (units no longer point
  // `consumes` at a sibling's seam — they build to the contract). There is deliberately NO
  // no-contract fallback path: a legacy slice without one is re-sliced, not patched.
  const unitCount = (args.work_units ?? []).length;
  if (unitCount > 1 && (args.contract ?? "").trim().length === 0) {
    throw new Error(
      `A multi-unit slice must declare a \`contract\` — the shared interface (exact exports, ` +
        `types, signatures, behaviour) every work unit builds against. Without it, the ${unitCount} ` +
        `parallel units (and the held-out test) each invent the seam and diverge. Write the ` +
        `interface in \`contract\` (~10–20 lines); with it, units need \`consumes\` only for a ` +
        `genuine produced-artifact dependency, never for interface agreement.`,
    );
  }

  // Consumes-resolvability gate (SP-th4wqk AC#2), resolved GLOBALLY over the Spec's
  // units — every slice's work_units, not just this slice's — exactly like the
  // `buildUnitDag` gate above it (SP-5/1). The work-unit DAG is the Spec-wide
  // scheduling graph and the slice is only a validation envelope, NEVER a
  // scheduling boundary: a `consumes` naming a file produced by ANOTHER slice's
  // unit is a normal cross-slice edge, not an error. Only a `consumes` that no
  // unit ANYWHERE in the Spec produces (a typo/stale path) silently resolves to no
  // edge — refuse THAT at the door. File matching reuses `normalizeFilePath`, the
  // same normalization `buildUnitDag` uses, so a real producer passes by the
  // identical rule.
  {
    const newWus = (args.work_units ?? []) as {
      footprint?: string[];
      consumes?: string[];
    }[];
    // The Spec's full unit set: every already-created slice's units + this new
    // slice's. `u !== w` (object identity) excludes only the consuming unit itself,
    // so a unit never satisfies its own `consumes`.
    const allUnits: { footprint?: string[]; consumes?: string[] }[] = [];
    for (const rel of await store.listSlices(args.spec)) {
      const sfm = (await store.getFile(rel))?.frontmatter ?? {};
      if (Array.isArray(sfm.work_units)) {
        allUnits.push(
          ...(sfm.work_units as { footprint?: string[]; consumes?: string[] }[]),
        );
      }
    }
    allUnits.push(...newWus);
    for (const w of newWus) {
      for (const c of w.consumes ?? []) {
        const cn = normalizeFilePath(c);
        const producedByOther = allUnits.some(
          (u) =>
            u !== w &&
            (u.footprint ?? []).some((f) => normalizeFilePath(f) === cn),
        );
        if (!producedByOther) {
          const fp = w.footprint?.join(", ") || "(no footprint)";
          throw new Error(
            `Dangling \`consumes\` — refusing to create the slice: unit [${fp}] ` +
              `consumes \`${c}\`, but no work_unit anywhere in this Spec (any slice) ` +
              `produces that file. \`consumes\` resolves GLOBALLY across the Spec's ` +
              `units — a cross-slice consumes is fine (the slice is only a validation ` +
              `envelope) — so check the path is exact; else drop it (it would be a ` +
              `silent no-op edge).`,
          );
        }
      }
    }
  }

  // Undeclared cross-unit read gate (SP-6/2 AC2). The consumes-resolvability gate
  // above proves every declared `consumes` resolves to a real producer; this one
  // proves the inverse for declared `reads`: a unit that `reads:` a file a SIBLING
  // unit produces must also `consumes:` it, or the scheduler sees no edge and may
  // dispatch the reader before its producer has landed (the prose-note dependency
  // that caused the SL-1/SL-2 stub-and-`rm` deletion). The pure check + its teaching
  // message live in parallelSlices.ts and are never restated here — the verdict
  // carries the rule plus each offending file and its producing unit, so a reworded
  // rule can't drift between check and refusal. A read of a file no sibling produces
  // is a pre-existing file and passes — the gate fences only cross-unit reads.
  {
    const readsVerdict = undeclaredReadsCheck(
      (args.work_units ?? []) as ContractFirstWorkUnit[],
    );
    if (!readsVerdict.ok) {
      throw new Error(`Refusing to create the slice:\n${readsVerdict.message}`);
    }
  }

  const sliceNumber = await store.nextSliceNumber(args.spec);
  const uid = await uniqueSlug(store, args.spec, title);
  const fm: Frontmatter = {
    uid,
    parent: `SP-${args.spec.split("/")[1] ?? args.spec}`,
    status: "ready",
  };
  if (args.parallel) fm.parallel = true;
  if (group) fm.parallel_group = group;
  if (args.files?.length) fm.files = args.files;
  if (args.tags?.length) fm.tags = args.tags;
  // Stamp an empty `assignee` slot the ownership arbiter later claims (SP-tgpwbm).
  fm.assignee = "";
  if (args.satisfies?.length)
    fm.satisfies = [...new Set(args.satisfies)].sort((a, b) => a - b);
  if (args.contract?.trim()) fm.contract = args.contract.trim();
  if (args.work_units?.length)
    fm.work_units = args.work_units as Frontmatter["work_units"];
  fm.docs = docsResult.value.docs;
  if (docsResult.value.docs_reason)
    fm.docs_reason = docsResult.value.docs_reason;
  // Priority is a mandatory slice attribute (always shown on the card) — default
  // to P2 (normal) when the caller doesn't triage one explicitly.
  fm.priority = (args.priority ?? "P2") as Frontmatter["priority"];

  const rel = store.pathForSlice(args.spec, sliceNumber);
  await store.writeFile(rel, fm, `# ${title}\n\n${args.body.trim()}\n`);
  return {
    ok: true,
    slice: store.sliceHandle(args.spec, sliceNumber),
    relativePath: rel,
    uid,
  };
}

/**
 * The Spec's acceptance criteria as 1-based ordinals — one entry per checklist
 * line in the `## Acceptance Criteria` section, in document order. Empty when the
 * section is absent or has no checklist lines. Feeds `readyGate`, which demands a
 * runnable `ac_verifications` entry for every ordinal `1..N`.
 */
function acceptanceCriteriaOrdinals(
  body: string | undefined,
): { ordinal: number }[] {
  if (!body) return [];
  const m = /##\s*Acceptance Criteria\s*\n([\s\S]*?)(?=\n##\s|$)/i.exec(body);
  if (!m) return [];
  const count = m[1]
    .split(/\r?\n/)
    .filter((line) => /^\s*[-*]\s*\[[ xX]\]/.test(line)).length;
  return Array.from({ length: count }, (_, i) => ({ ordinal: i + 1 }));
}

/**
 * The Spec's acceptance criteria as {@link AuditAc}s — the same 1-based checklist lines
 * {@link acceptanceCriteriaOrdinals} counts, but carrying each AC's prose so `write_spec`'s
 * server-side verifiability audit (SP-6/1) can interrogate it. The text is the checklist line with
 * its `- [ ] ` / `- [x] ` marker stripped; an empty section yields `[]` (nothing to audit → the
 * caller does not run the audit). Mirrors `acceptanceCriteriaOrdinals`' regex so ordinals agree.
 */
function acceptanceCriteriaItems(body: string | undefined): AuditAc[] {
  if (!body) return [];
  const m = /##\s*Acceptance Criteria\s*\n([\s\S]*?)(?=\n##\s|$)/i.exec(body);
  if (!m) return [];
  const out: AuditAc[] = [];
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s*[-*]\s*\[[ xX]\]\s?(.*)$/.exec(line);
    if (!item) continue;
    out.push({ ordinal: out.length + 1, text: item[1].trim() });
  }
  return out;
}

/**
 * The 1-based ordinals the audit did NOT pass as `verifiable` — for a refusal message that names
 * which ACs need reframing. An AC fails if it has no verdict, a non-`verifiable` verdict, or a
 * `verifiable` verdict with no runnable `run` (mirrors {@link computePassed}'s structural rule).
 */
function unverifiableOrdinals(
  acs: AuditAc[],
  verdicts: { ordinal: number; verdict: string; run?: string }[],
): number[] {
  const byOrdinal = new Map(verdicts.map((v) => [v.ordinal, v]));
  const flagged: number[] = [];
  for (const ac of acs) {
    const v = byOrdinal.get(ac.ordinal);
    // `assessment` (SP-6/7) is verifiable-by-assessment — a distinct pass from `verifiable`,
    // needing no runnable `run`; only a missing verdict, `needs-reframe`, or a `verifiable`
    // verdict with no command is unverifiable.
    const ok =
      v &&
      (v.verdict === "assessment" ||
        (v.verdict === "verifiable" && !!v.run?.trim()));
    if (!ok) flagged.push(ac.ordinal);
  }
  return flagged;
}

/** Slug uid from the title, unique among the Spec's existing slice uids. */
async function uniqueSlug(
  store: ThinkubeStore,
  spec: string,
  title: string,
): Promise<string> {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || `sp${spec}-slice`;
  const taken = new Set<string>();
  for (const rel of await store.listSlices(spec)) {
    const f = await store.getFile(rel);
    if (typeof f?.frontmatter?.uid === "string") taken.add(f.frontmatter.uid);
  }
  let slug = base;
  let i = 2;
  while (taken.has(slug)) slug = `${base}-${i++}`;
  return slug;
}

/**
 * Write a Spec's `specs/SP-{id}/spec.md` into the thinking space (the sidecar namespace),
 * creating it if absent. The thinking space-aware write path for `/spec-prepare` (SP-tg7jnf
 * SL-4): a raw file write resolves against the session cwd (the code repo), not
 * the thinking space, so spec authoring must go through the store like slice creation does.
 * Existing frontmatter is preserved — only the markdown body is replaced.
 */
async function writeSpec(
  store: ThinkubeStore,
  spec: string,
  body: string,
  implementsRef?: string,
  acVerifications?: Record<string, unknown>,
  repoRef?: string,
  /**
   * SP-6/1 (TEP-6) provenance context. When supplied, signing is **on**: `write_spec` runs the
   * injected verifiability audit over the Spec's ACs itself, signs only what its own audit produced
   * (HMAC over `(acRequirementHash, ac_verifications)` with the server-only `secret`), and refuses a
   * Spec whose audit fails — the agent-supplied `acVerifications` map is ignored entirely. Absent ⇒
   * legacy param path (no audit, no signature). `cwd` is the repo the headless audit runs in.
   */
  audit?: { runner: AuditRunner; secret: Buffer; cwd: string },
): Promise<unknown> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Spec body must not be empty.");
  const rel = store.pathForSpecDoc(spec);
  const existing = await store.getFile(rel);
  // Structural gate (SP-th4wqf AC2): a newly-authored Spec body must carry all
  // four canonical sections (Acceptance Criteria / Constraints / Design / File
  // Structure Plan). Refuse a create whose body is missing any of them, naming
  // the missing one so the author can fix it. Scoped to creation (no existing
  // doc) so that partial-body *updates* of an already-structured Spec are not
  // regressed. The canonical section list lives in `specStructure` — consumed
  // here, never redefined.
  if (existing === undefined) {
    const sections = specSectionsPresent(trimmed);
    if (!sections.ok) {
      throw new Error(
        `Spec body is missing the required \`## ${sections.missing}\` section. A Spec must contain all four canonical sections: Acceptance Criteria, Constraints, Design, File Structure Plan.`,
      );
    }
  }
  const fm: Frontmatter = { ...(existing?.frontmatter ?? {}) };
  // `implements:` is settable (TEP-tgvwct follow-up): a bare `TEP-<id>` or a
  // qualified `<namespace>:TEP-<id>` (umbrella). Omitted → preserved; empty → cleared.
  if (implementsRef !== undefined) {
    const v = implementsRef.trim();
    if (v) fm.implements = v;
    else delete fm.implements;
  }
  // `repo:` — the WORKING repository (a thinking space namespace) for a project-member
  // spec: the repo the orchestrator branches a worktree in, independent of where
  // the spec file is located (TEP-5 / the project-layer cutover). Omitted →
  // preserved; empty → cleared (a normal same-repo spec needs none).
  if (repoRef !== undefined) {
    const v = repoRef.trim();
    if (v) fm.repo = v;
    else delete fm.repo;
  }
  // `ac_verifications:` — the closing gate's per-AC declaration (SP-tgzyfy).
  if (audit !== undefined) {
    // ── Signing on (SP-6/1 / TEP-6): run the audit ourselves, sign only what it produced ──────
    // The agent's `acVerifications` param is *ignored* here — signing a map the agent handed in
    // would only prove the tool wrote it, not that the auditor ran. So when this Spec sets ACs we
    // spawn the (injected) verifiability audit, honor its verdict, and sign on pass; an empty AC
    // set / a failing or errored audit refuses (nothing is persisted, since we throw before the
    // write). Editing a Spec that carries no ACs leaves any existing `ac_verifications` untouched.
    const acItems = acceptanceCriteriaItems(trimmed);
    if (acItems.length > 0) {
      const result = await audit.runner({
        acs: acItems,
        specBody: trimmed,
        cwd: audit.cwd,
      });
      if (result.error) {
        throw new Error(
          `write_spec could not certify SP-${spec}'s acceptance criteria — the verifiability audit did not complete (${result.error}). The Spec was not written; re-run /spec-prepare ${spec}.`,
        );
      }
      if (!result.passed) {
        const flagged = unverifiableOrdinals(acItems, result.verdicts);
        const which = flagged.length
          ? `AC ${flagged.join(", ")} ${flagged.length === 1 ? "is" : "are"} not verifiable as written`
          : "the acceptance criteria are not all verifiable as written";
        throw new Error(
          `write_spec refused SP-${spec}: the verifiability audit failed — ${which}. Reframe each so an AI agent can prove it with a concrete command before merge, then re-run /spec-prepare ${spec}. The Spec was not written.`,
        );
      }
      // Passed: emit the canonical map from the audit's verdicts and bind a server signature over
      // `(acRequirementHash, ac_verifications)` so `readyGate` can verify provenance — the agent
      // can reproduce the hash but never this signature (the secret never leaves the server).
      // `verifiable` verdicts contribute a runnable `{ run, env }` entry; an `assessment` verdict
      // (SP-6/7) contributes an `env: "assessment"` entry with **no** `run` — it must survive into the
      // signed frontmatter so → Ready arms and the closing gate can dispatch its independent assessor
      // (dropping it here was the arming-side gap that left an all-assessment spec un-Ready-able).
      // The auditor JUDGED (verdict + env only); now AUTHOR each local verifiable AC's `run` from the
      // repo's convention — a held-out acceptance-probe recipe filled with (spec, ordinal), else the
      // whole-suite fallback. Deterministic + model-free, so it belongs to the builder, not the judge.
      const verdicts = await deriveVerificationCommands(result.verdicts, {
        cwd: audit.cwd,
        specId: spec,
      });
      const map = emitAcVerifications(verdicts);
      const acHash = acRequirementHash(trimmed);
      fm.ac_verifications = map;
      fm[AC_CERT_HASH_KEY] = acHash;
      fm[AC_SIGNATURE_KEY] = signAcVerifications(acHash, map, audit.secret);
    }
  } else if (acVerifications !== undefined) {
    // ── Signing off (legacy param path) ───────────────────────────────────────────────────────
    // Normalized to a map keyed by the AC ordinal → { run, env? }; omitted → preserved, `{}` →
    // cleared. Invalid entries (no non-empty `run`, non-positive ordinal) are dropped so a
    // malformed map can't poison the gate. Used only when no server signing secret is configured.
    const normalized = normalizeAcVerifications(acVerifications);
    if (Object.keys(normalized).length) {
      fm.ac_verifications = normalized;
      // Re-audit stamp (SP-th4wqf_SL-3): writing `ac_verifications` IS the
      // certification act, so key it to THIS body's Acceptance-Criteria block by
      // stamping its hash under `AC_CERT_HASH_KEY`. A later edit to the ACs — a
      // body-only `write_spec` (no `ac_verifications`) or a `patch_spec_section` of
      // the AC section — leaves this stamp behind, so it diverges from the new AC
      // block and `create_slice`'s readyGate refuses the slice as stale until the
      // ACs are re-certified (AC3). Editing other sections leaves the AC hash —
      // and this stamp — intact.
      fm[AC_CERT_HASH_KEY] = acRequirementHash(trimmed);
    } else {
      // Clearing the certification clears its baseline too — no orphan stamp that
      // would spuriously go "stale" against a Spec with no `ac_verifications`.
      delete fm.ac_verifications;
      delete fm[AC_CERT_HASH_KEY];
    }
  }
  await store.writeFile(rel, fm, `${trimmed}\n`);
  return {
    ok: true,
    spec,
    relativePath: rel,
    created: existing === undefined,
    implements: fm.implements,
    acVerifications: fm.ac_verifications,
    // Surface the provenance signature on the signing-on path so callers/tests can assert it landed
    // (the agent gains nothing from seeing it — it cannot reproduce it without the server secret).
    ...(typeof fm[AC_SIGNATURE_KEY] === "string"
      ? { acVerificationsSignature: fm[AC_SIGNATURE_KEY] }
      : {}),
  };
}

/**
 * `patch_spec_section` (SP-th1ddy) — replace exactly one named section of an
 * existing Spec's body via the pure `sectionPatch` helper, leaving every other
 * section byte-identical, and write the whole body back through
 * `ThinkubeStore.writeFile` so the secret scan applies (the only thinking space-write
 * boundary — no second write path). Frontmatter is preserved untouched. This is
 * the surgical single-section edit that replaces the model's
 * read-modify-write-whole-body dance; `write_spec` still replaces the full body.
 */
export async function patchSpecSection(
  store: ThinkubeStore,
  spec: string,
  section: string,
  content: string,
): Promise<unknown> {
  const rel = store.pathForSpecDoc(spec);
  const existing = await store.getFile(rel);
  if (!existing) {
    throw new Error(
      `No spec document at ${store.thinkubeDir}/${rel} — create it with write_spec first.`,
    );
  }
  const nextBody = sectionPatch(existing.body, section, content);
  // Route through the store's safe-write path so the secret scan refuses a
  // planted secret — never a raw fs write (Constraint: one write boundary).
  //
  // Re-audit (SP-th4wqf_SL-3): frontmatter is preserved verbatim, so the
  // `AC_CERT_HASH_KEY` stamp is NOT refreshed here. Patching the
  // `## Acceptance Criteria` section therefore changes the AC block while the
  // certification baseline stays put — the two diverge and `create_slice`'s
  // readyGate sees a stale certification (re-cert required). Patching any other
  // section leaves the AC block — and the stamp's match — untouched. (This tool
  // cannot certify: it carries no `ac_verifications`, so it only ever invalidates,
  // never re-stamps.)
  await store.writeFile(rel, existing.frontmatter, nextBody);
  return {
    ok: true,
    spec,
    section,
    relativePath: rel,
  };
}

/**
 * Read the repo's `tsconfig.test.json` `include` into a {@link RepoState} for the
 * runnable-verification precheck (SP-th4wqf_SL-1). The HANDLER owns this parse — not
 * the predicate — so "registered" is single-sourced to the real on-disk test-compile
 * set the toolchain actually uses (SP-th1ddy reuse rule).
 *
 * Returns `undefined` when no `tsconfig.test.json` exists at the repo root, or it is
 * unparseable: the precheck only applies to repos that use the `tsconfig.test.json`
 * test-compile convention, so a repo lacking (or with a broken) one imposes no
 * runnable requirement here — fail open rather than block every slice on a thinking space that
 * has no such config to validate against.
 */
function repoStateForRunnableCheck(repoRoot: string): RepoState | undefined {
  let raw: string;
  try {
    raw = fsSync.readFileSync(
      path.join(repoRoot, "tsconfig.test.json"),
      "utf8",
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return repoStateFromTsconfig(parsed);
}

/** Normalize a raw `ac_verifications` map (AC ordinal → declaration) into the canonical
 *  `{ run, env? }` frontmatter shape, dropping entries without a non-empty `run` or a positive
 *  integer ordinal, and sorting the keys by ordinal for a stable, low-diff write. */
function normalizeAcVerifications(
  raw: Record<string, unknown>,
): Record<string, { run: string; env?: "cluster" | "local" | "assessment" }> {
  type Decl = { run: string; env?: "cluster" | "local" | "assessment" };
  const entries: [number, Decl][] = [];
  for (const [key, val] of Object.entries(raw)) {
    const ac = Number(key);
    if (!Number.isInteger(ac) || ac <= 0) continue;
    if (!val || typeof val !== "object") continue;
    const run = (val as Record<string, unknown>).run;
    const env = (val as Record<string, unknown>).env;
    const isAssessment = env === "assessment";
    // An `assessment` AC (SP-6/7 AC3) is graded by an independent assessor session, not a runnable
    // command — so it needs no non-empty `run`. Every other AC still requires a runnable command.
    if (!isAssessment && (typeof run !== "string" || !run.trim())) continue;
    entries.push([
      ac,
      {
        run: typeof run === "string" ? run.trim() : "",
        ...(env === "cluster" || env === "local" || env === "assessment"
          ? { env }
          : {}),
      },
    ]);
  }
  entries.sort((a, b) => a[0] - b[0]);
  const out: Record<string, Decl> = {};
  for (const [ac, decl] of entries) out[String(ac)] = decl;
  return out;
}

export async function updateSlice(
  store: ThinkubeStore,
  handle: string,
  body?: string,
  tags?: string[],
  recut?: SliceRecut,
): Promise<unknown> {
  const { specNumber, sliceNumber } = parseSliceHandle(handle);
  const rel = store.pathForSlice(specNumber, sliceNumber);
  const parsed = await store.getFile(rel);
  if (!parsed) throw new Error(`No slice file at ${store.thinkubeDir}/${rel}`);

  // Tags are settable/replaceable via update (SP-tgvil2): when provided, set the
  // `tags` frontmatter (an empty array clears them); omitted → frontmatter as-is.
  let nextFm: Frontmatter | undefined =
    tags === undefined
      ? parsed.frontmatter
      : { ...(parsed.frontmatter ?? {}), tags };

  // Re-cut (SP-th4wqd #5): REPLACE the slice's footprint fields (files / satisfies
  // / work_units) in place, keeping the same `SL-{m}` (its identity lives in the
  // path, not these fields). The decision — including refusing a footprint that
  // escapes the thinking space repo with the SAME `sliceFilesResolveInRepo` rejection
  // `create_slice` gives — is owned by the shared `recutSliceFrontmatter`, which is
  // *driven* (not duplicated) here. A provided field replaces; omitted is left.
  const reCut = hasRecutFields(recut);
  if (reCut) {
    const result = recutSliceFrontmatter(
      store.workspaceRoot,
      nextFm ?? parsed.frontmatter,
      recut!,
    );
    if (!result.ok) throw new Error(result.error);
    nextFm = result.frontmatter;
  }

  // Body: optional. When provided, the heading guard (SP-4) applies — a body whose
  // first non-empty line isn't a `#` heading would regress the card to the
  // merged-line shape, so re-attach the existing title and treat the input as
  // detail. When omitted (e.g. a pure re-cut), the existing body is left unchanged.
  let nextBody = parsed.body;
  let titleReattached = false;
  if (body !== undefined) {
    const firstLine = body.split(/\r?\n/).find((l) => l.trim());
    nextBody = body;
    if (!firstLine || !firstLine.trim().startsWith("#")) {
      const oldFirst = parsed.body.split(/\r?\n/).find((l) => l.trim());
      const oldTitle = (oldFirst ?? "").replace(/^#+\s*/, "").trim();
      if (oldTitle) {
        nextBody = `# ${oldTitle}\n\n${body.trim()}\n`;
        titleReattached = true;
      }
    }
  }

  await store.writeFile(rel, nextFm, nextBody);
  return {
    ok: true,
    slice: store.sliceHandle(specNumber, sliceNumber),
    relativePath: rel,
    titleReattached,
    reCut,
  };
}

/**
 * Write a TEP into the thinking space (TEP-0009) — the thinking space-aware path for `/tep`.
 * Omit `tep` to mint a conflict-free base36-epoch id; pass it to update an
 * existing one. On create the body defaults to the `TEP-TEMPLATE.md` scaffold
 * and canonical frontmatter is filled; on update existing frontmatter is
 * preserved (only `title`/`status` are overlaid).
 */
export async function writeTep(
  store: ThinkubeStore,
  args: {
    tep?: string;
    title?: string;
    status?: string;
    body?: string;
    tags?: string[];
  },
  ctx?: HandlerContext,
): Promise<unknown> {
  const provided = args.tep?.trim().replace(/^TEP-/i, "");
  const tepId =
    provided && provided.length ? provided : await store.nextTepId();

  // #14 — promotion-aware target (TEP-th3i18). Once a TEP is promoted into a
  // Project, its canonical home moves out of the session thinking space's `teps/` and
  // into `<product>/projects/<id>/teps/TEP-<id>.md`. A naive write keeps
  // clobbering the stale session-thinking space copy while the promoted one drifts. So
  // resolve where the bytes belong BEFORE writing, via the SAME ownership
  // lookup `promote_tep`/`get_project` use (discoverProjects + projectTeps over
  // the thinking space root). The decision itself is the pure `resolveTepWritePath`
  // (SL-3 sibling) — we never re-spell it here.
  const thinkingSpaceRoot = ctx?.env.thinkingSpaceRoot;
  const projects: PromotedProject[] = thinkingSpaceRoot
    ? discoverProjects(thinkingSpaceRoot).map((p) => ({
        product: p.product,
        id: p.id,
        teps: projectTeps(thinkingSpaceRoot, p.product, p.id),
      }))
    : [];
  const dest = resolveTepWritePath(tepId, projects);
  if (dest.kind === "refuse") {
    // Ambiguous promotion home — refuse rather than minting a third copy. The
    // message names `promote_tep`, the tool that owns the single-home invariant.
    throw new Error(dest.message);
  }

  // The two homes differ only in *where* the bytes land:
  //   - session  → the store, store-relative (`teps/TEP-{id}.md` on this thinking space);
  //   - project  → the promoted copy, thinking space-root-relative fs (no session dup).
  // Everything between (read existing → merge body/frontmatter → write) is shared.
  // For the project copy resolve the path through the project's OWN store so it
  // lands under whatever `teps` root the project uses (`<org>/teps` for a
  // migrated project, bare `teps` for a fresh one) — the pure `projectTepPath`
  // can't know the org segment, so don't trust `dest.relativePath` for the bytes.
  const sessionRel = store.pathForTep(tepId);
  let projectAbs: string | undefined;
  let relativePath: string;
  if (dest.kind === "project" && thinkingSpaceRoot) {
    const projDir = path.join(
      thinkingSpaceRoot,
      dest.product,
      "projects",
      dest.projectId,
    );
    const projRel = new ThinkubeStore(projDir, projDir).pathForTep(tepId);
    projectAbs = path.join(projDir, projRel);
    relativePath = path.join(dest.product, "projects", dest.projectId, projRel);
  } else {
    projectAbs = undefined;
    relativePath = sessionRel;
  }

  const existing: ParsedFile | undefined = projectAbs
    ? await readMarkdownFile(projectAbs)
    : await store.getFile(sessionRel);

  // Body: explicit > existing > template scaffold (create only).
  let body = args.body?.trim();
  if (!body) {
    if (existing?.body) body = existing.body;
    else {
      const tmpl = await store.getFile(store.pathForTep("TEMPLATE"));
      body = tmpl?.body ?? `# TEP-${tepId} — <title>\n`;
    }
  }

  // Frontmatter: preserve on update; scaffold canonical fields on create.
  const fm: Frontmatter = existing?.frontmatter
    ? { ...existing.frontmatter }
    : {
        kind: "tep",
        id: `TEP-${tepId}`,
        status: "proposed",
        created: new Date().toISOString().slice(0, 10),
        implemented_by: [],
      };
  if (!fm.kind) fm.kind = "tep";
  if (!fm.id) fm.id = `TEP-${tepId}`;
  if (args.title) fm.title = args.title;
  if (args.status) fm.status = args.status as Frontmatter["status"];
  if (args.tags?.length) fm.tags = args.tags;

  const finalBody = body.endsWith("\n") ? body : `${body}\n`;
  if (projectAbs) {
    // Promoted copy: write thinking space-root-relative via fs (mirrors `promote_tep`'s
    // direct moves). NO session-thinking space copy is created — that's the whole point.
    await fsSync.promises.mkdir(path.dirname(projectAbs), { recursive: true });
    await fsSync.promises.writeFile(
      projectAbs,
      serializeFrontmatter({ frontmatter: fm, body: finalBody }),
      "utf8",
    );
  } else {
    await store.writeFile(sessionRel, fm, finalBody);
  }

  return {
    ok: true,
    tep: `TEP-${tepId}`,
    relativePath,
    created: existing === undefined,
    ...(dest.kind === "project"
      ? { promoted: true, project: `${dest.product}/${dest.projectId}` }
      : {}),
  };
}

/** Read a markdown file by absolute path, ENOENT → undefined (parity with
 *  `ThinkubeStore.getFile`, used for the thinking space-root-relative promoted TEP copy
 *  which lives outside any single thinking space's `thinkubeDir`). */
async function readMarkdownFile(abs: string): Promise<ParsedFile | undefined> {
  let text: string;
  try {
    text = await fsSync.promises.readFile(abs, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  return parseFrontmatter(text);
}

async function writeRetroNote(
  store: ThinkubeStore,
  body: string,
): Promise<unknown> {
  const date = new Date().toISOString().slice(0, 10);
  const rel = store.pathFor("retro", date);
  const existing = await store.getFile(rel);
  const frontmatter = existing?.frontmatter ?? {
    kind: "retro" as const,
    status: "active" as const,
    created: date,
  };
  const previous = existing?.body ?? "";
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
  const appended = `${previous.trimEnd()}\n\n## ${stamp}\n\n${body}\n`;
  await store.writeFile(rel, frontmatter, appended);
  return { relativePath: rel };
}

// ─── Resource definitions + reader ──────────────────────────────────────────

const RESOURCE_DEFS = [
  {
    uri: "thinkube://thinking_space_state",
    name: "Thinking Space state",
    description:
      "Current Tandem thinking space of this session's own repo: the Ready / Doing / Done columns projected from the committed slice files. (Resources are bound to the default thinking space; use the tools' `thinking space` parameter for other thinkingSpaces.)",
    mimeType: "application/json",
  },
  {
    uri: "thinkube://thinkube_file/{path}",
    name: "A thinking space file",
    description:
      "Read a specific thinking space markdown file from this session's own repo. Substitute `{path}` with the path relative to the thinking space directory (the sidecar namespace).",
    mimeType: "application/json",
  },
];

async function readResource(
  uri: string,
  _ctx: HandlerContext,
): Promise<string> {
  // MCP resources take no parameters, so they could only ever bind to a *default*
  // thinking space — which no longer exists (`thinking_space=` is mandatory per call, so the server
  // never silently picks a thinking space). Resources are therefore unavailable; use the
  // thinking space-scoped tools with an explicit `thinking_space=` instead.
  throw new Error(
    `Thinking Space resources are unavailable: a resource (\`${uri}\`) can't name a thinking space, and there is no default thinking space. Use the thinking space-scoped tools — list_thinking_space / get_thinkube_file — with an explicit \`thinking_space=\`.`,
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function asString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string")
    throw new Error(`argument ${key} must be a string`);
  return v;
}

function optString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string")
    throw new Error(`argument ${key} must be a string`);
  return v;
}

function asNumber(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1)
    throw new Error(`argument ${key} must be a positive integer`);
  return v;
}

function optBoolean(
  args: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean")
    throw new Error(`argument ${key} must be a boolean`);
  return v;
}

function optStringArray(
  args: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string"))
    throw new Error(`argument ${key} must be an array of strings`);
  return v as string[];
}

function optNumberArray(
  args: Record<string, unknown>,
  key: string,
): number[] | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "number"))
    throw new Error(`argument ${key} must be an array of numbers`);
  return v as number[];
}

// Kick off LAST: `main()` references classes (ThinkingSpaceRegistry) that — unlike
// function declarations — are not hoisted, so launching at the top of the
// module dies in the temporal dead zone.
// Guard on `require.main === module` so importing this module (e.g. a unit test
// exercising the exported handlers) does NOT boot the stdio server; only a
// direct `node kanbanMcpServer.js` launch (the .mcp.json entry) starts it.
if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(
      `[thinkube-mcp] startup failed: ${(err as Error).stack ?? err}\n`,
    );
    process.exit(1);
  });
}
