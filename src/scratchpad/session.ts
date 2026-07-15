// src/scratchpad/session.ts — the held Scratchpad session (TEP-21/SP-3).
import * as vscode from "vscode";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";

import { emptyModel, reduce } from "./model";
import type { Action, Delta, SectionKind, WorkingModel } from "./model";
import { deserialize, serialize } from "./persistence";
import {
  gapFiller,
  integrator,
  makeProductionQueryFnThunk,
} from "./workers/worker";
import { reframe } from "./workers/reframe";
import { research, makeDefaultDossierStore } from "./workers/research";
import type { DossierStore, ResearchTarget } from "./workers/research";
export type { DossierStore } from "./workers/research";
import type { QueryFn } from "./workers/worker";
import { createLoop } from "./loop";
import { buildScratchpadHtml, ScratchpadDocumentView } from "./views/document";
import type { RoundActivity, ScratchpadInboundMessage } from "./views/document";
import { freeze as doFreeze } from "./freeze";
import type { ApprovalToken, SigningTool } from "./freeze";
export type { SigningTool } from "./freeze";
import { dryRunSlice, toReadinessRecord } from "./dryRunSlice";
import type { DryRunResult } from "./dryRunSlice";
export type { DryRunResult } from "./dryRunSlice";

// Re-export so callers can import the message type from session / index.
export type { ScratchpadInboundMessage } from "./views/document";

// ===== Public types =====

export interface ScratchpadSessionDeps {
  /**
   * Named document to open (default: "default").
   * Stored at <sidecarRoot>/<namespace>/thinking/<space>.json.
   */
  space?: string;
  /**
   * Repository/project namespace directory under sidecarRoot (default: "default").
   */
  namespace?: string;
  /**
   * Root directory for sidecar files (default: the
   * `thinkube.thinkingSpace.root` setting; when that resolves empty the
   * session runs IN-MEMORY: no file is written and flush() is a no-op).
   */
  sidecarRoot?: string;
  /**
   * Injectable worker query factory (a test injects a fake QueryFn).
   */
  loadQuery?: () => QueryFn;
  /**
   * Non-committing dry-run slicer (wired by SL-4).
   */
  runSlicer?: (intent: string) => Promise<DryRunResult>;
  /**
   * Signing tool for freeze (wired by SL-4).
   */
  signing?: SigningTool;
  /**
   * Research dossier store (wired by SL-3).
   */
  dossier?: DossierStore;
  /**
   * Clock for evidence timestamps (default: () => new Date()).
   */
  now?: () => Date;
  /**
   * Model id passed to workers (default: the
   * `thinkube.orchestrator.workerModel` setting, else "sonnet").
   */
  workerModel?: string;
}

export interface ScratchpadSession {
  /** The live working model — mutated ONLY via dispatch (the one reducer path). */
  readonly model: WorkingModel;
  /**
   * Every action's Delta (applied or rejected), in application order.
   */
  readonly deltas: Delta[];
  /**
   * Apply one action through the pure reducer; appends to deltas, fires
   * onDidChange, updates the open panel, debounce-persists to disk.
   * Returns the applied or rejected Delta.
   */
  dispatch(action: Action): Delta;
  /** Fires after every dispatch with the new model. */
  onDidChange(listener: (model: WorkingModel) => void): { dispose(): void };
  /**
   * The panel's full current HTML (the exact string the webview is given).
   */
  renderedHtml(): string;
  /**
   * Run the GAP-FILLING worker — always gapFiller regardless of model.phase.
   * Every action it yields lands through dispatch.
   * Resolves when the worker's actions are applied.
   */
  askForStructure(): Promise<void>;
  /**
   * Flush pending debounced persistence to disk NOW.
   */
  flush(): Promise<void>;
  /**
   * The panel's REAL inbound path, exposed as a seam.
   * Every inbound webview message routes here and dispatches with actor:"human".
   * Returns after the message is fully applied.
   */
  postFromWebview(message: ScratchpadInboundMessage): Promise<void>;
}

