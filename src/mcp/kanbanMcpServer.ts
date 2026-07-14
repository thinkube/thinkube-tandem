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
 * (e.g. `Apps/vllm`, `Platform/core/thinkube`). The workspace
 * organization is semantic, so bare basenames are systemically ambiguous
 * (template vs deployed app) and are NEVER resolved — an unknown id fails
 * with candidate suggestions, and `list_thinking_spaces` supplies the vocabulary.
 * Absolute paths are also accepted.
 *
 * Source of truth: the committed `teps/TEP-{t}/SP-{n}/SL-{m}.md` slice files in the
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
import { execFileSync } from "node:child_process";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { requirementHash } from "../methodology/specChange";
import { sectionPatch } from "../methodology/sectionPatch";
import { specSectionsPresent } from "../methodology/specStructure";
import {
  sliceFilesExistInRepo,
  sliceFilesResolveInRepo,
  type RepoFileOracle,
} from "../methodology/sliceRepoGuard";
import {
  assertDeclaredSpace,
  resolveVerifiedRepo,
} from "../store/spaceRegistry";
import { SPACE_CARD_FILENAME } from "../store/spaceManifest";
import {
  // Slice lifecycle contract: the single source the `move_slice`
  // / `update_slice` handlers and their dispatch test agree on for retire + re-cut.
  // The status literal, the "reason required" rule, and the re-cut footprint check
  // are NEVER re-spelled here — they are consumed so the wiring and test can't drift.
  RETIRED_STATUS,
  isRetiredStatus,
  validateRetireReason,
  recutSliceFrontmatter,
  splitAttentionArtifacts,
  attentionHistoryEntry,
  hasRecutFields,
  type SliceRecut,
} from "../methodology/sliceLifecycle";
import { resolveSpecId } from "../methodology/idMinting";
import {
  normalizeSpecRef,
  resolveSpecRef,
  resolveSliceRef,
  SPEC_REF_GRAMMAR,
} from "./refResolver";
import {
  validateParallelGroup,
  validateDag,
  // Contract-first gate: consumed from parallelSlices.ts — the pure
  // check, its teaching message, and the shared opt-out field name. NEVER
  // redefined here; a second definition is exactly the contract divergence this
  // gate exists to prevent.
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
// Retired-symbol footprint gate (SP-6/15): the pure, injectable reverse-dependency
// check. `create_slice` / the `update_slice` re-cut resolve the repo root (the same
// root the footprint guard uses), read the repo's tracked source files, and run this
// over the slice's declared `retires` symbols + its footprint union. The DECISION —
// what counts as an uncovered importer and the violation shape — is owned there and
// never re-spelled here; this handler only supplies the repo files and turns a
// non-empty verdict into the refusal (mirroring the contractFirst/repo-guard split).
import {
  findUncoveredImporters,
  type RepoFile,
} from "../services/retiredSymbolFootprint";
// Author-time test-impact footprint gate (SP-6/18): the pure, injectable check that refuses a slice
// whose change's TEST blast-radius isn't in scope — an existing test that imports a changed SOURCE
// file must be folded into the footprint (a unit test) or retired (a held-out probe). Mirrors the
// retired-symbol wiring: `create_slice` / the `update_slice` re-cut feed it the tracked source files
// + the source (non-test) footprint entries as `changedFiles`; the DECISION (what's a test, how a
// specifier resolves, the violation shape + refusal tokens) is owned there and never re-spelled here.
import {
  findUncoveredTests,
  buildTestImpactRefusal,
} from "../services/testImpactFootprint";
import {
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
// SP-6/3 (TEP-6 mechanism 2): the human-approval gate on `create_slice` / spec→Ready. The review
// webview's Approve button — a UI action only the maintainer can take — mints a short-lived,
// content-bound token (HMAC'd with a server-only secret) into a side-channel store under the
// self-located approval dir; the gate reads and verifies it. The tool call carries NO token, so the
// agent can neither present, forge, nor replay one — the approval is a signal it cannot synthesize.
import {
  approvalContentHash,
  approvalStatus,
  loadOrCreateApprovalSecret,
} from "../services/approvalToken";
import { createApprovalStore } from "../services/approvalStore";
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
  /** → Done docs gate mode: advisory warns, blocking refuses. */
  docsGateMode: DocsGateMode;
  legacyWorkspace?: string;
}

/** The machine-level config file the extension writes so
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

  // SP-6/1 (TEP-6): `ac_verifications` provenance signing is MANDATORY for the live server — there
  // is no off mode. The extension host always publishes `THINKUBE_SIGNING_KEY_DIR` two ways over
  // (LauncherService sets it on the host env; machineConfig writes it into the server's registration
  // env), both derived from globalStorage — a dir code-server always provides. So an absent/empty dir
  // or an unloadable key is a real misconfiguration, not a "signing off" mode: REFUSE TO BOOT rather
  // than fall silently to the legacy path where an agent's unsigned, self-authored map is trusted.
  // The secret never leaves this process; the audit runner is the real headless-Claude one (lazy SDK
  // import, so no cost until a `write_spec` runs). (`ctx.auditRunner`/`signingSecret` stay OPTIONAL on
  // the type only as the unit-test injection seam — dispatch tests build a ctx without them to
  // exercise non-signing mechanics in isolation; that fixture is never the running MCP server.)
  const signingKeyDir = process.env.THINKUBE_SIGNING_KEY_DIR?.trim();
  if (!signingKeyDir) {
    throw new Error(
      "THINKUBE_SIGNING_KEY_DIR is not set — the kanban MCP server cannot certify ac_verifications " +
        "without a signing key, and it will not run an unsigned (forgeable) certification path. The " +
        "extension host must publish the key dir (globalStorage/signing). Refusing to boot.",
    );
  }
  const signingSecret: Buffer = loadOrCreateSecret(signingKeyDir);
  // SP-17/1 + 2026-07-14: the auditor runs on a pinned worker model, never the
  // session/env model — now the OPERATOR-CONFIGURED judgment model published by the
  // extension host (workerModelByRole.auditor ?? workerModel ?? sonnet). Sonnet
  // demonstrably rubber-stamps the person→API substitution the intent-fidelity
  // rule exists to catch; a judgment gate needs a judgment model.
  const auditorModel =
    (process.env.THINKUBE_AUDITOR_MODEL ?? "").trim() || "sonnet";
  const auditRunner: AuditRunner = createSdkAuditRunner({
    model: auditorModel,
    log,
  });
  log(
    "ac_verifications signing: on (mandatory; secret loaded from globalStorage)",
  );

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
        "A thinking space is required: pass `thinking_space=<id>` — the workspace spelling (e.g. `Platform/core/thinkube`) or a `<product>/projects/<id>` project namespace. There is no default thinking space; call list_thinking_spaces for the available ids." +
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
      `Unknown thinking space "${arg}" — thinking spaces are addressed by the workspace spelling (e.g. Platform/core/thinkube), never by bare name.${hint}`,
    );
  }

  /**
   * Hint appended to "not a thinking space" errors when no thinking space root is configured —
   * the common cause is a missing `thinkube.thinkingSpace.root` / `THINKUBE_THINKING_SPACE_ROOT`
   * for a thinking space that lives in a central sidecar. Without it we'd resolve to a
   * fabricated co-located `.thinkube/`. Empty when one IS set.
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
  // store) is NOT a thinking space — see thinkingSpaceDetection.ts.
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
    if (env.thinkingSpaceRoot) {
      // ONE convention (TEP-14): a space exists iff its sidecar dir holds a
      // card (space.yaml — declared, never inferred from folder shapes), and
      // its id IS the workspace spelling (the same string the sidecar dir is
      // named by). A repo outside every workspace folder has no valid name
      // and is not listed.
      if (!fsSync.existsSync(path.join(thinkingSpaceDir, SPACE_CARD_FILENAME)))
        return;
      const ns = namespaceForRepo(
        path.resolve(wt ? wt.canonicalRepo : abs),
        env.folders,
      );
      if (!ns) return;
      const name = wt
        ? `${path.basename(wt.canonicalRepo)} · ${wt.name} worktree`
        : path.basename(abs);
      out.set(abs, {
        id: ns,
        name,
        path: abs,
        thinkingSpaceDir,
        worktree: !!wt,
      });
      return;
    }
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
      "REQUIRED — the thinking space this call acts on: the workspace spelling (e.g. `Platform/core/thinkube`), a `<product>/projects/<id>` project namespace, or an absolute path. There is NO default thinking space (a call must never silently act on the session's cwd repo thinking space). Bare repo names are not accepted (ambiguous) — call `list_thinking_spaces` for the ids.",
  },
} as const;

export const TOOL_DEFS = [
  {
    name: "list_thinking_spaces",
    description:
      "Discover every Tandem thinking space across the configured roots: repos whose thinking space dir exists in the central sidecar namespace `<thinking space-root>/<container>/<rel>` (ADR-0008). Returns each thinking space's canonical id (the workspace spelling — the value to pass as `thinking_space` to the other tools), name, and absolute path, plus which thinking space is this session's default. Linked git worktrees are omitted (they share their canonical repo's thinking space — address them by that repo's id). The semantic location is part of the id (`apps/…` = deployed app, `User Templates/…` = template, `Platform/…` = platform code).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_tags",
    description:
      "Aggregate the #hashtag mesh across every thinking space in the workspace. Returns each tag with its `count` and the `items` carrying it ({ thinking space: the thinking space id, handle: SP-{n} | SP-{n}_SL-{m} | TEP-{id}, kind }), sorted by tag. An item with N tags appears under all N; a tag clusters items from multiple thinkingSpaces (the cross-thinking space clustering layer — a project is a promoted tag). Folds a legacy `theme:` in as a tag.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_products",
    description:
      "List Products — the code-less top nodes of the hierarchy. A Product is a top-level directory in the sidecar thinking space root whose member Thinking Spaces are the thinking space namespaces nested under it. Returns each Product `{ id, name (from <product>/product.yaml, else the id), members: namespaces }`, sorted by id. Empty when no thinking space root is configured. Products generalize the old fixed Platform/Apps/Templates containers into arbitrary user-defined groupings; a Project (later) is a tag promoted under a Product.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_projects",
    description:
      "List Projects across all Products. A Project is a bounded multi-repo effort = a promoted tag with a version-controlled home (`<product>/projects/<name>/project.yaml`). Returns each Project `{ product, id, name, state (open|done), tag, tep? }`, sorted. Empty when no thinking space root is configured. Use `get_project` to resolve a project's members (the items carrying its tag).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "resolve_project_space",
    description:
      'Derive the project-umbrella thinking space for a working directory (TEP-6). Given the session\'s absolute `cwd`, returns `{ namespace: "<product>/projects/<id>", project }` when cwd is at/under a project umbrella, else `{ namespace: null, reason }`. Lets /spec-prepare and /slice pick `thinking_space` AUTOMATICALLY — precedence: an explicit thinking_space arg OVERRIDES; otherwise derive via this; otherwise ask. The server matches the passed cwd against the thinking-space root and never reads its own process.cwd().',
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description:
            "Absolute path of the session's working directory. The client passes its own cwd; the server never consults process.cwd().",
        },
      },
      required: ["cwd"],
      additionalProperties: false,
    },
  },
  {
    name: "get_project",
    description:
      "Get one Project's umbrella TEPs + its members. A Project is a code-less umbrella owning TEPs; its members are the specs (across thinkingSpaces) whose `implements:` resolves to one of those TEPs, plus their slices (inherited) — structural, not tags. Returns `{ project, teps: [TEP-id], members: [{ thinking_space, repo, handle, kind }] }` where `thinking_space` is WHERE THE FILE LIVES (the namespace to pass to get_thinkube_file/write_spec/create_slice — the project umbrella for a nested member) and `repo` is the WORKING repository the orchestrator branches a worktree in. For a legacy flat-model member the two coincide.",
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
      "Promote a repo TEP into an existing Project's umbrella. Moves `TEP-<tep>` out of its repo's `teps/` into `<product>/projects/<id>/teps/`, then rewrites EVERY spec that implemented it (across thinkingSpaces) to the qualified umbrella ref — so all former implementers stay members and no dangling/bare ref remains. Returns `{ tep, movedTo, rewritten: [SP-handles] }`. The Project must already exist (create it with New Project first).",
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
      "Current Tandem thinking space, projected from the committed `teps/TEP-{t}/SP-{n}/SL-{m}.md` slice files (in the thinking space's sidecar namespace). Returns the Ready / Doing / Done columns; each card carries its slice handle (`id`, e.g. `TEP-1_SP-4_SL-1`), title (`description`), and `specStale` / `specChange` (whether the parent Spec's requirements changed since the slice was last verified).",
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
          description:
            "Slice ref: `TEP-1_SP-4_SL-1` (full handle), `SP-4_SL-1` (TEP resolved by lookup), or `1/4/1`.",
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
        relative_path: {
          type: "string",
          description: "e.g. teps/TEP-1/SP-4/spec.md",
        },
        ...THINKING_SPACE_PARAM,
      },
      required: ["relative_path"],
      additionalProperties: false,
    },
  },
  {
    name: "move_slice",
    description:
      "Move a slice to a different column by setting its `status:` frontmatter. Status must be one of: Ready, Doing, Done, Requires-attention (a needs-human state the orchestrator sets when a worker can't resolve a problem — /attend returns it to the loop), or Retired. **Retired** is a TERMINAL state DISTINCT from Done — it records a required `reason` (a retire with no `reason` is refused), drops the slice off the active thinking space/frontier, and the → Done gate never runs for it; the slice file stays on disk so its `SL-{m}` stays reserved (the next slice is still `max+1`). Moving to Done is REFUSED unless every acceptance criterion the slice lists in `satisfies` is checked on the parent Spec (the error names the offending criterion); slices with no `satisfies` are not gated. The → Done **docs gate** also applies: a `docs: required` slice must have its documentation done — pass `docs_done: true` once you've updated the doc module. In blocking mode an unsatisfied obligation is refused; in advisory mode (default) the move returns a `docsWarning`. On a successful Done it stamps the slice's `verified_req_hash` from the parent Spec so a later requirement edit re-flags it stale.",
    inputSchema: {
      type: "object",
      properties: {
        slice: {
          type: "string",
          description:
            "Slice ref: `TEP-1_SP-4_SL-1` (full handle), `SP-4_SL-1` (TEP resolved by lookup), or `1/4/1`.",
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
            "Attest that a `docs: required` slice's documentation was updated in this slice. Satisfies the → Done docs gate; persisted as `docs_done` on the slice. Only meaningful when moving to Done.",
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
          description:
            "The Spec to accept — any spec ref: `<tep>/<sp>` (e.g. `1/4`), `TEP-1_SP-4`, `TEP-1/SP-4`, `SP-1/4`, or bare `SP-4`/`4` (resolved by lookup).",
        },
        ...THINKING_SPACE_PARAM,
      },
      required: ["spec"],
      additionalProperties: false,
    },
  },
  {
    name: "supersede_spec",
    description:
      'Mark a Spec as **superseded** — a deliberate, reason-carrying "not building this" state (SP-6/14). Distinct from `accepted:` (done) and from the view-only `archived:` flag; a superseded Spec is REMOVED from its TEP\'s `openSpecs`/completeness (unlike archived), so an abandoned Spec no longer blocks its TEP. REFUSED with an error naming `reason` when the reason is blank/whitespace-only (mirrors the slice Retire transition). On success stamps `superseded:` (ISO timestamp) + `superseded_reason:` on the Spec doc, leaving the body and every other frontmatter key unchanged; never writes an `accepted:` key. Reversible via `unsupersede_spec`.',
    inputSchema: {
      type: "object",
      properties: {
        spec: {
          type: "string",
          description:
            "The Spec to supersede — any spec ref: `<tep>/<sp>` (e.g. `1/4`), `TEP-1_SP-4`, `TEP-1/SP-4`, `SP-1/4`, or bare `SP-4`/`4` (resolved by lookup).",
        },
        reason: {
          type: "string",
          description:
            "Why this Spec is being superseded — required (a blank/whitespace reason is refused), recorded as `superseded_reason:`.",
        },
        ...THINKING_SPACE_PARAM,
      },
      required: ["spec", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "unsupersede_spec",
    description:
      "Reverse `supersede_spec` (SP-6/14): delete BOTH `superseded:` and `superseded_reason:` from the Spec's frontmatter, returning it to its TEP's `openSpecs`/completeness. Mirrors how `move_slice` deletes the `accepted:` key when reopening a Done slice — content-preserving, leaving the body and all other frontmatter keys unchanged.",
    inputSchema: {
      type: "object",
      properties: {
        spec: {
          type: "string",
          description: "The Spec id (SP-{id}) to un-supersede.",
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
      "Create a new slice under a Spec in the canonical shape. The server allocates the SL number (per-Spec, archive-aware) and serializes the file (frontmatter + `# title` heading + detail body) — callers never pick numbers or format files. Refused when the parent Spec is missing or has an empty `## Acceptance Criteria` (the → Ready gate, enforced at creation). Declare any exported symbols the slice removes/narrows in `retires:` — the server refuses the slice unless every existing importer of a retired symbol is already inside its footprint (SP-6/15). The server also refuses a slice whose changed SOURCE files have existing test importers outside its footprint (SP-6/18) — fold each impacted unit test into the footprint, or retire each held-out acceptance probe. Title limit: 70 chars — detail belongs in the body.",
    inputSchema: {
      type: "object",
      properties: {
        spec: {
          type: "string",
          description:
            "Parent Spec ref — any of: `<tep>/<sp>` (e.g. `1/4`), `TEP-1_SP-4`, `TEP-1/SP-4`, `SP-1/4`, or a bare `SP-4`/`4` (resolved against the thinking space's TEPs; refused if ambiguous or unknown).",
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
            "Named concurrency group. Slices sharing a parallel_group may run in parallel worktrees, so their `files` sets must be disjoint — the server refuses a group whose members overlap, naming the conflicting files.",
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
              // Contract-first opt-out. The property KEY is the shared
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
            "Execution-aware work units: each { footprint (files/objects it touches), consumes? (files a sibling unit produces that this unit reads — the only dependency language), execution: serial|mechanize|fan-out, note? (the unit's task text — self-describing, required in practice for fan-out) }. Uniform data-parallel work collapses to one `mechanize` unit; heterogeneous → `fan-out` (one per object, each with its `note`); coupled → `serial`. The slice stays the validation envelope; work units are never independently gated. A `*.test.*`/integration `fan-out` unit with no `consumes` beside sibling implementers is refused by the contract-first gate (route it through a shared contract file via `consumes`, or set the opt-out flag for a genuinely-independent test). Express every dependency as `consumes`.",
        },
        retires: {
          type: "array",
          items: { type: "string" },
          description:
            'Exported symbol names this slice REMOVES or NARROWS (SP-6/15) — the machine-readable successor to the prose `// Retired: …` contract line (e.g. ["APPROVAL_TTL_MS", "verifyApproval.now"], plain tokens). Serialized to slice frontmatter `retires:` and surfaced by `get_slice`. Arms an author-time reverse-dependency gate: after the footprint/contract gates the server reads the working repo\'s source and REFUSES the slice unless EVERY existing importer of a retired symbol is already inside the slice\'s footprint (`files` + a work_unit `footprint`), naming each retired symbol and the uncovered importer path — so the removal\'s blast radius is footprinted before orchestration, not discovered when the whole-project compile breaks. Omit/empty for a slice that retires nothing (the default, unchanged path).',
        },
        creates: {
          type: "array",
          items: { type: "string" },
          description:
            'Footprint paths this slice CREATES (new files), e.g. ["src/new-module.ts"]. Every other footprint path (in `files` and non-test work_unit footprints) must already EXIST in the working repo — the slice is refused otherwise, naming each missing path with a did-you-mean, so workers are never fenced onto a phantom path. Held-out test-unit footprints are exempt automatically. Serialized to frontmatter `creates:`.',
        },
        docs: {
          type: "string",
          enum: ["required", "n/a"],
          description:
            "Documentation obligation. `required` (default) arms the → Done docs gate for user-facing work; `n/a` skips it but requires `docs_reason`. Internal refactors / test-only / infra are `n/a`.",
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
            "Free-form clustering tags — the #hashtag mesh: component (`keycloak`), concern (`security`), project (`rebrand`). Many-to-many, cross-thinking space (surfaced by `list_tags`).",
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
      "Write a Spec's document at `teps/TEP-{t}/SP-{n}/spec.md` in the thinking space (the sidecar namespace), creating it if absent. Replaces the markdown body; existing frontmatter (e.g. `accepted:`) is preserved, and `implements:` can be set via its parameter. Omit `spec` to mint the next sequential SP number under the `implements:` TEP; pass it to update an existing Spec. The minted/given id is returned as `spec`. This is the thinking space-aware write path for `/spec-prepare` — use it instead of a raw file write, which would land outside the thinking space.",
    inputSchema: {
      type: "object",
      properties: {
        spec: {
          type: "string",
          description:
            "Spec ref — any of: `<tep>/<sp>` (e.g. `1/4`), `TEP-1_SP-4`, `TEP-1/SP-4`, `SP-1/4`, or a bare `SP-4`/`4` (composed with the `implements:` TEP). Omit to mint the next sequential SP number under that TEP.",
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
            "The WORKING repository for a project-member spec — the workspace spelling (e.g. `Platform/core/thinkube-metadata`) the orchestrator branches a worktree in, independent of where the spec file lives under the project umbrella. Sets the `repo:` frontmatter. Omit to leave unchanged; empty clears it. A normal same-repo spec needs none (the orchestrator falls back to the thinking space's repo).",
        },
        ac_verifications: {
          type: "object",
          description:
            "The closing AI-verification gate's per-AC declaration: a map keyed by 1-based AC ordinal → `{ run, env? }`, where `run` is the shell/playbook command that verifies that AC (exit 0 = pass) and `env` is `cluster` (an infra lifecycle) or `local`. The orchestrator runs the union as a full plan at Spec quiescence and gates Done/commit on all-green (no skip; red or un-runnable → requires-attention). Sets the `ac_verifications:` frontmatter; omit to leave unchanged, pass `{}` to clear.",
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
      // `body` is optional for a CERTIFY-ONLY call on an EXISTING spec — the `/spec-prepare`
      // step-7 shape (`write_spec { spec, ac_verifications }`) certifies the body already on
      // disk without re-sending (and without a read-modify-write race). Creating a spec, or
      // changing its text, still requires `body`; a body-less call on a missing spec is refused.
      required: [],
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
            "Spec ref whose section to patch — any of: `<tep>/<sp>` (e.g. `1/4`), `TEP-1_SP-4`, `TEP-1/SP-4`, `SP-1/4`, or bare `SP-4`/`4` (resolved by lookup).",
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
      "Update a slice in place, keeping its `SL-{m}` number. Pass `body` to replace the markdown body (frontmatter is preserved; the body's first line must be the `# title` heading — if the new body lacks one, the existing title is re-attached and the input is treated as detail, so a card can never become heading-less). **Re-cut:** pass `files` / `satisfies` / `work_units` to REPLACE the slice's footprint fields without re-creating it — a re-scope. A provided field replaces wholesale (an empty array clears it); an omitted field is left untouched. A re-cut whose declared footprint (any `files` path or `work_units[].footprint` path) escapes the thinking space repo is REFUSED with the same rejection `create_slice` gives — the check routes through the shared repo guard, not a copy. Pass `retires` to (re)declare the exported symbols the re-cut removes/narrows — refused unless every existing importer of a retired symbol is inside the (post-re-cut) footprint (SP-6/15). `body` is optional: omit it for a pure re-cut and the body is left unchanged.",
    inputSchema: {
      type: "object",
      properties: {
        slice: {
          type: "string",
          description:
            "Slice ref: `TEP-1_SP-4_SL-1` (full handle), `SP-4_SL-1` (TEP resolved by lookup), or `1/4/1`.",
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
            "Replace the slice's clustering tags. Omit to leave tags unchanged; pass `[]` to clear.",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description:
            "Re-cut: REPLACE the slice's machine-readable file set (repo-relative paths). Omit to leave unchanged; pass `[]` to clear. Validated against the thinking space repo with the same guard `create_slice` uses — a path that escapes the repo is refused.",
        },
        satisfies: {
          type: "array",
          items: { type: "integer", minimum: 1 },
          description:
            "Re-cut: REPLACE the 1-based AC ordinals this slice delivers. Omit to leave unchanged; pass `[]` to clear.",
        },
        contract: {
          type: "string",
          description:
            "Re-cut: REPLACE the slice's design-time contract (SP-6/3 — the shared interface, compilable signatures, injected into every worker's prompt). Omit to leave unchanged. A re-scope that changes the seam must revise the contract here, never by hand-editing frontmatter.",
        },
        retires: {
          type: "array",
          items: { type: "string" },
          description:
            "Re-cut (SP-6/15): REPLACE the slice's retired-symbol declaration — the exported symbol names the re-cut removes or narrows (plain tokens, e.g. [\"APPROVAL_TTL_MS\"]). Omit to leave `retires:` unchanged; pass `[]` to clear. When provided, arms the same author-time reverse-dependency gate `create_slice` runs: the re-cut is REFUSED unless every existing importer of a retired symbol is inside the slice's (post-re-cut) footprint, naming each retired symbol and the uncovered importer path — so widen `files`/`work_units` to cover them, or drop the symbol. Surfaced by `get_slice`.",
        },
        creates: {
          type: "array",
          items: { type: "string" },
          description:
            "Re-cut: REPLACE the slice's declared-new-file set (the footprint existence-gate exemption). Omit to leave `creates:` unchanged; pass `[]` to clear. The re-cut's resulting footprint must exist in the working repo except `creates:` entries and held-out test-unit footprints — refused otherwise with a did-you-mean, same as create_slice.",
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
            "Re-cut: REPLACE the slice's execution-aware work units. Omit to leave unchanged; pass `[]` to clear. Each unit's `footprint` is checked against the thinking space repo with the same guard `create_slice` uses. Express dependencies as `consumes` (a sibling unit's produced file).",
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
      "Write a Tandem Enhancement Proposal at `teps/TEP-<id>/tep.md` in the thinking space (the sidecar namespace), creating it if absent (TEP-0009). The thinking space-aware write path for `/tep` — use it instead of a raw file write. Omit `tep` to mint the thinking space's next sequential id; pass it to update an existing TEP. On create, the body defaults to the `TEP-TEMPLATE.md` scaffold and canonical frontmatter (kind/id/status/created/implemented_by) is filled; on update, existing frontmatter is preserved. `title`/`status` set those fields. Promotion-aware: if the TEP has been promoted into a Project (its canonical home moved to `<product>/projects/<id>/teps/`), the update lands on that **project copy** — no stale duplicate is left on the session thinking space; if more than one project claims it the write is refused, pointing you at `promote_tep` to reconcile the single home.",
    inputSchema: {
      type: "object",
      properties: {
        tep: {
          type: "string",
          description:
            "TEP id (with or without the `TEP-` prefix). Omit to mint the thinking space's next sequential id.",
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
            "Clustering tags for the TEP — the #hashtag mesh, surfaced cross-thinking space by `list_tags`.",
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
            "The Spec whose worktree session to open — any spec ref: `<tep>/<sp>` (e.g. `1/4`), `TEP-1_SP-4`, `TEP-1/SP-4`, `SP-1/4`, or bare `SP-4`/`4` (resolved by lookup).",
        },
        ...THINKING_SPACE_PARAM,
      },
      required: ["spec"],
      additionalProperties: false,
    },
  },
  {
    name: "open_review",
    description:
      "Open the human review panel for a document (SP-6/3, TEP-6 mechanism 2) — the reusable, kind-agnostic review primitive. The MCP server is a detached process with no `vscode` API, so this bridges to the Extension Host via a one-shot control request (the same MCP→host filesystem channel `start_spec_worktree` uses); the host mounts the review webview on the resolved document for subjectKey `${kind}:${id}` (e.g. `spec:TEP-6/SP-3`). The panel renders the live markdown and carries the maintainer-only **Approve** button — a UI action the agent cannot take — which mints the short-lived, content-bound approval token into the side-channel store that `create_slice` / spec→Ready always verifies. The agent never sees or carries the token; this tool only opens the surface where the human grants it. Requires the Extension Host to be running.",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["spec", "tep"],
          description:
            "The subject kind — namespaces the subjectKey (`spec:` vs `tep:`) so an approval for one kind can never satisfy another kind's gate. Only the `spec` instance is wired to a gate today (`create_slice`/→Ready); `tep` reuses the same primitive for the follow-up Accept-TEP flow.",
        },
        id: {
          type: "string",
          description:
            'The subject id. For `spec`: the canonical `TEP-<t>/SP-<n>` (e.g. "TEP-6/SP-3"; the internal composite `<t>/<n>` or a unique bare SP number is also accepted). For `tep`: `TEP-<id>` (or the bare id).',
        },
        ...THINKING_SPACE_PARAM,
      },
      required: ["kind", "id"],
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
  // The MCP server is a long-lived subprocess rooted in the session's launch cwd. For a
  // rejected project-member that cwd is an ephemeral working-repo worktree the orchestrator
  // RESETS on a fresh run (remove + re-add → new inode) and accept later removes — leaving
  // this server's process.cwd() a dangling reference that makes every child-process spawn
  // (the verifiability audit, probes) die with `ENOENT: uv_cwd`. Recover to the stable
  // thinking-space root before dispatching so a worktree that moved under us can't wedge the
  // whole server (TEP-6). Per-spawn callers still pass their own precise cwd on top of this.
  try {
    process.cwd();
  } catch {
    const safe = ctx.env.thinkingSpaceRoot;
    if (safe) {
      try {
        process.chdir(safe);
      } catch {
        /* no better fallback — the per-call cwd option is the last line of defense */
      }
    }
  }

  if (name === "list_thinking_spaces") return listThinkingSpaces(ctx);
  if (name === "list_tags") return listTags(ctx);
  if (name === "list_products") return listProducts(ctx);
  if (name === "list_projects") return listProjects(ctx);
  if (name === "resolve_project_space")
    return resolveProjectSpace(ctx, asString(args, "cwd"));
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
      return writeLock.runExclusive(thinkingSpaceHandle, async () =>
        acceptSpec(
          store,
          await resolveSpecRef(
            () => store.listSpecDirs(),
            typeof args.spec === "number"
              ? String(args.spec)
              : asString(args, "spec"),
          ),
        ),
      );
    case "supersede_spec":
      writeGate(name);
      return writeLock.runExclusive(thinkingSpaceHandle, async () =>
        supersedeSpec(
          store,
          await resolveSpecRef(
            () => store.listSpecDirs(),
            typeof args.spec === "number"
              ? String(args.spec)
              : asString(args, "spec"),
          ),
          asString(args, "reason"),
        ),
      );
    case "unsupersede_spec":
      writeGate(name);
      return writeLock.runExclusive(thinkingSpaceHandle, async () =>
        unsupersedeSpec(
          store,
          await resolveSpecRef(
            () => store.listSpecDirs(),
            typeof args.spec === "number"
              ? String(args.spec)
              : asString(args, "spec"),
          ),
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
      // Approval gate: a slice may not reach
      // Ready while the parent Spec's `implements:` TEP is not yet `accepted`
      // (approved-to-build). Resolve the TEP's status via thinking space context and run
      // the pure `tepApprovalGate` before `createSlice` does any work, so the
      // refusal (naming the TEP + its status) fires at the door.
      await assertTepApproved(ctx, store, createSpecId);
      return createSlice(
        store,
        {
          // Spec id is a string; tolerate a numeric integer id from callers
          // that still pass a number (legacy specs).
          spec: createSpecId,
          title: asString(args, "title"),
          body: asString(args, "body"),
          depends_on: optStringArray(args, "depends_on"),
          parallel: optBoolean(args, "parallel"),
          parallel_group: optString(args, "parallel_group"),
          files: optStringArray(args, "files"),
          satisfies: optNumberArray(args, "satisfies"),
          contract: optString(args, "contract"),
          // The execution-aware work units. Forwarded verbatim — createSlice
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
          // Retired-symbol declaration (SP-6/15): forwarded verbatim; createSlice
          // gates it against the working-repo's importers and serializes it to
          // frontmatter `retires:`.
          retires: optStringArray(args, "retires"),
          // Declared-new files: exempt from the footprint existence gate.
          creates: optStringArray(args, "creates"),
        },
        // SP-6/1 provenance: hand `createSlice` the server signing secret so its
        // → Ready gate verifies the `ac_verifications` signature (not the
        // reproducible hash) and refuses a Spec whose auditor was skipped. Absent
        // ⇒ legacy hash-only gate.
        ctx.signingSecret,
        // The spec's WORKING repo (its `repo:` resolved) — what the footprint
        // existence gate checks against; undefined skips that gate.
        await resolveSpecWorkingRepo(ctx, store, createSpecId),
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
      // #6 minting: `spec` is optional — when omitted, mint the next sequential
      // SP number under the `implements:` TEP (parity with `write_tep`). The pure
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
      // The mint path already returns that composite; a caller-PROVIDED id is put
      // through the ONE ref grammar (refResolver): any two-part form (`1/4`,
      // `TEP-1_SP-4`, `TEP-1/SP-4`, `SP-1/4`) normalizes to the composite, and a
      // bare SP id (`2`, `SP-2` — the shape `/spec-prepare` passes) is composed
      // with its parent TEP from `implements:`. write_spec may CREATE a spec, so
      // a bare id is composed (never looked up); with no `implements:` it cannot
      // be located, so refuse rather than write a stray. A ref that fits no form
      // is refused with the grammar (previously it fell through verbatim and
      // `pathForSpecDoc` built a `TEP-<garbage>/SP-undefined` path).
      let composedSpecId = specId;
      if (!specId.includes("/")) {
        const ref = normalizeSpecRef(specId);
        if (ref.kind === "composite") {
          composedSpecId = ref.id;
        } else if (parentTep) {
          composedSpecId = `${parentTep}/${ref.id}`;
        } else {
          throw new Error(
            `write_spec needs \`implements: TEP-<n>\` to resolve the bare spec id \`${ref.id}\` to its \`TEP-<n>/SP-${ref.id}\` location, or pass ${SPEC_REF_GRAMMAR}.`,
          );
        }
      }
      // ENFORCEMENT (TEP-14): one naming convention. A `repo:` must be a
      // DECLARED space (its dir under the thinking-space root holds
      // space.yaml), resolve under a workspace folder, and its directory's
      // git remote must match the card — verified NOW, at write time, so a
      // bad card can never be stored. A qualified `implements:` namespace
      // must be a declared space. (Skipped only when no thinking-space root
      // is configured — bare unit-test fixtures.)
      const repoRefArg = optString(args, "repo");
      if (repoRefArg?.trim() && ctx.env.thinkingSpaceRoot) {
        await resolveVerifiedRepo(
          repoRefArg.trim(),
          ctx.env.folders,
          ctx.env.thinkingSpaceRoot,
          "write_spec `repo:`",
        );
      }
      if (implementsRaw?.includes(":") && ctx.env.thinkingSpaceRoot) {
        const qualifierNs = implementsRaw
          .slice(0, implementsRaw.lastIndexOf(":"))
          .trim();
        if (qualifierNs)
          assertDeclaredSpace(
            qualifierNs,
            ctx.env.thinkingSpaceRoot,
            "write_spec `implements:` qualifier",
          );
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
        if (repoNs && ctx.env.thinkingSpaceRoot) {
          // Strict: the audit must run in the VERIFIED working repo — a card
          // that no longer verifies fails the write loudly (correct the card).
          auditCwd = await resolveVerifiedRepo(
            repoNs,
            ctx.env.folders,
            ctx.env.thinkingSpaceRoot,
            "write_spec audit",
          );
        } else if (repoNs) {
          // No thinking-space root configured — a bare test harness, never a
          // real deployment (production always sets THINKUBE_THINKING_SPACE_ROOT).
          const resolved = repoPathForNamespace(repoNs, ctx.env.folders);
          if (resolved && fsSync.existsSync(resolved)) auditCwd = resolved;
        }
      }
      return writeSpec(
        store,
        composedSpecId,
        // Optional: absent = certify-only against the existing on-disk body (step-7 shape).
        optString(args, "body"),
        implementsRaw,
        // The closing gate's per-AC declaration. Forwarded verbatim — writeSpec
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
        // Same ref grammar as every other spec tool (previously a raw
        // passthrough that only understood the composite `1/4`).
        await resolveSpecRef(
          () => store.listSpecDirs(),
          typeof args.spec === "number"
            ? String(args.spec)
            : asString(args, "spec"),
        ),
        asString(args, "section"),
        asString(args, "content"),
      );
    case "update_slice": {
      writeGate(name);
      // Resolve the slice's parent spec up front so the footprint existence
      // gate can check against the spec's WORKING repo (`repo:`), not the
      // possibly code-less umbrella the store is rooted in.
      const recutSliceSpec = (
        await resolveSliceRef(
          () => store.listSpecDirs(),
          asString(args, "slice"),
        )
      ).specNumber;
      return updateSlice(
        store,
        asString(args, "slice"),
        // Body is optional (a pure re-cut needn't restate it).
        optString(args, "body"),
        optStringArray(args, "tags"),
        // Re-cut footprint fields: a provided field replaces, omitted
        // is left untouched. Forwarded verbatim; updateSlice routes them through
        // the shared repo guard before writing.
        {
          files: optStringArray(args, "files"),
          satisfies: optNumberArray(args, "satisfies"),
          work_units: Array.isArray(args.work_units)
            ? (args.work_units as Frontmatter["work_units"])
            : undefined,
          contract: optString(args, "contract"),
          creates: optStringArray(args, "creates"),
        },
        // Retired-symbol declaration (SP-6/15): forwarded verbatim; updateSlice gates
        // the re-cut against the working-repo's importers and (re)serializes `retires:`.
        optStringArray(args, "retires"),
        await resolveSpecWorkingRepo(ctx, store, recutSliceSpec),
      );
    }
    case "write_tep": {
      writeGate(name);
      const tepStatus = optString(args, "status");
      const tepArg = optString(args, "tep");
      // Completeness gate: `implemented` is the
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
        await resolveSpecRef(
          () => store.listSpecDirs(),
          typeof args.spec === "number"
            ? String(args.spec)
            : asString(args, "spec"),
        ),
        store.workspaceRoot,
      );
    case "open_review":
      // Deliberately NOT write-gated: it mutates nothing in the thinking space — it
      // asks the host to show the review panel so the MAINTAINER can act. A
      // read-only (navigator) session must still be able to surface the
      // Approve affordance; the approval itself is human-minted, never an AI write.
      return openReview(store, asString(args, "kind"), asString(args, "id"));
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ─── Tool implementations ───────────────────────────────────────────────────

/**
 * Hand off "open this Spec's worktree session" to the Extension Host (AC8). The
 * MCP process can't open a VS Code session itself, so it writes a one-shot
 * control request into the self-located `<globalStorage>/control` dir; the host's
 * file watcher consumes it and runs `thinkube.specs.startWorktree` (the same
 * create-or-reuse + thinking space-root inject + open-session machinery as the button,
 * SL-7). Reuses the thinking space's filesystem MCP→host channel — not the tmux bridge.
 */
async function startSpecWorktree(spec: string, repo: string): Promise<unknown> {
  const dir = resolveControlDir(process.argv[1]);
  await fsSync.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, startWorktreeRequestFile(spec));
  await fsSync.promises.writeFile(
    file,
    serializeControlRequest({ kind: "start-worktree", spec, repo }),
    "utf8",
  );
  return { ok: true, spec, request: file };
}

/**
 * Filename for an open-review control request (one per subject, fire-once).
 * Hex-encoded like `startWorktreeRequestFile` so an exotic subjectKey (it
 * carries `:` and `/`) can never escape the control dir.
 */
function openReviewRequestFile(subjectKey: string): string {
  const safe = Buffer.from(subjectKey, "utf8").toString("hex");
  return `open-review-${safe}.json`;
}

/**
 * `open_review({kind, id})` (SP-6/3, TEP-6 mechanism 2): hand "open the review
 * panel for this document" to the Extension Host. This process has no `vscode`
 * API, so — exactly like `startSpecWorktree` above — it writes a one-shot
 * control request into the self-located `<globalStorage>/control` dir; the host's
 * watcher consumes it and mounts `ReviewPanel.open(subjectKey, docPath, deps)`.
 * The request carries the resolved arguments (the server resolves the
 * thinking-space doc path here, where the store lives, so the host needn't
 * re-map ids to files) plus the normalized subject pieces, so the host may
 * route either straight to `ReviewPanel.open(subjectKey, docPath, deps)` or
 * through its `openReviewFromHost({kind, id}, {storageDir, thinkingSpaceDir})`
 * seam (the same one the kanban panel's "Approve spec" button uses):
 *
 *   { kind: "open-review", subjectKind, id, subjectKey, docPath, thinkingSpaceDir }
 *
 * Kind-agnostic by construction: `subjectKey` is the kind-namespaced
 * `${kind}:${id}` (`spec:TEP-6/SP-3` / `tep:TEP-6`), so the panel this opens —
 * and the token its Approve button mints — can never satisfy another kind's
 * gate. For `spec` the id is normalized to the EXACT subjectKey the
 * `create_slice` gate computes (`spec:TEP-<t>/SP-<n>`), so the approval the
 * maintainer mints in the panel is the one the gate verifies. Only that spec
 * instance is wired to a gate here; the `tep:` instance is the follow-up
 * Accept-TEP flow reusing this same primitive.
 */
async function openReview(
  store: ThinkubeStore,
  kind: string,
  id: string,
): Promise<unknown> {
  if (kind !== "spec" && kind !== "tep") {
    throw new Error(
      `Unknown review kind "${kind}" — expected "spec" or "tep".`,
    );
  }
  let subjectKey: string;
  let canonicalId: string;
  let docRel: string;
  if (kind === "spec") {
    // Accept the canonical `TEP-<t>/SP-<n>` (the form the gate's refusal
    // teaches), the internal composite `<t>/<n>`, or a bare SP number resolved
    // to its unique TEP the same way `create_slice` resolves it.
    const canonical = /^TEP-([A-Za-z0-9]+)\/SP-([A-Za-z0-9]+)$/i.exec(
      id.trim(),
    );
    const composite = canonical
      ? `${canonical[1]}/${canonical[2]}`
      : await resolveCompositeSpecId(
          () => store.listSpecDirs(),
          id.trim().replace(/^SP-/i, ""),
        );
    if (!composite.includes("/")) {
      throw new Error(
        `Spec "${id}" not found — pass the composite id \`TEP-<t>/SP-<n>\` (e.g. "TEP-6/SP-3").`,
      );
    }
    const [tep, sp] = composite.split("/");
    canonicalId = `TEP-${tep}/SP-${sp}`;
    subjectKey = `spec:${canonicalId}`;
    docRel = store.pathForSpecDoc(composite);
    if (!(await store.getFile(docRel))) {
      throw new Error(
        `Spec document not found at \`${docRel}\` — nothing to review. Write the spec (write_spec) before opening its review panel.`,
      );
    }
  } else {
    const tepId = id.trim().replace(/^TEP-/i, "");
    // `findTep` resolves the real file (slugless or legacy slugged), so the
    // panel watches the document that actually exists.
    const found = await store.findTep(tepId);
    if (!found) {
      throw new Error(
        `TEP-${tepId} not found in this thinking space — nothing to review.`,
      );
    }
    canonicalId = `TEP-${tepId}`;
    subjectKey = `tep:${canonicalId}`;
    docRel = found;
  }
  const dir = resolveControlDir(process.argv[1]);
  await fsSync.promises.mkdir(dir, { recursive: true });
  const docPath = path.join(store.thinkubeDir, docRel);
  const file = path.join(dir, openReviewRequestFile(subjectKey));
  // Same wire format as `serializeControlRequest` (a JSON line). The shape is
  // written raw here because the `open-review` request kind is host-bridge
  // surface: `parseControlRequest`'s union grows it on the host side.
  await fsSync.promises.writeFile(
    file,
    JSON.stringify({
      kind: "open-review",
      subjectKind: kind,
      id: canonicalId,
      subjectKey,
      docPath,
      thinkingSpaceDir: store.thinkubeDir,
    }) + "\n",
    "utf8",
  );
  return { ok: true, subjectKey, docPath, request: file };
}

// Org-scoped tree: a slice file is `<org>/teps/TEP-n/SP-m/SL-k.md`;
// the spec id is the composite `${tep}/${spec}` and its handle is the
// tep-qualified `TEP-n_SP-m`, the slice handle `TEP-n_SP-m_SL-k`.
// All segments are strictly numeric — ids are minted sequentially, and the
// per-maintainer org segment keeps numbers collision-free. Any other id
// shape fails loudly; nothing is quietly tolerated.
const SLICE_PATH_RE = /teps\/TEP-(\d+)\/SP-(\d+)\/SL-(\d+)\.md$/;

/** The tep-qualified handle for a composite spec id (`${tep}/${spec}`). */
function specHandle(specId: string): string {
  const [tep, sp] = specId.split("/");
  return `TEP-${tep}_SP-${sp}`;
}
/** The slice handle from a SLICE_PATH_RE match `[_, tep, spec, slice]`. */
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
  // Terminal, distinct from `done` — read from the shared
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
 * `resolve_project_space` (TEP-6) — derive the project-umbrella thinking space
 * from a session's working directory, so /spec-prepare and /slice can pick the
 * right `thinking_space` AUTOMATICALLY instead of asking. Given an absolute `cwd`,
 * returns the `<product>/projects/<id>` namespace whose umbrella dir contains it
 * (the dir itself or any descendant), else `{ namespace: null, reason }` — the
 * caller then applies an explicit override arg or asks.
 *
 * The match is against the PASSED cwd (the client hands in its own session root);
 * the server never consults `process.cwd()`, preserving the cwd-agnostic invariant
 * (a call can never silently act on the wrong thinking space). Longest umbrella
 * match wins, so a nested project under another project's tree resolves precisely.
 */
export function resolveProjectSpace(ctx: HandlerContext, cwd: string): unknown {
  const root = ctx.env.thinkingSpaceRoot;
  if (!root) return { namespace: null, reason: "no-thinking-space-root" };
  if (!cwd || !path.isAbsolute(cwd))
    return { namespace: null, reason: "cwd-not-absolute" };
  const abs = path.resolve(cwd);
  let best: {
    namespace: string;
    product: string;
    id: string;
    len: number;
  } | null = null;
  for (const p of discoverProjects(root)) {
    const umbrella = path.join(root, p.product, "projects", p.id);
    if (abs === umbrella || abs.startsWith(umbrella + path.sep)) {
      if (!best || umbrella.length > best.len) {
        best = {
          namespace: `${p.product}/projects/${p.id}`,
          product: p.product,
          id: p.id,
          len: umbrella.length,
        };
      }
    }
  }
  if (!best)
    return { namespace: null, reason: "cwd-not-under-project-umbrella" };
  return {
    namespace: best.namespace,
    project: { product: best.product, id: best.id },
  };
}

/**
 * `get_project` — a Project's manifest + its members. A Project is a
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

  // Two distinct axes per member (TEP-6): `thinking_space` = WHERE THE FILE LIVES
  // (the namespace get_thinkube_file/write_spec/create_slice must target); `repo` =
  // the WORKING repository the orchestrator branches a worktree in. For a
  // project-nested member these differ (file under the umbrella, code in `repo:`);
  // for a legacy flat-model member they coincide (both the repo thinking space).
  const members: {
    thinking_space: string;
    repo: string;
    handle: string;
    kind: string;
  }[] = [];
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
      // Legacy flat-model member: the file lives in this repo thinking space, so
      // thinking_space === repo (no separate umbrella).
      members.push({
        thinking_space: b.id,
        repo: b.id,
        handle: specHandle(spec),
        kind: "spec",
      });
      implByTep.get(ref.id)!.push({
        id: specHandle(spec),
        accepted: typeof fm?.accepted === "string" ? fm.accepted : undefined,
        superseded:
          typeof fm?.superseded === "string" ? fm.superseded : undefined,
      });
      // Slices inherit membership from their spec.
      for (const rel of await store.listSlices(spec)) {
        const m = SLICE_PATH_RE.exec(rel);
        if (m)
          members.push({
            thinking_space: b.id,
            repo: b.id,
            handle: sliceHandleFromMatch(m),
            kind: "slice",
          });
      }
    }
  }
  // Org-scoped tree: a project's member specs are NESTED under its umbrella TEPs
  // (`<project>/<org>/teps/TEP-n/SP-m/`) — promote_tep relocated them there. Read
  // them location-based. The FILE lives under the project umbrella, so that is the
  // member's `thinking_space` (what get_thinkube_file/write_spec/create_slice must
  // target); the spec's `repo:` frontmatter is the WORKING repository (where the
  // orchestrator branches a worktree) and is surfaced separately as `repo`. (The
  // cross-thinking space sweep above only catches any legacy flat-model member
  // still living in a repo thinking space with a qualified `implements:`.)
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
      thinking_space: projectNamespace,
      repo: workingRepo,
      handle: specHandle(spec),
      kind: "spec",
    });
    implByTep.get(tep)!.push({
      id: specHandle(spec),
      accepted: typeof fm?.accepted === "string" ? fm.accepted : undefined,
      superseded:
        typeof fm?.superseded === "string" ? fm.superseded : undefined,
    });
    for (const rel of await projStore.listSlices(spec)) {
      const m = SLICE_PATH_RE.exec(rel);
      if (m)
        members.push({
          thinking_space: projectNamespace,
          repo: workingRepo,
          handle: sliceHandleFromMatch(m),
          kind: "slice",
        });
    }
  }

  // Completeness: a TEP is complete only when every implementing
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

// ─── TEP-lifecycle gate wiring ──────────────────────────────────
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
          superseded:
            typeof fm?.superseded === "string" ? fm.superseded : undefined,
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
 * `promote_tep` — move a repo TEP into an existing project's `teps/`
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
        // Org-scoped tree: a TEP is the dir `<org>/teps/TEP-n/`
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

// (Slice-handle parsing lives in refResolver.resolveSliceRef — one grammar for
// every tool: `TEP-1_SP-4_SL-1`, `SP-4_SL-1`, `1/4/1`.)

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
  const { specNumber, sliceNumber } = await resolveSliceRef(
    () => store.listSpecDirs(),
    handle,
  );
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
  return {
    relativePath: rel,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
  };
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
  const { specNumber, sliceNumber } = await resolveSliceRef(
    () => store.listSpecDirs(),
    handle,
  );
  const rel = store.pathForSlice(specNumber, sliceNumber);
  const parsed = await store.getFile(rel);
  if (!parsed) throw new Error(`No slice file at ${store.thinkubeDir}/${rel}`);

  // Retire: `move_slice(…, "Retired", reason)` is a TERMINAL state
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
  // Attest the documentation obligation: a caller updating the doc
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

    // → Done docs gate: a `docs: required` slice must have its docs
    // done. Blocking mode refuses (throws before any write); advisory mode lets
    // the move through but returns a warning to surface to the caller.
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

  // Board-artifact hygiene (2026-07-11): a card states its CURRENT state.
  // Returning to Ready auto-prunes the resolved `## ⚑ Requires attention`
  // block(s) + any ⛔ markers (collapsed to one-line `attention_history`
  // entries), clears the `escalated` hold and `last_fault` route, and resets
  // `rework_attempts` — a human/auto hand-back restarts the bounded loop
  // (leaving the old count would re-escalate the slice before it ever ran).
  // `last_evidence_hash` survives deliberately: if the very same failure
  // reappears after a "fix", the circuit breaker should trip immediately.
  let bodyOut = parsed.body;
  if (target === "ready") {
    const { base, blocks } = splitAttentionArtifacts(parsed.body ?? "");
    if (blocks.length > 0 || fm.escalated || fm.rework_attempts) {
      const date = new Date().toISOString().slice(0, 10);
      const prior = Array.isArray(fm.attention_history)
        ? (fm.attention_history as string[])
        : [];
      if (blocks.length)
        fm.attention_history = [
          ...prior,
          ...blocks.map((b) => attentionHistoryEntry(b, date)),
        ];
      delete fm.escalated;
      delete fm.rework_attempts;
      delete fm.last_fault;
      bodyOut = `${base}\n`;
    }
  }
  await store.writeFile(rel, fm, bodyOut);

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

/**
 * Mark a Spec as superseded (SP-6/14) — a deliberate, reason-carrying "not
 * building this" transition. Mirrors {@link acceptSpec}'s read-modify-write
 * through `ThinkubeStore.writeFile` (dispatched under the same write-gate +
 * write-lock). Refuses a blank/whitespace reason (an error whose message names
 * `reason`, mirroring the slice Retire transition); on success stamps
 * `superseded:` (a fresh ISO timestamp) and `superseded_reason:`, leaving the
 * body and every other pre-existing frontmatter key untouched and never writing
 * an `accepted:` key.
 */
async function supersedeSpec(
  store: ThinkubeStore,
  spec: string,
  reason: string,
): Promise<unknown> {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new Error(
      "supersede_spec requires a non-empty `reason` — superseding a Spec must " +
        "record why it is deliberately not being built. Provide a reason and retry.",
    );
  }
  const specRel = store.pathForSpecDoc(spec);
  const specDoc = await store.getFile(specRel);
  if (!specDoc) {
    throw new Error(`No spec at ${specRel} — nothing to supersede.`);
  }
  const superseded = new Date().toISOString();
  await store.writeFile(
    specRel,
    { ...specDoc.frontmatter, superseded, superseded_reason: reason },
    specDoc.body,
  );
  return { ok: true, spec, superseded, superseded_reason: reason };
}

/**
 * Reverse {@link supersedeSpec} (SP-6/14): delete BOTH `superseded` and
 * `superseded_reason` from the Spec's frontmatter, returning it to
 * `tepComplete`'s `openSpecs`. Mirrors how `move_slice` deletes the `accepted:`
 * key when reopening a Done slice — content-preserving.
 */
async function unsupersedeSpec(
  store: ThinkubeStore,
  spec: string,
): Promise<unknown> {
  const specRel = store.pathForSpecDoc(spec);
  const specDoc = await store.getFile(specRel);
  if (!specDoc) {
    throw new Error(`No spec at ${specRel} — nothing to un-supersede.`);
  }
  const {
    superseded: _s,
    superseded_reason: _r,
    ...rest
  } = specDoc.frontmatter ?? {};
  await store.writeFile(specRel, rest as Frontmatter, specDoc.body);
  return { ok: true, spec };
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
  // Delegates to the ONE ref grammar (refResolver). Notable deliberate changes
  // from the pre-2026-07-11 behavior: the flat handle `TEP-1_SP-4` (which every
  // board surface prints) now resolves instead of building a
  // `TEP-TEP-1_SP-4/SP-undefined` path, and an UNKNOWN bare id now refuses
  // loudly instead of passing through verbatim into a phantom
  // `TEP-<id>/SP-undefined` path.
  return resolveSpecRef(listSpecDirs, id);
}

/**
 * Self-locate the approval store dir (SP-6/17) from the server's own invocation path — purely
 * LEXICAL, no `realpath` and no filesystem access. The server binary runs from
 * `…/thinkube.thinkube-tandem/extension-current/dist/mcp/kanbanMcpServer.js`, so walking
 * three segments up (mcp → dist → extension-current) lands at the globalStorage extension dir
 * `…/thinkube.thinkube-tandem` — exactly where the host's Approve button writes tokens.
 * Keeping it lexical preserves the `extension-current` symlink segment (a `realpath` would resolve
 * it into the versioned install and walk out of globalStorage). Invariant to env; unit-testable
 * with a constructed path. Production caller: `createSlice` passes `resolveApprovalDir(process.argv[1])`.
 */
export function resolveApprovalDir(invocationPath: string): string {
  return path.resolve(path.dirname(invocationPath), "../../..");
}

/**
 * Resolve a spec's WORKING repo root for the footprint existence gate: the
 * spec's `repo:` frontmatter resolved via the machine folders (the same
 * resolution `write_spec`'s audit uses), else the thinking-space repo itself.
 * Returns undefined when the resolved path is not a git repo — a bare-tmpdir
 * unit-test store or an unresolvable namespace has no repo reality to check,
 * so the existence gate is skipped rather than refusing valid work.
 */
async function resolveSpecWorkingRepo(
  ctx: HandlerContext,
  store: ThinkubeStore,
  specId: string,
): Promise<string | undefined> {
  const doc = await store
    .getFile(store.pathForSpecDoc(specId))
    .catch(() => undefined);
  const repoNs =
    typeof doc?.frontmatter?.repo === "string"
      ? doc.frontmatter.repo.trim()
      : undefined;
  if (repoNs && ctx.env.thinkingSpaceRoot) {
    // ENFORCEMENT (TEP-14): a declared `repo:` resolves verified or refuses —
    // an unresolvable card no longer silently skips the footprint gate.
    return resolveVerifiedRepo(
      repoNs,
      ctx.env.folders,
      ctx.env.thinkingSpaceRoot,
      `spec ${specId} \`repo:\``,
    );
  }
  // No `repo:` (same-repo spec / bare test store): the thinking-space repo
  // itself, when it is a git repo; else no gate target.
  const resolved = store.workspaceRoot;
  return resolved && fsSync.existsSync(path.join(resolved, ".git"))
    ? resolved
    : undefined;
}

/** Shell builtins/keywords the probe dry-run never tries to resolve. */
const SHELL_BUILTINS = new Set([
  "cd",
  "echo",
  "true",
  "false",
  "test",
  "[",
  "exit",
  "export",
  "set",
  "wait",
  "sleep",
  "read",
]);

/**
 * Probe dry-run (2026-07-11): find env-local verification commands whose
 * leading token(s) do NOT resolve to an executable in the working repo. Pure
 * resolution (`command -v`), never execution — safe at spec time. Each
 * `&&`/`||`/`;`-separated segment's first word is checked with the repo's
 * `node_modules/.bin` prepended to PATH (so `npx`-less local binaries still
 * resolve at the root); shell builtins, env-var assignments, subshell noise
 * and anything unparseable are skipped (the check errs open — its job is to
 * catch the plain `tsc`-style miss, not to be a shell parser).
 */
export function unresolvableProbeCommands(
  map: Record<string, { run?: string; env?: string }>,
  cwd: string,
): { ac: string; cmd: string; token: string }[] {
  const out: { ac: string; cmd: string; token: string }[] = [];
  for (const [ac, decl] of Object.entries(map ?? {})) {
    const run = decl?.run?.trim();
    if (!run || decl.env === "assessment" || decl.env === "cluster") continue;
    for (const seg of run.split(/&&|\|\||;/)) {
      let token =
        seg
          .trim()
          .replace(/^[($\s]+/, "")
          .split(/\s+/)[0] ?? "";
      token = token.replace(/[)]+$/, "");
      if (
        !token ||
        SHELL_BUILTINS.has(token) ||
        token.includes("=") ||
        token.includes("$") ||
        token.startsWith("{") ||
        token.startsWith("#")
      )
        continue;
      try {
        execFileSync("sh", ["-c", 'command -v -- "$1"', "sh", token], {
          cwd,
          stdio: "ignore",
          env: {
            ...process.env,
            PATH: `${path.join(cwd, "node_modules", ".bin")}:${process.env.PATH ?? ""}`,
          },
        });
      } catch {
        out.push({ ac, cmd: run, token });
      }
    }
  }
  return out;
}

/**
 * Real filesystem oracle for the footprint existence gate: existence via
 * `fs.existsSync` against the working repo; did-you-mean candidates from
 * `git ls-files` (tracked files only — fast, ignores node_modules by
 * construction). A git failure degrades to "no suggestions", never to a pass.
 */
function repoFileOracle(repoRoot: string): RepoFileOracle {
  return {
    exists: (rel) => fsSync.existsSync(path.join(repoRoot, rel)),
    listFiles: () => {
      try {
        return execFileSync("git", ["-C", repoRoot, "ls-files"], {
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
        })
          .split("\n")
          .filter(Boolean);
      } catch {
        return [];
      }
    },
  };
}

/**
 * Self-locate the control-request dir (SP-6/20) — the `<globalStorage>/control` folder the host's
 * `ControlRequestWatcher` watches, derived lexically from the server's own invocation path exactly
 * like {@link resolveApprovalDir}. Both `open_review` and `start_spec_worktree` write here, so the
 * derivation retires the old control-dir env var: if present it is ignored, and the tools
 * work in any session — including a project-scope `.mcp.json` that by design carries no machine-local
 * dirs. Pure lexical, no filesystem probing.
 */
export function resolveControlDir(invocationPath: string): string {
  return path.join(resolveApprovalDir(invocationPath), "control");
}

/**
 * Human-approval gate (SP-6/3, TEP-6 mechanism 2): `create_slice` refuses unless the side-channel
 * store at `approvalDir` holds a **valid, content-bound** maintainer approval for this spec.
 * `create_slice` IS the spec→Ready entry point (there is no separate →Ready tool), so refusing here
 * is refusing the transition. The store dir is derived structurally (SP-6/17), so the gate is
 * ALWAYS armed — there is no off state, no fail-open, no env-var skip.
 *
 * - subjectKey is the kind-namespaced `spec:TEP-<tep>/SP-<sp>` — an approval for another subject
 *   (a different spec, or a `tep:` approval) can never satisfy this gate.
 * - contentHash binds the approval to the spec body the maintainer actually reviewed, via the
 *   SAME `approvalContentHash` the Approve mint uses: editing the spec moves the hash, a prior
 *   approval stops verifying, and the review panel re-arms Approve.
 * - `approvalStatus` is pure and never throws; the three surviving checks — signature, subject and
 *   content binding — run in order and yield the first failure's reason. Time is not a rejection
 *   axis (SP-6/11), so there is no expiry: an approval for unchanged content is honored however long
 *   the maintainer took, while a `content-mismatch` reason means the spec changed since approval.
 */
export function assertSpecApprovedForSlicing(
  specId: string,
  specBody: string,
  approvalDir: string,
): void {
  // `specId` is the composite `<tep>/<sp>` here (resolved + existence-checked by the caller).
  const [tep, sp] = specId.split("/");
  const subjectKey = `spec:TEP-${tep}/SP-${sp}`;
  const secret = loadOrCreateApprovalSecret(approvalDir);
  const approvalStore = createApprovalStore(approvalDir);
  const token = approvalStore.get(subjectKey);
  const status = approvalStatus(token, {
    subjectKey,
    contentHash: approvalContentHash(specBody),
    secret,
  });
  if (status.ok) return;
  const approveAction =
    `open the review panel (\`open_review({ kind: "spec", id: "TEP-${tep}/SP-${sp}" })\`) ` +
    `and have the maintainer click **Approve spec** — a UI action the agent cannot take — then retry.`;
  if (token === undefined) {
    throw new Error(
      `Human approval required — no approval is on file for \`${subjectKey}\`. ` +
        `The approval gate is armed and \`create_slice\` is the spec→Ready transition, so it ` +
        `refuses without a maintainer-minted approval token in the side-channel store. To proceed, ${approveAction}`,
    );
  }
  if (status.reason === "content-mismatch") {
    throw new Error(
      `Human approval stale — the approval on file for \`${subjectKey}\` was minted for a different ` +
        `spec body: the spec content changed since it was approved, so the approval no longer covers ` +
        `the CURRENT content. Re-approve the current spec: ${approveAction}`,
    );
  }
  throw new Error(
    `Human approval invalid — the approval on file for \`${subjectKey}\` does not verify: it was ` +
      `minted for a different subject, or it is not signed by this server's approval secret. ` +
      `A foreign token never satisfies the gate; re-approve the CURRENT content: ${approveAction}`,
  );
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
      // Contract-first opt-out. The authoritative field name is the
      // shared `CONTRACT_FIRST_OPTOUT_FIELD` constant (the schema key + what
      // `contractFirstCheck` reads); this literal is the local TS view of it.
      contract_first_optout?: boolean;
    }[];
    priority?: string;
    docs?: string;
    docs_reason?: string;
    tags?: string[];
    // Retired-symbol declaration (SP-6/15): exported symbol names this slice removes
    // or narrows. Serialized to slice frontmatter `retires:` and gated — the slice is
    // refused unless every existing importer of a retired symbol is inside its
    // footprint. Optional/absent on every existing slice (backward-compatible).
    retires?: string[];
    // Declared-new files (2026-07-11): footprint paths this slice CREATES.
    // Exempt from the existence gate (everything else in the footprint must
    // exist in the working repo); serialized to frontmatter `creates:`.
    creates?: string[];
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
  /**
   * The spec's WORKING repo root (its `repo:` frontmatter resolved to a path;
   * the thinking-space repo for a same-repo spec) — what the footprint
   * EXISTENCE gate checks against. `undefined` when no working repo could be
   * resolved (e.g. a unit-test store rooted in a bare tmpdir): the existence
   * gate is then skipped — there is no repo whose reality could be checked —
   * while the lexical containment gate still runs.
   */
  workingRepoRoot?: string,
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

  // Preliminary-control gate: a slice's declared footprint must
  // resolve **repo-relative inside the thinking space's own repo**. An absolute path, a
  // `..`-escaping path, or a different-repo path is structurally invalid — the
  // orchestrated worker runs from the thinking space repo's worktree root and could never
  // legally write it, so the slice would fail orchestration *after* a run is
  // burned. Refuse it at creation, naming the offending path. Both `files:` and
  // every work_unit `footprint` are footprints, so both are checked.
  const declaredFiles = [
    ...(args.files ?? []),
    ...(args.work_units ?? []).flatMap((wu) => wu.footprint ?? []),
    ...(args.creates ?? []),
  ];
  if (declaredFiles.length) {
    const repoCheck = sliceFilesResolveInRepo(
      store.workspaceRoot,
      declaredFiles,
    );
    if (!repoCheck.ok) throw new Error(repoCheck.reason);
  }

  // Existence gate (2026-07-11): a contained-but-nonexistent footprint path
  // fences workers onto a phantom file and every orchestration burns on it.
  // Every footprint path must exist in the WORKING repo (the spec's `repo:`,
  // resolved by the dispatch — NOT store.workspaceRoot, which for a
  // project-member spec is the code-less umbrella) unless declared in
  // `creates:`. Held-out test-unit footprints are exempt — the reserved
  // acceptance-probe files are new by design.
  if (workingRepoRoot) {
    const mustExist = [
      ...(args.files ?? []),
      ...(args.work_units ?? [])
        .filter((wu) => wu.role !== "test")
        .flatMap((wu) => wu.footprint ?? []),
    ];
    if (mustExist.length) {
      const existCheck = sliceFilesExistInRepo(
        workingRepoRoot,
        mustExist,
        args.creates ?? [],
        repoFileOracle(workingRepoRoot),
      );
      if (!existCheck.ok) throw new Error(existCheck.reason);
    }
  }

  // Documentation obligation. Default `required` (fail closed);
  // `n/a` must justify. The rule lives in the methodology gates module.
  const docsResult = resolveDocsObligation({
    docs: args.docs,
    docs_reason: args.docs_reason,
  });
  if (!docsResult.ok) throw new Error(docsResult.reason);

  // Creation-time → Ready gate (opening half): the parent Spec must
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
  args.spec = await resolveCompositeSpecId(
    () => store.listSpecDirs(),
    args.spec,
  );
  const specDoc = await store.getFile(store.pathForSpecDoc(args.spec));
  if (!specDoc) {
    throw new Error(
      `No spec at ${store.thinkubeDir}/${store.pathForSpecDoc(args.spec)} — run /spec-prepare ${args.spec} first.`,
    );
  }
  // Superseded gate (SP-6/14): a retired Spec is not advanceable — `create_slice`
  // IS the spec→Ready path, so a non-empty `superseded:` stamp refuses here (you
  // don't build what you've deliberately superseded). Reversible via
  // `unsupersede_spec`. Checked before the approval/AC gates so the refusal names
  // the actual blocker.
  const supersededStamp = specDoc.frontmatter?.superseded;
  if (
    typeof supersededStamp === "string" &&
    supersededStamp.trim().length > 0
  ) {
    throw new Error(
      `SP-${args.spec} is superseded (${supersededStamp}) and cannot be sliced or ` +
        `advanced to Ready. Run unsupersede_spec ${args.spec} first if you mean to build it.`,
    );
  }
  // Human-approval gate (SP-6/3): the outermost door of → Ready, checked FIRST —
  // before any structural AC/certification gate — so an unapproved spec refuses
  // with the approval error (not a downstream structural one) and no slice file
  // is ever created. Hashes the CURRENT parsed spec body, so an approval minted
  // over what the maintainer reviewed stops verifying the moment the body moves.
  assertSpecApprovedForSlicing(
    args.spec,
    specDoc.body,
    resolveApprovalDir(process.argv[1]),
  );
  const acs = acceptanceCriteriaOrdinals(specDoc.body);
  if (acs.length === 0) {
    throw new Error(
      `SP-${args.spec} has no acceptance criteria (its slices would fail the → Ready gate) — run /spec-prepare ${args.spec} first.`,
    );
  }
  // Reuse the closing gate's serialization (`normalizeAcVerifications`) so the
  // map the gate reads is exactly the one the closing gate's `parseAcVerifications`
  // consumes — one serialization, both ends.
  const rawVerifs = specDoc.frontmatter?.ac_verifications;
  const verifications = normalizeAcVerifications(
    rawVerifs && typeof rawVerifs === "object"
      ? (rawVerifs as Record<string, unknown>)
      : {},
  );
  // Re-audit baseline: the `ac_verifications`
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

  // Runnable-verification precheck. A *declared*
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
  // `include` the `npm test` toolchain compiles — reuse rule). That
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

  // Parallel-group disjointness: a slice joining a
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

  // ONE CODER PER SLICE (tests-first, 2026-07-08): the code side of a slice is a single
  // work unit — the slice is the unit of code scheduling (ACs and probes exist at slice
  // granularity, so a test-driven loop only closes for one accountable coder). A slice
  // authored with more than one `role: code` unit is REFUSED at the door — loudly, never
  // silently reinterpreted. Test units keep their per-AC fan-out.
  {
    const codeUnits = (args.work_units ?? []).filter(
      (u) => ((u as { role?: string }).role ?? "code") !== "test",
    );
    if (codeUnits.length > 1) {
      throw new Error(
        `This slice declares ${codeUnits.length} code work units — the code side of a slice is ONE unit ` +
          `(tests-first, 2026-07-08): one coder owns the whole coherent change with the union footprint ` +
          `and a single task note, and iterates against the slice's probes through the verify tool. ` +
          `Merge the code units into one { footprint: <union, every file spelled out>, execution: "serial", ` +
          `note: <one coherent task> }; keep the role:"test" units per-AC. Parallelism belongs BETWEEN ` +
          `slices (parallel_group with disjoint files), never inside one.`,
      );
    }
  }

  // Authoring-time DAG gate: build the Spec's work-unit DAG —
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

  // Consumes-resolvability gate, resolved GLOBALLY over the Spec's
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
          ...(sfm.work_units as {
            footprint?: string[];
            consumes?: string[];
          }[]),
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

  // Retired-symbol footprint gate (SP-6/15). LAST of the footprint/contract gates:
  // resolve the working-repo root (`store.workspaceRoot` — the SAME root the
  // footprint guard above uses), read its tracked source files, and refuse the slice
  // if any retired exported symbol still has an importer OUTSIDE `declaredFiles` (the
  // union of `files:` + every work_unit `footprint`, computed for the repo-guard
  // above). Zero retired symbols ⇒ short-circuit, so the no-retirement path is
  // unchanged. The decision + violation shape live in `findUncoveredImporters`.
  assertRetiredSymbolsFootprinted(
    store.workspaceRoot,
    args.retires ?? [],
    declaredFiles,
  );

  // Test-impact footprint gate (SP-6/18). LAST of the footprint gates: compute `changedFiles` from
  // the SOURCE (non-test) footprint entries and refuse the slice if any EXISTING test importing one
  // of them sits outside `declaredFiles`. A UNIT test is folded into the footprint; a HELD-OUT probe
  // is retired. No source footprint entry ⇒ short-circuit (no scan). Decision owned by
  // `findUncoveredTests`; this handler only supplies the repo files + turns a non-empty verdict into
  // the refusal (mirroring the retired-symbol gate above).
  assertTestImpactFootprinted(store.workspaceRoot, declaredFiles);

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
  // Stamp an empty `assignee` slot the ownership arbiter later claims.
  fm.assignee = "";
  if (args.satisfies?.length)
    fm.satisfies = [...new Set(args.satisfies)].sort((a, b) => a - b);
  if (args.contract?.trim()) fm.contract = args.contract.trim();
  if (args.work_units?.length)
    fm.work_units = args.work_units as Frontmatter["work_units"];
  // Retired-symbol declaration (SP-6/15): the machine-readable successor to the prose
  // `// Retired: …` contract line. Serialized only when non-empty (absent on every
  // slice that retires nothing); `get_slice` surfaces it verbatim from frontmatter.
  if (args.retires?.length) fm.retires = args.retires;
  // Declared-new files: serialized so a later re-cut / re-run keeps the
  // existence-gate exemption for exactly the files this slice creates.
  if (args.creates?.length) fm.creates = args.creates;
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
 * Write a Spec's `teps/TEP-{t}/SP-{n}/spec.md` into the thinking space (the sidecar namespace),
 * creating it if absent. The thinking space-aware write path for `/spec-prepare`: a raw file write resolves against the session cwd (the code repo), not
 * the thinking space, so spec authoring must go through the store like slice creation does.
 * Existing frontmatter is preserved — only the markdown body is replaced.
 */
export async function writeSpec(
  store: ThinkubeStore,
  spec: string,
  /** The full replacement body — or `undefined` for a CERTIFY-ONLY call (`/spec-prepare` step 7's
   *  `write_spec { spec, ac_verifications }` shape): the spec must already exist, and its on-disk
   *  body is certified as-is, without the caller re-sending it (no read-modify-write race). */
  body: string | undefined,
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
  const rel = store.pathForSpecDoc(spec);
  const existing = await store.getFile(rel);
  if (body === undefined && existing === undefined) {
    throw new Error(
      `write_spec needs a \`body\` to create SP-${spec} — a body-less call only certifies an EXISTING spec's on-disk body (there is nothing at ${store.thinkubeDir}/${rel} yet).`,
    );
  }
  const trimmed = (body ?? existing!.body).trim();
  if (!trimmed) throw new Error("Spec body must not be empty.");
  // Structural gate: a newly-authored Spec body must carry all
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
  // `implements:` is settable: a bare `TEP-<id>` or a
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
  // `ac_verifications:` — the closing gate's per-AC declaration.
  //
  // Gated on CALLER INTENT (`acVerifications !== undefined`), not on body content: a plain
  // `write_spec({ spec, body })` — the shape `/spec-prepare` step 4 uses to iteratively land a
  // still-evolving draft AC list into the file mid-interview — must NOT trigger the full
  // audit-and-sign machinery. That belongs only to step 7's EXPLICIT, deliberate certifying call
  // (which the skill always shapes as `write_spec { …, ac_verifications: {…} }`), matching the
  // legacy (signing-off) branch below, which already gates on this same param. Before this fix the
  // trigger was `acItems.length > 0` — ANY body containing non-placeholder AC bullets — so an
  // in-progress draft (Design/Constraints not even settled, no `repo:` resolved yet — a real spec
  // hit this under a code-less Project umbrella) unconditionally spawned a live headless audit
  // subprocess and BLOCKED the draft save entirely on its result.
  //
  // This narrowing does not reopen the provenance hole SP-6/1 closed: `readyGate` re-verifies the
  // signature against the Spec's LIVE `acRequirementHash` at GATE-check time (not a write-time
  // stamp), so a later un-certifying body-only edit is still caught there as `invalid-signature` —
  // leaving an existing signed `ac_verifications` untouched on a draft write is safe by
  // construction, never a forgeable path to Ready.
  if (audit !== undefined) {
    // ── Signing on (SP-6/1 / TEP-6): run the audit ourselves, sign only what it produced ──────
    // The agent's `acVerifications` VALUE is *ignored* here — signing a map the agent handed in
    // would only prove the tool wrote it, not that the auditor ran; its mere PRESENCE is the
    // "please certify now" signal (see the gating note above). So when the caller asks to certify
    // we spawn the (injected) verifiability audit, honor its verdict, and sign on pass; an empty AC
    // set / a failing or errored audit refuses (nothing is persisted, since we throw before the
    // write). Editing a Spec that carries no ACs leaves any existing `ac_verifications` untouched.
    const acItems = acceptanceCriteriaItems(trimmed);
    if (acVerifications !== undefined && acItems.length > 0) {
      // INTENT FIDELITY (2026-07-14): hand the auditor the parent TEP — the north
      // star — so a criterion that narrows the TEP's actor/surface into a lower
      // layer is flagged at certification instead of shipping a tricycle. Fail-soft:
      // an unresolvable TEP just audits without the check (as before).
      let tepBody: string | undefined;
      try {
        const tepId =
          (typeof implementsRef === "string" && implementsRef.trim()) ||
          (typeof existing?.frontmatter?.implements === "string"
            ? (existing.frontmatter.implements as string)
            : "");
        const bare = tepId.replace(/^.*:/, "").trim();
        if (bare) {
          const tepDoc = await store.getFile(store.pathForTep(bare));
          tepBody = tepDoc?.body;
        }
      } catch {
        /* fail-soft — audit runs without the intent check */
      }
      const result = await audit.runner({
        acs: acItems,
        specBody: trimmed,
        tepBody,
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
      // Probe dry-run (2026-07-11): never SIGN a command that cannot execute.
      // A bare devDependency binary (`tsc`) exits 127 in every fresh worktree,
      // and a signed-unrunnable probe reads downstream as a phantom code
      // failure. Each env-local command's leading tokens must resolve in the
      // working repo (with node_modules/.bin on PATH); refuse otherwise,
      // naming the token and the repo-local-runner fix.
      const unresolvable = unresolvableProbeCommands(map, audit.cwd);
      if (unresolvable.length) {
        throw new Error(
          `write_spec refused SP-${spec}: derived verification command(s) cannot execute in the working repo — ` +
            unresolvable
              .map((u) => `AC ${u.ac}: \`${u.cmd}\` (\`${u.token}\` not found)`)
              .join("; ") +
            `. Invoke repo-local tools via their runner (npx / uv run / poetry run) or declare them in the repo's worktree setup, then re-certify.`,
        );
      }
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
      // Re-audit stamp: writing `ac_verifications` IS the
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
 * `patch_spec_section` — replace exactly one named section of an
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
  // Re-audit: frontmatter is preserved verbatim, so the
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
 * runnable-verification precheck. The HANDLER owns this parse — not
 * the predicate — so "registered" is single-sourced to the real on-disk test-compile
 * set the toolchain actually uses.
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

/**
 * Source-file extensions whose ES imports the retired-symbol scan reads (SP-6/15).
 * Broad enough to catch every importer a whole-project TS/JS compile would break on
 * when a retired export disappears.
 */
const RETIRE_SCAN_EXTS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

/** Directories the retired-symbol scan never descends — build output, VCS metadata,
 *  and dependencies are not the slice's own source and would drown the scan. */
const RETIRE_SCAN_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  "out-test",
  "build",
  "coverage",
  ".vscode-test",
]);

/**
 * Read the working-repo's tracked source files as `{ path, content }` with
 * repo-relative POSIX paths — the injected `repoFiles` the pure
 * `findUncoveredImporters` scans (SP-6/15). A best-effort recursive walk (no git
 * dependency, so a freshly-seeded probe repo scans identically to a checked-out one)
 * that skips build/VCS/dependency dirs, hidden dirs, and non-source extensions.
 * Unreadable entries are skipped rather than aborting the gate — the check fails
 * toward asking the author to widen the footprint, never toward a hard error on an
 * odd file. The `repoRoot` is the SAME root the footprint guard resolves.
 */
function readRepoSourceFiles(repoRoot: string): RepoFile[] {
  const out: RepoFile[] = [];
  const walk = (absDir: string): void => {
    let entries: fsSync.Dirent[];
    try {
      entries = fsSync.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (RETIRE_SCAN_SKIP_DIRS.has(e.name) || e.name.startsWith(".")) {
          continue;
        }
        walk(path.join(absDir, e.name));
        continue;
      }
      if (!e.isFile()) continue;
      if (!RETIRE_SCAN_EXTS.has(path.extname(e.name))) continue;
      const abs = path.join(absDir, e.name);
      let content: string;
      try {
        content = fsSync.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      out.push({
        path: path.relative(repoRoot, abs).split(path.sep).join("/"),
        content,
      });
    }
  };
  walk(repoRoot);
  return out;
}

/**
 * Retired-symbol footprint gate (SP-6/15). After the footprint/repo-guard and
 * contract-first gates, refuse a slice whose declared `retires` symbols still have
 * importers OUTSIDE its footprint — the reverse-dependency blast radius TEP-6's
 * load-bearing footprint left uncheckable until now. Because the symbol being removed
 * and every file that references it are already on disk, a static scan finds them all
 * before orchestration. The verdict is the pure `findUncoveredImporters` (repo files
 * injected, decision owned there); a NON-EMPTY result TOTALLY refuses the write,
 * naming each retired symbol and its uncovered importer path so the author widens the
 * footprint (adds the file) or drops the symbol from `retires`. Empty/absent `retires`
 * short-circuits with no scan and no disk read — the no-retirement path is
 * byte-for-byte today's behaviour.
 */
function assertRetiredSymbolsFootprinted(
  repoRoot: string,
  retiredSymbols: string[],
  footprintPaths: string[],
): void {
  if (retiredSymbols.length === 0) return; // short-circuit: no scan, no disk read
  const violations = findUncoveredImporters({
    retiredSymbols,
    footprintPaths,
    repoFiles: readRepoSourceFiles(repoRoot),
  });
  if (violations.length === 0) return;
  const lines = violations
    .map(
      (v) =>
        `  • retired symbol \`${v.symbol}\` is still imported by \`${v.importer}\``,
    )
    .join("\n");
  throw new Error(
    `Refusing the slice: a retired symbol still has importer(s) OUTSIDE the slice's ` +
      `footprint — removing it would break every file below at whole-project compile ` +
      `time, and no work unit owns them. Add each importer to the slice's \`files\` / ` +
      `a work_unit \`footprint\` (so the slice edits it), or drop the symbol from ` +
      `\`retires\`:\n${lines}`,
  );
}

/** A footprint entry is a TEST iff (normalized) it is under `src/acceptance/` or ends in a
 *  `.test.[cm]?[jt]sx?` extension — the SAME rule the pure `findUncoveredTests` applies to a repo
 *  file. Its complement (the SOURCE files) is the change's `changedFiles`. Kept a one-liner here so
 *  the wiring can split the footprint without re-importing the detector's internals. */
function isTestFootprintPath(p: string): boolean {
  const n = p.replace(/\\/g, "/").replace(/^\.\//, "");
  return n.startsWith("src/acceptance/") || /\.test\.[cm]?[jt]sx?$/.test(n);
}

/**
 * Author-time test-impact footprint gate (SP-6/18). After the footprint/contract-first/retired-symbol
 * gates, refuse a slice whose change's TEST blast-radius isn't in scope: `changedFiles` are the
 * SOURCE (non-test) footprint entries, and any EXISTING test that imports one of them but is NOT in
 * the footprint is a violation. The verdict is the pure `findUncoveredTests` (repo files injected,
 * decision owned there); a NON-EMPTY result TOTALLY refuses the write with `buildTestImpactRefusal`'s
 * per-violation lines — a UNIT test is folded into the footprint (the code-author updates it), a
 * HELD-OUT probe is retired in a deletion unit (never pulled into a code footprint, TEP-6 mechanism
 * 5). No source footprint entry ⇒ no blast radius ⇒ short-circuit with no scan and no disk read.
 */
function assertTestImpactFootprinted(
  repoRoot: string,
  footprintPaths: string[],
): void {
  const changedFiles = footprintPaths.filter((p) => !isTestFootprintPath(p));
  if (changedFiles.length === 0) return; // no source change ⇒ no test blast radius, no scan
  const violations = findUncoveredTests({
    changedFiles,
    footprintPaths,
    repoFiles: readRepoSourceFiles(repoRoot),
  });
  if (violations.length === 0) return;
  throw new Error(
    `Refusing the slice: the change's test blast-radius is not in scope — existing test(s) import a ` +
      `source file this slice changes, and no work unit owns them, so they would break at the closing ` +
      `gate OUTSIDE any worker's footprint. Fold each UNIT test into the slice's \`files\` / a ` +
      `work_unit \`footprint\`; retire each HELD-OUT probe in a deletion unit (never footprint a ` +
      `held-out probe):\n${buildTestImpactRefusal(violations)}`,
  );
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
  // Retired-symbol declaration (SP-6/15): exported symbol names the re-cut removes or
  // narrows. Provided replaces the slice's `retires:` frontmatter (empty clears it);
  // omitted (`undefined`) leaves it untouched — the same replace/omit discipline the
  // re-cut footprint fields follow. Gated against the working-repo's importers before
  // the write, identically to `create_slice`.
  retires?: string[],
  // The spec's WORKING repo root for the footprint existence gate (see
  // createSlice) — undefined skips that gate.
  workingRepoRoot?: string,
): Promise<unknown> {
  const { specNumber, sliceNumber } = await resolveSliceRef(
    () => store.listSpecDirs(),
    handle,
  );
  const rel = store.pathForSlice(specNumber, sliceNumber);
  const parsed = await store.getFile(rel);
  if (!parsed) throw new Error(`No slice file at ${store.thinkubeDir}/${rel}`);

  // Tags are settable/replaceable via update: when provided, set the
  // `tags` frontmatter (an empty array clears them); omitted → frontmatter as-is.
  let nextFm: Frontmatter | undefined =
    tags === undefined
      ? parsed.frontmatter
      : { ...(parsed.frontmatter ?? {}), tags };

  // Re-cut: REPLACE the slice's footprint fields (files / satisfies
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

    // Existence gate (2026-07-11), identical to create_slice: the re-cut's
    // resulting footprint must exist in the WORKING repo except declared-new
    // (`creates:`) files and held-out test-unit footprints. Checked over the
    // RESULTING frontmatter so an unchanged field keeps its prior validation.
    if (workingRepoRoot) {
      const wus = (nextFm.work_units ?? []) as {
        footprint?: string[];
        role?: string;
      }[];
      const mustExist = [
        ...(Array.isArray(nextFm.files) ? (nextFm.files as string[]) : []),
        ...wus
          .filter((wu) => wu?.role !== "test")
          .flatMap((wu) => wu?.footprint ?? []),
      ];
      if (mustExist.length) {
        const existCheck = sliceFilesExistInRepo(
          workingRepoRoot,
          mustExist,
          (nextFm.creates as string[] | undefined) ?? [],
          repoFileOracle(workingRepoRoot),
        );
        if (!existCheck.ok) throw new Error(existCheck.reason);
      }
    }
  }

  // Retired-symbol footprint gate (SP-6/15). After the re-cut repo guard — resolve
  // the working-repo root (`store.workspaceRoot`, the SAME root the guard uses), read
  // its tracked source, and refuse the re-cut if any retired exported symbol still has
  // an importer OUTSIDE the slice's footprint. The footprint union is taken from the
  // RESULTING frontmatter (post-re-cut `files:` + every work_unit `footprint`) so a
  // re-cut that widens the footprint to cover the importer is accepted. `undefined`
  // retires leaves `retires:` untouched and runs no scan; a provided (even empty)
  // array replaces it — empty clears and short-circuits the gate.
  if (retires !== undefined) {
    const base: Frontmatter = { ...(nextFm ?? parsed.frontmatter ?? {}) };
    const wus = (base.work_units ?? []) as { footprint?: string[] }[];
    const footprintPaths = [
      ...(Array.isArray(base.files) ? (base.files as string[]) : []),
      ...wus.flatMap((wu) => wu?.footprint ?? []),
    ];
    assertRetiredSymbolsFootprinted(
      store.workspaceRoot,
      retires,
      footprintPaths,
    );
    if (retires.length) base.retires = retires;
    else delete base.retires;
    nextFm = base;
  }

  // Test-impact footprint gate (SP-6/18). On a re-cut (the footprint fields were replaced), refuse
  // the re-cut whose changed SOURCE files have existing test importers OUTSIDE the post-re-cut
  // footprint — the same door `create_slice` runs, taken over the RESULTING frontmatter so a re-cut
  // that widens the footprint to fold in the impacted test is accepted. A pure metadata update (no
  // re-cut) leaves the footprint untouched and skips the gate.
  if (reCut) {
    const base: Frontmatter = { ...(nextFm ?? parsed.frontmatter ?? {}) };
    const wus = (base.work_units ?? []) as { footprint?: string[] }[];
    const footprintPaths = [
      ...(Array.isArray(base.files) ? (base.files as string[]) : []),
      ...wus.flatMap((wu) => wu?.footprint ?? []),
    ];
    assertTestImpactFootprinted(store.workspaceRoot, footprintPaths);
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
 * Omit `tep` to mint the thinking space's next sequential id; pass it to update an
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

  // #14 — promotion-aware target. Once a TEP is promoted into a
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
  // If the CALLER's own `thinking_space:` argument already resolved `store` to a
  // specific project's own store (its root IS `<product>/projects/<id>`), that
  // project is authoritative for its own TEP ids — a bare "TEP-1" existing in some
  // OTHER, unrelated project must never veto this write (TEP numbers are scoped
  // per-project, exactly like Spec numbers are scoped per-TEP; see
  // `resolveTepWritePath`'s doc for the full rationale).
  const callerProject = thinkingSpaceRoot
    ? projects.find(
        (p) =>
          path.resolve(store.workspaceRoot) ===
          path.resolve(thinkingSpaceRoot, p.product, "projects", p.id),
      )
    : undefined;
  const dest = resolveTepWritePath(
    tepId,
    projects,
    callerProject && { product: callerProject.product, id: callerProject.id },
  );
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