// ===== Module-level state =====

let _session: ScratchpadSessionImpl | undefined;

/**
 * Extension URI needed to create webview panels.
 */
let _extensionUri: vscode.Uri | undefined;

/**
 * Called from registerScratchpadCommands (index.ts) to provide the extension
 * URI for panel creation.
 */
export function _bootstrapExtensionUri(uri: vscode.Uri): void {
  _extensionUri = uri;
}

// ===== Session implementation =====

/**
 * Human-batch trigger types: actions that trigger an automatic integrator
 * round after a debounce delay (SP-21/3 contract).
 */
const HUMAN_BATCH_TRIGGERS = new Set([
  "resolveEdit",
  "editItemText",
  "addItem",
]);

class ScratchpadSessionImpl implements ScratchpadSession {
  private _model: WorkingModel;
  private _deltas: Delta[] = [];
  private readonly _listeners = new Set<(model: WorkingModel) => void>();
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly _sidecarRoot: string | undefined;
  private readonly _namespace: string;
  private readonly _space: string;
  private readonly _loadQueryFn: () => QueryFn;
  private readonly _workerModelId: string;
  private readonly _dossier: DossierStore | undefined;
  private readonly _now: () => Date;
  private readonly _runSlicer:
    ((intent: string) => Promise<DryRunResult>) | undefined;
  private readonly _signing: SigningTool | undefined;
  private _view: ScratchpadDocumentView | undefined;

  /** Tracks whether any worker round is currently in flight. */
  private _roundInFlight = false;
  /** Debounce timer for the automatic integrator round. */
  private _integratorDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  /** Current round activity (for panel rendering). */
  private _roundActivity: RoundActivity | undefined;

  constructor(
    model: WorkingModel,
    sidecarRoot: string | undefined,
    namespace: string,
    space: string,
    workerModelId: string,
    loadQueryFn: () => QueryFn,
    dossier?: DossierStore,
    now?: () => Date,
    runSlicer?: (intent: string) => Promise<DryRunResult>,
    signing?: SigningTool,
  ) {
    this._model = model;
    this._sidecarRoot = sidecarRoot;
    this._namespace = namespace;
    this._space = space;
    this._workerModelId = workerModelId;
    this._loadQueryFn = loadQueryFn;
    this._dossier = dossier;
    this._now = now ?? (() => new Date());
    this._runSlicer = runSlicer;
    this._signing = signing;
  }

  get model(): WorkingModel {
    return this._model;
  }

  get deltas(): Delta[] {
    return this._deltas;
  }

  dispatch(action: Action): Delta {
    const { model, delta } = reduce(this._model, action);
    this._model = model;
    this._deltas.push(delta);
    // Notify listeners
    for (const listener of this._listeners) {
      listener(this._model);
    }
    // Push updated model into the open panel (with current round activity)
    if (this._view) {
      this._view.update(this._model, this._roundActivity);
    }
    // Debounce-persist to disk
    this._scheduleFlush();

    // Schedule automatic integrator round after human-batch actions
    if (HUMAN_BATCH_TRIGGERS.has(action.type) && delta.kind === "applied") {
      this._scheduleIntegratorRound();
    }

    return delta;
  }

  onDidChange(listener: (model: WorkingModel) => void): { dispose(): void } {
    this._listeners.add(listener);
    return {
      dispose: () => {
        this._listeners.delete(listener);
      },
    };
  }

  renderedHtml(): string {
    const allEvidence = this._model.sections.flatMap((s) =>
      s.items.flatMap((it) =>
        it.evidence.map((ev) => `${it.id}:${ev.dossierRef ?? "NO-REF"}`),
      ),
    );
    console.error(
      `[renderedHtml] items with evidence: ${JSON.stringify(allEvidence)}`,
    );
    return buildScratchpadHtml(this._model, undefined, this._roundActivity);
  }

  /**
   * Run the GAP-FILLING worker (gapFiller) on the full model.
   * Wired to the prefill{} message.
   *
   * Per-section activity: ALL non-goal sections + goal are targeted.
   * The prefill button carries disabled while the round is in flight.
   */
  async askForStructure(): Promise<void> {
    await this._runWorkerRound(
      "prefill",
      // Target all non-goal section kinds
      this._model.sections.filter((s) => s.kind !== "goal").map((s) => s.kind),
      async () => {
        const worker = gapFiller({
          loadQuery: this._loadQueryFn,
          model: this._workerModelId,
        });
        const loop = createLoop({ workerFor: () => worker });
        return loop.step(this._model, []);
      },
    );
  }

  /**
   * Run the REFRAME worker.
   * Wired to the reframe{} message.
   *
   * The reframe prompt contains checked items only (no unchecked text).
   * Targets only the goal section (it may produce an editGoal action).
   */
  async runReframe(): Promise<void> {
    await this._runWorkerRound("reframe", ["goal"], async () => {
      const worker = reframe({
        loadQuery: this._loadQueryFn,
        model: this._workerModelId,
      });
      return worker.run(this._model, []);
    });
  }

  /**
   * Run the RESEARCH worker for a specific item or a free subject.
   * Wired to the research{} message.
   *
   * Dossier-first: reads the dossier BEFORE any query round; existing markdown
   * is included verbatim in the prompt. Findings land as unchecked proposals
   * plus evidence chips with method, date, and dossierRef.
   */
  async runResearch(target: ResearchTarget): Promise<void> {
    // Use the injected/default dossier store, or fall back to an in-memory
    // no-op store so research always runs (findings and chips still land).
    const dossier: DossierStore = this._dossier ?? {
      async read(_topic: string) {
        return undefined;
      },
      async write(topic: string, _markdown: string) {
        return { dossierRef: `research/${topic}.md` };
      },
    };

    // Target all non-goal sections (research may propose items to any of them)
    const targetedKinds = this._model.sections
      .filter((s) => s.kind !== "goal")
      .map((s) => s.kind);

    console.error(
      `[runResearch] calling _runWorkerRound, target=${JSON.stringify(target)}`,
    );
    await this._runWorkerRound("research", targetedKinds, async () => {
      console.error(`[runResearch work()] building worker and calling run`);
      const worker = research(
        {
          loadQuery: this._loadQueryFn,
          dossier,
          now: this._now,
          sidecarRoot: this._sidecarRoot,
          namespace: this._namespace,
        },
        target,
      );
      const result = await worker.run(this._model, []);
      console.error(
        `[runResearch work()] run() returned ${result.length} actions`,
      );
      return result;
    });
    console.error(`[runResearch] _runWorkerRound complete`);
    const modelEvidence = this._model.sections.flatMap((s) =>
      s.items.flatMap((it) =>
        it.evidence.map((ev) => `${it.id}:${ev.dossierRef ?? "NO-REF"}`),
      ),
    );
    console.error(
      `[runResearch] after round, model evidence: ${JSON.stringify(modelEvidence)}, total items: ${this._model.sections.reduce((n, s) => n + s.items.length, 0)}`,
    );
    // Flush immediately: the research round writes a dossier to disk, so the
    // model (with evidence chips) must also be persisted now rather than waiting
    // for the 500ms debounce — a host restart in a multi-phase probe would
    // otherwise lose the chips before phase 1 reads them back.
    await this.flush();
  }

  /**
   * Run the INTEGRATOR worker automatically after a debounced human batch.
   * Never runs concurrently with another round.
   */
  private async _runIntegratorRound(): Promise<void> {
    if (this._roundInFlight) {
      // Another round is in flight — skip this automatic trigger.
      return;
    }
    const targetKinds = this._model.sections
      .filter((s) => s.kind !== "goal")
      .map((s) => s.kind);
    await this._runWorkerRound("integrator", targetKinds, async () => {
      const worker = integrator({
        loadQuery: this._loadQueryFn,
        model: this._workerModelId,
      });
      return worker.run(this._model, []);
    });
  }

  async flush(): Promise<void> {
    if (this._debounceTimer !== undefined) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = undefined;
    }
    await this._persistNow();
  }

  /**
   * The REAL inbound path — the same function the webview channel's
   * onDidReceiveMessage invokes. All messages dispatch with actor:"human".
   */
  async postFromWebview(message: ScratchpadInboundMessage): Promise<void> {
    switch (message.type) {
      // ── Intent (goal) ────────────────────────────────────────────────────
      case "seedGoal":
        this.dispatch({ type: "seedGoal", text: message.text });
        break;
      case "editGoal":
        this.dispatch({ type: "editGoal", text: message.text });
        break;

      // ── Item actions (all actor:"human") ─────────────────────────────────
      case "addItem":
        this.dispatch({
          type: "addItem",
          actor: "human",
          sectionId: message.sectionId,
          text: message.text,
          // The message MAY carry a modality; preserve it when present.
          ...((message as { modality?: "mandatory" | "optional" }).modality
            ? {
                modality: (message as { modality?: "mandatory" | "optional" })
                  .modality,
              }
            : {}),
        });
        break;
      case "toggleItem":
        if (message.checked) {
          this.dispatch({
            type: "checkItem",
            actor: "human",
            itemId: message.itemId,
          });
        } else {
          this.dispatch({
            type: "uncheckItem",
            actor: "human",
            itemId: message.itemId,
          });
        }
        break;
      case "editItemText":
        this.dispatch({
          type: "editItemText",
          actor: "human",
          itemId: message.itemId,
          text: message.text,
        });
        break;
      case "setModality":
        this.dispatch({
          type: "setModality",
          actor: "human",
          itemId: message.itemId,
          modality: message.modality,
        });
        break;
      case "setEval":
        this.dispatch({
          type: "setEval",
          actor: "human",
          itemId: message.itemId,
          facet: message.facet,
          value: message.value,
        });
        break;
      case "deferItem":
        this.dispatch({
          type: "deferItem",
          actor: "human",
          itemId: message.itemId,
        });
        break;
      case "dropItem":
        this.dispatch({
          type: "dropItem",
          actor: "human",
          itemId: message.itemId,
        });
        break;
      case "supersedeItem":
        this.dispatch({
          type: "supersedeItem",
          actor: "human",
          itemId: message.itemId,
          supersedes: message.supersedes,
        });
        break;
      case "resolveEdit":
        this.dispatch({
          type: "resolveEdit",
          actor: "human",
          itemId: message.itemId,
          accept: message.accept,
        });
        break;
      case "addItemNote":
        this.dispatch({
          type: "addItemNote",
          actor: "human",
          itemId: message.itemId,
          text: message.text,
        });
        break;

      // ── Worker round triggers ─────────────────────────────────────────────
      case "prefill":
        // Runs gapFiller with the production query (or injected fake).
        await this.askForStructure();
        break;
      case "reframe":
        // Runs reframe worker; prompt carries checked items only.
        await this.runReframe();
        break;
      case "research":
        // Run the research worker for a specific item or a free subject.
        await this.runResearch({
          itemId: message.itemId,
          subject: message.subject,
        });
        break;
      case "checkReadiness":
        // Run the dry-run slicer and record readiness — the ONLY path that
        // writes a ReadinessRecord; freeze enablement reads the latest record.
        if (this._runSlicer) {
          try {
            const dry = await dryRunSlice(this._model, {
              runSlicer: this._runSlicer,
            });
            const record = toReadinessRecord(this._model, dry);
            this.dispatch({ type: "recordReadiness", record });
          } catch {
            // Slicer failure: record as not-ready, clean-cut failed with no gap
            this.dispatch({
              type: "recordReadiness",
              record: { covered: false, cleanCut: false, gapSection: null },
            });
          }
        }
        break;
      case "freeze":
        // The freeze{} message arrival MINTS the ApprovalToken (human-by-construction).
        // Pipeline: assert freezeEnabled → projectDelta → stamp → writeTep(proposed)
        //           → stampShipped → save
        if (this._signing) {
          const approval: ApprovalToken = {
            value: `human-approval-${Date.now()}`,
          };
          try {
            const { tep, itemIds } = await doFreeze(this._model, {
              approval,
              signing: this._signing,
              thinkingSpace: this._space,
            });
            this.dispatch({ type: "stampShipped", itemIds, tepId: tep });
            await this.flush();
          } catch {
            // Freeze failed (not enabled, signing error, etc.) — ignore silently
            // so the panel can surface the reason via the freeze button state.
          }
        }
        break;
      case "command":
        // SL-5 wires this to the interpreter
        break;
    }
  }

  /** Reveal an existing panel or create a new one. */
  revealPanel(): void {
    if (!_extensionUri) {
      return;
    }
    if (!this._view) {
      this._view = new ScratchpadDocumentView();
    }
    this._view.show(_extensionUri, this._model, (msg) =>
      this.postFromWebview(msg),
    );
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Run a named worker round with full activity tracking:
   *  1. Mark round as in-flight (sets data-activity="running" on targeted sections,
   *     disables prefill/reframe buttons).
   *  2. Await the worker; apply every returned action through dispatch.
   *  3. On success: flip targeted sections to data-activity="landed".
   *  4. On error: flip to data-activity="failed", render <div class="round-error">
   *     inside each targeted section.
   *  5. Clear in-flight flag.
   *
   * NEVER runs concurrently: if _roundInFlight is already true, resolves immediately
   * (the automatic integrator path checks before calling; explicit triggers always run).
   */
  private async _runWorkerRound(
    _roundName: string,
    targetedKinds: SectionKind[],
    work: () => Promise<Action[]>,
  ): Promise<void> {
    // Mark as running
    this._roundInFlight = true;
    this._roundActivity = {
      targetedKinds,
      errors: {},
      state: "running",
    };
    this._updatePanel();

    try {
      const actions = await work();
      // Clear activity BEFORE dispatching actions so that any view.update()
      // triggered by dispatch() already shows the post-round state ("landed"
      // with no running indicator — rendered as data-activity="landed").
      this._roundActivity = {
        targetedKinds,
        errors: {},
        state: "landed",
      };
      this._roundInFlight = false;
      // Apply all returned actions (dispatch updates the panel with "landed")
      for (const action of actions) {
        console.error(
          `[_runWorkerRound] dispatching action.type=${action.type}`,
        );
        this.dispatch(action);
      }
      // Final update to ensure the panel reflects the settled landed state
      this._updatePanel();
      return;
    } catch (err) {
      // Mark failed — render error inside each targeted section
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[_runWorkerRound] CAUGHT ERROR: ${errorMsg}`);
      const errors: Partial<Record<SectionKind, string>> = {};
      for (const kind of targetedKinds) {
        errors[kind] = errorMsg;
      }
      this._roundActivity = {
        targetedKinds,
        errors,
        state: "failed",
      };
    } finally {
      // Always clear the in-flight flag (may already be cleared in success path)
      this._roundInFlight = false;
      this._updatePanel();
    }
  }

  /** Push the current model + round activity into the open panel. */
  private _updatePanel(): void {
    if (this._view) {
      this._view.update(this._model, this._roundActivity);
    }
  }

  /**
   * Schedule an automatic integrator round after a debounce period.
   * Each human-batch action resets the timer; the round only fires once the
   * human stops making changes for 800ms.
   */
  private _scheduleIntegratorRound(): void {
    if (this._integratorDebounceTimer !== undefined) {
      clearTimeout(this._integratorDebounceTimer);
    }
    this._integratorDebounceTimer = setTimeout(() => {
      this._integratorDebounceTimer = undefined;
      void this._runIntegratorRound();
    }, 800);
  }

  private _scheduleFlush(): void {
    if (this._debounceTimer !== undefined) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = undefined;
      void this._persistNow();
    }, 500);
  }

  private async _persistNow(): Promise<void> {
    if (!this._sidecarRoot) return;
    const dir = nodePath.join(this._sidecarRoot, this._namespace, "thinking");
    await nodeFs.mkdir(dir, { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(dir, `${this._space}.json`),
      serialize(this._model),
      "utf8",
    );
  }
}

// ===== Public API =====

/**
 * openScratchpad's promise means "the panel IS open": VS Code's tab model
 * reflects createWebviewPanel asynchronously, so resolving before the tab is
 * observable makes the caller see a shown panel that tabGroups does not list yet.
 */
async function awaitPanelVisible(): Promise<void> {
  if (!_extensionUri) return;
  for (let i = 0; i < 40; i++) {
    const open = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .some((t) => t.label === "Thinkube Scratchpad");
    if (open) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * Open (or reveal) the Thinking Space panel bound to the named document.
 *
 * Document path: <sidecarRoot>/<namespace>/thinking/<space>.json
 *
 * Cold-start: if the named document exists it is deserialize()d as the model;
 * else emptyModel("tep") seeds six sections with empty item lists.
 *
 * The command `thinkube.scratchpad.open` calls this with no deps.
 */
export async function openScratchpad(
  deps?: ScratchpadSessionDeps,
): Promise<ScratchpadSession> {
  // Reuse existing session when no deps are provided (panel re-open)
  if (!deps && _session) {
    _session.revealPanel();
    await awaitPanelVisible();
    return _session;
  }

  // Resolve sidecar root
  const sidecarRoot =
    deps?.sidecarRoot ??
    (vscode.workspace
      .getConfiguration("thinkube.thinkingSpace")
      .get<string>("root")
      ?.trim() ||
      undefined);

  const namespace = deps?.namespace ?? "default";
  const space = deps?.space ?? "default";

  // Cold-start: deserialize from named document or start fresh
  let model: WorkingModel = emptyModel("tep");
  if (sidecarRoot) {
    try {
      const text = await nodeFs.readFile(
        nodePath.join(sidecarRoot, namespace, "thinking", `${space}.json`),
        "utf8",
      );
      model = deserialize(text);
    } catch {
      // File not found or unreadable — use the empty model.
    }
  }

  // Resolve worker model id
  const workerModel =
    deps?.workerModel ??
    vscode.workspace
      .getConfiguration("thinkube.orchestrator")
      .get<string>("workerModel") ??
    "sonnet";

  // Resolve loadQuery: use injected fake or production SDK thunk
  const loadQueryFn: () => QueryFn =
    deps?.loadQuery ?? makeProductionQueryFnThunk(workerModel);

  // Resolve clock: use injected fake or system clock
  const nowFn: () => Date = deps?.now ?? (() => new Date());

  // Resolve dossier store: use injected store or create the default one
  // rooted at <sidecarRoot>/<namespace>/research/
  const dossierStore: DossierStore | undefined =
    deps?.dossier ??
    (sidecarRoot ? makeDefaultDossierStore(sidecarRoot, namespace) : undefined);

  const session = new ScratchpadSessionImpl(
    model,
    sidecarRoot,
    namespace,
    space,
    workerModel,
    loadQueryFn,
    dossierStore,
    nowFn,
    deps?.runSlicer,
    deps?.signing,
  );
  _session = session;
  session.revealPanel();
  await awaitPanelVisible();
  return session;
}

/**
 * The session the last openScratchpad created (undefined before the first open).
 */
export function getScratchpadSession(): ScratchpadSession | undefined {
  return _session;
}
