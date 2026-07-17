// src/scratchpad/session.ts — the held Scratchpad session (TEP-21/SP-3).
import * as vscode from "vscode";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";

import { emptyModel, reduce } from "./model";
import type { Action, Delta, SectionKind, WorkingModel } from "./model";
import { deserialize, serialize } from "./persistence";
import {
  explainer,
  gapFiller,
  integrator,
  linker,
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
import { interpret } from "./workers/interpreter";
import { freeze as doFreeze } from "./freeze";
import { projectDelta, projectCut } from "./projection";
import type { ApprovalToken, SigningTool } from "./freeze";
export type { SigningTool } from "./freeze";
import { toReadinessRecord, makeProductionRunSlicer } from "./dryRunSlice";
import type { DryRunResult, SlicerVerdict } from "./dryRunSlice";
import { makeServerSigningTool } from "./freeze";
import { ThinkubeStore } from "../store/ThinkubeStore";
import { workerLogEnabled } from "../services/workerLog";
import { showFreshMarkdownPreview } from "../commands/freshPreview";
export type { DryRunResult, SlicerVerdict } from "./dryRunSlice";

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
   * Returns at minimum { cleanCut, gapSection } — the session builds the
   * ReadinessRecord from those two fields plus its own coverage check.
   * Typed as SlicerVerdict (not the full DryRunResult) so injected fakes that
   * omit the `decomposition` field are structurally assignable.
   */
  runSlicer?: (intent: string) => Promise<SlicerVerdict>;
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

/**
 * Lazy "Thinkube Scratchpad" output channel — created on first logged line,
 * and only when `thinkube.workers.logToOutput` is enabled (config read live,
 * so toggling works without a reload). Worker streams are debugging gold but
 * must never occupy the Output panel by default.
 */
let _scratchpadChannel: vscode.OutputChannel | undefined;
function scratchpadLog(line: string): void {
  if (!workerLogEnabled()) return;
  try {
    _scratchpadChannel ??=
      vscode.window.createOutputChannel("Thinkube Scratchpad");
    _scratchpadChannel.appendLine(line);
  } catch {
    /* headless test host — no output channel */
  }
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
    ((intent: string) => Promise<SlicerVerdict>) | undefined;
  private readonly _signing: SigningTool | undefined;
  private _view: ScratchpadDocumentView | undefined;

  /** Tracks whether any worker round is currently in flight. */
  private _roundInFlight = false;
  /** Debounce timer for the automatic integrator round. */
  private _integratorDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  /** Current round activity (for panel rendering). */
  private _roundActivity: RoundActivity | undefined;
  /** Whether a command interpretation round is currently in flight. */
  private _commandInFlight = false;
  /** Ephemeral UI selection (item ids) — the first step of the two-step
   *  destructive flow. Never persisted; pruned of dead ids on apply. */
  private _selection: Set<string> = new Set();
  /** Ephemeral dependency-focus item id (transient inspection highlight). */
  private _focusItemId: string | undefined;
  /** The CUT (third selection channel, 2026-07-16 redesign): element ids
   *  selected to ship as the next TEP. Ephemeral until frozen. */
  private _cut: Set<string> = new Set();
  /** The last command error/explanation message (cleared on the next command attempt). */
  private _commandMessage: string | undefined;

  constructor(
    model: WorkingModel,
    sidecarRoot: string | undefined,
    namespace: string,
    space: string,
    workerModelId: string,
    loadQueryFn: () => QueryFn,
    dossier?: DossierStore,
    now?: () => Date,
    runSlicer?: (intent: string) => Promise<SlicerVerdict>,
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
    // Backstop: the reducer throws on runtime-invalid data (unknown action
    // type, unknown section/item id). Upstream seams normalize worker output,
    // but nothing invalid may EVER crash a round or reach the webview as a raw
    // error — convert any residual throw into a rejected delta (model unchanged).
    let model: WorkingModel;
    let delta: Delta;
    try {
      ({ model, delta } = reduce(this._model, action));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[dispatch] reducer threw for action.type=${(action as { type?: string }).type}: ${reason}`,
      );
      model = this._model;
      delta = { kind: "rejected", action, reason };
    }
    this._model = model;
    this._deltas.push(delta);
    // Notify listeners
    for (const listener of this._listeners) {
      listener(this._model);
    }
    // Push updated model into the open panel (with current round activity + command state)
    if (this._view) {
      this._view.update(
        this._model,
        this._roundActivity,
        this._commandMessage,
        this._commandInFlight,
        [...this._selection],
        this._focusItemId,
        [...this._cut],
      );
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
    return buildScratchpadHtml(
      this._model,
      undefined,
      this._roundActivity,
      this._commandMessage,
      this._commandInFlight,
      [...this._selection],
      this._focusItemId,
      [...this._cut],
    );
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
      // With a cut active, the curated intent is synthesized for the CUT —
      // it describes the upcoming TEP, not the whole space.
      const scope =
        this._cut.size > 0
          ? { itemIds: this._cutClosureIds() }
          : undefined;
      const worker = reframe(
        {
          loadQuery: this._loadQueryFn,
          model: this._workerModelId,
        },
        scope,
      );
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
        if (
          (message.facet !== "complexity" && message.facet !== "risk") ||
          ![1, 2, 3].includes(message.value)
        ) {
          break;
        }
        if (
          (message.facet !== "complexity" && message.facet !== "risk") ||
          ![1, 2, 3].includes(message.value)
        ) {
          break;
        }
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
      case "explainItem": {
        // Targeted re-explain for one item (the bulk path is explainAll).
        const secOfItem = this._model.sections.find((s) =>
          s.items.some((it) => it.id === message.itemId),
        );
        if (!secOfItem) break;
        await this._runWorkerRound("explain", [secOfItem.kind], async () => {
          const worker = explainer(
            { loadQuery: this._loadQueryFn, model: this._workerModelId },
            [message.itemId],
          );
          return worker.run(this._model, []);
        });
        break;
      }
      case "explainAll": {
        // ONE round annotates every active item that has no note yet —
        // never a round per item (field refinement 2026-07-16).
        const targets: string[] = [];
        const kinds = new Set<SectionKind>();
        // Only a Why-shaped note counts as an explanation — research findings
        // and other annotations must not exempt an item from explanation
        // (field defect 2026-07-16: items with notes but no Why were skipped).
        const hasExplanation = (notes: { text: string }[]): boolean =>
          notes.some((n) => /^\s*Why\s*:/i.test(n.text));
        for (const sec of this._model.sections) {
          if (sec.kind === "goal") continue;
          for (const it of sec.items) {
            if (it.state === "active" && !hasExplanation(it.notes)) {
              targets.push(it.id);
              kinds.add(sec.kind);
            }
          }
        }
        if (targets.length === 0) {
          this._commandMessage =
            "Every active item already carries an explanation.";
          this._updatePanel();
          break;
        }
        await this._runWorkerRound("explain", [...kinds], async () => {
          // Verify-and-retry (field defect 2026-07-16: partial coverage
          // landed silently as success): run once, compute the targets the
          // worker actually covered from its returned actions, retry the
          // missed ones ONCE, then let the honest count surface below.
          const worker = explainer(
            { loadQuery: this._loadQueryFn, model: this._workerModelId },
            targets,
          );
          const actions = await worker.run(this._model, []);
          const covered = new Set(
            actions
              .filter((a) => a.type === "addItemNote")
              .map((a) => (a as { itemId: string }).itemId),
          );
          const missed = targets.filter((id) => !covered.has(id));
          if (missed.length === 0) return actions;
          const retry = explainer(
            { loadQuery: this._loadQueryFn, model: this._workerModelId },
            missed,
          );
          try {
            const retryActions = await retry.run(this._model, []);
            return [...actions, ...retryActions];
          } catch {
            // Retry produced nothing usable — land what the first pass got;
            // the honest completion message below names the shortfall.
            return actions;
          }
        });
        // Honest completion report: never let partial coverage read as done.
        const stillMissing = this._model.sections.reduce(
          (n, sec) =>
            sec.kind === "goal"
              ? n
              : n +
                sec.items.filter(
                  (it) =>
                    targets.includes(it.id) &&
                    it.state === "active" &&
                    !hasExplanation(it.notes),
                ).length,
          0,
        );
        this._commandMessage =
          stillMissing === 0
            ? `Explained ${targets.length} item${targets.length === 1 ? "" : "s"}.`
            : `Explained ${targets.length - stillMissing} of ${targets.length} items — ${stillMissing} still lack an explanation (run Explain again, or use the per-item "why?").`;
        this._updatePanel();
        break;
      }
      case "suggestLinks": {
        // One blind round proposes requires edges between existing items —
        // the path for pre-edge spaces whose cuts pull zero context.
        const kinds = new Set<SectionKind>();
        for (const sec of this._model.sections) {
          if (sec.kind !== "goal" && sec.items.length > 0) kinds.add(sec.kind);
        }
        if (kinds.size === 0) break;
        await this._runWorkerRound("link", [...kinds], async () => {
          const worker = linker({
            loadQuery: this._loadQueryFn,
            model: this._workerModelId,
          });
          return worker.run(this._model, []);
        });
        const edges = this._model.sections.reduce(
          (n, sec) =>
            n + sec.items.reduce((m, it) => m + (it.requires?.length ?? 0), 0),
          0,
        );
        this._commandMessage = `Link round done — ${edges} edge${edges === 1 ? "" : "s"} now declared in the space.`;
        this._updatePanel();
        break;
      }
      case "openEvidence": {
        // Evidence chips open their backing artifact: the dossier (rendered
        // markdown) when present, else the source URL.
        try {
          if (message.dossierRef && this._sidecarRoot) {
            const abs = nodePath.join(
              this._sidecarRoot,
              this._namespace,
              message.dossierRef,
            );
            await showFreshMarkdownPreview(vscode.Uri.file(abs));
          } else if (/^https?:\/\//.test(message.source)) {
            await vscode.env.openExternal(vscode.Uri.parse(message.source));
          } else {
            vscode.window.showInformationMessage(
              `Evidence source: ${message.source}`,
            );
          }
        } catch (err) {
          vscode.window.showErrorMessage(
            `Could not open evidence: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        break;
      }
      case "removeNote":
        this.dispatch({
          type: "removeNote",
          actor: "human",
          itemId: message.itemId,
          noteId: message.noteId,
        });
        break;
      case "addRoughRequest": {
        // Append-only journal of raw human asks (2026-07-16 redesign). The
        // FIRST entry seeds the goal — one input, no special first-run
        // ceremony (2026-07-17). Every landed entry immediately triggers an
        // expansion round so the space absorbs it.
        const goalIsEmpty = !(
          this._model.sections.find((s) => s.kind === "goal")?.text ?? ""
        ).trim();
        const delta = goalIsEmpty
          ? this.dispatch({ type: "seedGoal", text: message.text })
          : this.dispatch({ type: "addRoughRequest", text: message.text });
        if (delta.kind === "applied") {
          await this.askForStructure();
        }
        break;
      }
      case "toggleCut": {
        // The CUT — third selection channel: elements selected to ship as
        // the next TEP. Distinct from checked (settled) and staged (verb
        // pending). Only ELEMENT items can enter a cut.
        const inElements = this._model.sections.some(
          (s) =>
            s.kind === "elements" &&
            s.items.some(
              (it) => it.id === message.itemId && it.state === "active",
            ),
        );
        if (!inElements) break;
        if (this._cut.has(message.itemId)) {
          this._cut.delete(message.itemId);
        } else {
          this._cut.add(message.itemId);
        }
        this._updatePanel();
        break;
      }
      case "clearCut":
        this._cut.clear();
        this._updatePanel();
        break;
      case "previewTep": {
        // DRAFT preview (2026-07-16 redesign): render EXACTLY what freeze
        // would sign — same projection, zero side effects (no TEP id, no
        // flags, no stamps). Opens as an untitled markdown document.
        const cutActive = this._cut.size > 0;
        const proj = cutActive
          ? projectCut(this._model, { elementIds: [...this._cut] })
          : projectDelta(this._model);
        const warnings: string[] = [];
        if (cutActive) {
          const cutProj = proj as ReturnType<typeof projectCut>;
          if (cutProj.uncheckedElements.length > 0) {
            warnings.push(
              `${cutProj.uncheckedElements.length} selected element(s) are NOT settled — freeze will refuse until they are checked.`,
            );
          }
          warnings.push(
            `Cut scope: ${cutProj.shipIds.length} element(s) ship; ${cutProj.flagIds.length} context item(s) get flagged and stay live.`,
          );
        }
        const draft =
          `<!-- DRAFT — not signed; nothing shipped or flagged. This preview runs the SAME projection freeze signs. -->\n\n` +
          `# DRAFT TEP — ${proj.title || "(untitled)"}\n\n` +
          (warnings.length > 0
            ? warnings.map((w) => `> ⚠ ${w}`).join("\n") + "\n\n"
            : "") +
          proj.body +
          `\n`;
        try {
          // RENDERED preview, like spec approval (field defect 2026-07-17:
          // an untitled editor demanded "save?" on close). The draft lands in
          // a scratch file (overwritten every preview, never signed) and
          // opens through the same fresh markdown preview the spec flow uses.
          if (this._sidecarRoot) {
            const dir = nodePath.join(
              this._sidecarRoot,
              this._namespace,
              "thinking",
              ".previews",
            );
            await nodeFs.mkdir(dir, { recursive: true });
            const file = nodePath.join(dir, `${this._space}.draft.md`);
            await nodeFs.writeFile(file, draft, "utf8");
            await showFreshMarkdownPreview(vscode.Uri.file(file));
          } else {
            const doc = await vscode.workspace.openTextDocument({
              content: draft,
              language: "markdown",
            });
            await vscode.window.showTextDocument(doc, { preview: true });
          }
        } catch (err) {
          vscode.window.showErrorMessage(
            `Preview failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        break;
      }
      case "toggleDepFocus":
        // Transient dependency-focus highlight (illumination channel —
        // distinct from checked/settled and from staged-for-action).
        this._focusItemId =
          this._focusItemId === message.itemId ? undefined : message.itemId;
        this._updatePanel();
        break;
      // ── Selection flow (2026-07-16): step 1 selects, step 2 applies ──────
      case "toggleSelect":
        if (this._selection.has(message.itemId)) {
          this._selection.delete(message.itemId);
        } else {
          this._selection.add(message.itemId);
        }
        this._updatePanel();
        break;
      case "clearSelection":
        this._selection.clear();
        this._commandMessage = undefined;
        this._updatePanel();
        break;
      case "applySelection": {
        // Apply the chosen verb to every SELECTED item that still exists and
        // is active; the selection is the human's explicit staging area, the
        // click on the verb is the settling act.
        const verbToAction: Record<
          "check" | "uncheck" | "defer" | "drop",
          "checkItem" | "uncheckItem" | "deferItem" | "dropItem"
        > = {
          check: "checkItem",
          uncheck: "uncheckItem",
          defer: "deferItem",
          drop: "dropItem",
        };
        const actionType = verbToAction[message.verb];
        if (!actionType) break;
        const liveIds = new Set(
          this._model.sections.flatMap((s) =>
            s.items
              .filter((it) => it.state === "active")
              .map((it) => it.id),
          ),
        );
        let applied = 0;
        for (const itemId of [...this._selection]) {
          if (!liveIds.has(itemId)) continue;
          this.dispatch({ type: actionType, actor: "human", itemId });
          applied++;
        }
        if (
          this._focusItemId !== undefined &&
          this._selection.has(this._focusItemId) &&
          (message.verb === "drop" || message.verb === "defer")
        ) {
          this._focusItemId = undefined;
        }
        this._selection.clear();
        this._commandMessage =
          applied > 0
            ? `Applied ${message.verb} to ${applied} item${applied === 1 ? "" : "s"}.`
            : "Selection had no live items — nothing applied.";
        this._updatePanel();
        break;
      }
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
        // Guard (2026-07-16): with NOTHING checked, a reframe would rewrite the
        // intent from an empty set — the worker returns a blank and the author's
        // goal is erased (field defect, first real session). Refuse in place.
        if (
          !this._model.sections.some((sec) =>
            (sec.items ?? []).some((it) => it.checked && it.state === "active"),
          )
        ) {
          this._roundActivity = {
            state: "failed",
            targetedKinds: ["goal"],
            errors: {
              goal: "Nothing is settled yet — check at least one item before reframing; the intent is rewritten FROM the checked items.",
            },
          };
          this._updatePanel();
          break;
        }
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
            // Call the slicer directly (not via dryRunSlice) so that the
            // SlicerVerdict type (a minimal subset of DryRunResult) works with
            // injected fakes that omit `decomposition`.
            // The judged text is the goal PLUS the settled (checked, active)
            // items per section — freeze signs the checked items, so judging
            // the bare goal alone could neither see nor explain a
            // section-level gap (2026-07-16).
            const goalSec = this._model.sections.find((s) => s.kind === "goal");
            const lines: string[] = [goalSec?.text ?? ""];
            for (const r of this._model.roughRequests ?? []) {
              lines.push(`\nRough request: ${r.text}`);
            }
            if (this._model.curatedIntent?.trim()) {
              lines.push(`\nCurated intent:\n${this._model.curatedIntent.trim()}`);
            }
            for (const sec of this._model.sections) {
              if (sec.kind === "goal") continue;
              const checked = sec.items.filter(
                (it) => it.checked && it.state === "active",
              );
              if (checked.length > 0) {
                lines.push(`\n${sec.kind} (settled):`);
                for (const it of checked) lines.push(`- ${it.text}`);
              }
            }
            // Unsettled MANDATORY items are disclosed to the judge: modality
            // feeds no hard mechanism (the human stays sovereign over the
            // labels), but the readiness verdict must be able to see and
            // flag a proposed-required item that nobody settled or resolved.
            const unsettledMandatory = this._model.sections.flatMap((sec) =>
              sec.kind === "goal"
                ? []
                : sec.items
                    .filter(
                      (it) =>
                        it.modality === "mandatory" &&
                        it.state === "active" &&
                        !it.checked,
                    )
                    .map((it) => `- [${sec.kind}] ${it.text}`),
            );
            if (unsettledMandatory.length > 0) {
              lines.push(
                `\nUnsettled MANDATORY items (proposed as required, but the human has neither settled nor reclassified them — judge whether the intent is deliverable while these are unresolved):`,
              );
              lines.push(...unsettledMandatory);
            }
            const verdict = await this._runSlicer(lines.join("\n"));
            const record = toReadinessRecord(this._model, verdict);
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
        // Every outcome is SURFACED (field defect 2026-07-16: failures were
        // swallowed silently and success gave no pointer to the created TEP).
        if (this._signing) {
          const approval: ApprovalToken = {
            value: `human-approval-${Date.now()}`,
          };
          try {
            const cut =
              this._cut.size > 0
                ? { elementIds: [...this._cut] }
                : undefined;
            const { tep, itemIds, flagIds } = await doFreeze(
              this._model,
              {
                approval,
                signing: this._signing,
                thinkingSpace: this._space,
              },
              cut,
            );
            this.dispatch({
              type: "stampShipped",
              itemIds,
              tepId: tep,
              ...(flagIds.length > 0 ? { flagIds } : {}),
            });
            this._cut.clear();
            await this.flush();
            vscode.window.showInformationMessage(
              cut
                ? `${tep} created from the cut: ${itemIds.length} element(s) shipped, ${flagIds.length} context item(s) flagged (still live for future cuts).`
                : `${tep} created (status: proposed) — it is now in this thinking space's TEPs panel.`,
            );
            // Best-effort tree refresh so the new TEP is visible immediately.
            void vscode.commands
              .executeCommand("thinkube.thinkingSpace.refresh")
              .then(undefined, () => undefined);
          } catch (err) {
            vscode.window.showErrorMessage(
              `Freeze failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        } else {
          vscode.window.showErrorMessage(
            "Freeze unavailable: no signing tool is wired. Set THINKUBE_SIGNING_KEY_DIR and reload the window.",
          );
        }
        break;
      case "command": {
        // SL-5: interpret the utterance, dispatch returned actions, render message.
        const utterance = message.utterance;
        // Round-trigger commands (field request 2026-07-16): worker rounds are
        // not expressible as item actions, so the interpreter's gate can never
        // reach them — recognize them deterministically here instead.
        const lowered = utterance.trim().toLowerCase();
        if (lowered === "reframe" || lowered.startsWith("reframe ")) {
          this._commandMessage = undefined;
          this._updatePanel();
          await this.postFromWebview({ type: "reframe" });
          break;
        }
        if (
          lowered === "check readiness" ||
          lowered === "readiness" ||
          lowered === "dry run" ||
          lowered === "dry-run"
        ) {
          this._commandMessage = undefined;
          this._updatePanel();
          await this.postFromWebview({ type: "checkReadiness" });
          break;
        }
        if (lowered === "clear selection" || lowered === "deselect all") {
          await this.postFromWebview({ type: "clearSelection" });
          break;
        }
        // Clear prior message, mark in-flight, update panel to disable the field.
        this._commandMessage = undefined;
        this._commandInFlight = true;
        this._updatePanel();
        try {
          const result = await interpret(utterance, this._model, {
            loadQuery: this._loadQueryFn,
          });
          // Dispatch all returned actions (each carries actor:"human")
          for (const action of result.actions) {
            this.dispatch(action);
          }
          // Selection-for-action: the command STAGED items — distinct from
          // checking (settling). The verb is applied from the selection bar
          // as a separate human act.
          if (result.selectedItemIds && result.selectedItemIds.length > 0) {
            this._selection = new Set(result.selectedItemIds);
            const n = result.selectedItemIds.length;
            this._commandMessage =
              result.message ??
              `${n} item${n === 1 ? "" : "s"} staged for action — apply a verb from the selection bar (or "clear selection"). Staging is not checking: nothing enters the TEP from this.`;
          } else {
            // Render the message (if any) under the command field
            this._commandMessage = result.message;
          }
        } catch (err) {
          this._commandMessage =
            err instanceof Error ? err.message : String(err);
        } finally {
          this._commandInFlight = false;
          this._updatePanel();
        }
        break;
      }
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
    roundName: string,
    targetedKinds: SectionKind[],
    work: () => Promise<Action[]>,
  ): Promise<void> {
    // Mark as running
    this._roundInFlight = true;
    scratchpadLog(`━━ ${roundName} round starting (targets: ${targetedKinds.join(", ")})`);
    this._roundActivity = {
      targetedKinds,
      errors: {},
      state: "running",
      label: roundName,
    };
    this._updatePanel();

    try {
      const actions = await work();
      // Clear activity BEFORE dispatching actions so that any view.update()
      // triggered by dispatch() already shows the post-round state ("landed"
      // with no running indicator — rendered as data-activity="landed").
      scratchpadLog(`━━ ${roundName} round landed`);
      this._roundActivity = {
        targetedKinds,
        errors: {},
        state: "landed",
        label: roundName,
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
      scratchpadLog(`━━ ${roundName} round FAILED: ${errorMsg}`);
      const errors: Partial<Record<SectionKind, string>> = {};
      for (const kind of targetedKinds) {
        errors[kind] = errorMsg;
      }
      this._roundActivity = {
        targetedKinds,
        errors,
        state: "failed",
        label: roundName,
      };
    } finally {
      // Always clear the in-flight flag (may already be cleared in success path)
      this._roundInFlight = false;
      this._updatePanel();
    }
  }

  /** Ids inside the current cut: the selected elements plus the context their
   *  edges pull in (via projectCut's traversal). Empty set when no cut. */
  private _cutClosureIds(): Set<string> {
    if (this._cut.size === 0) return new Set();
    const proj = projectCut(this._model, { elementIds: [...this._cut] });
    return new Set([
      ...this._cut,
      ...proj.shipIds,
      ...proj.flagIds,
    ]);
  }

  /** Push the current model + round activity + command state into the open panel. */
  private _updatePanel(): void {
    if (this._view) {
      this._view.update(
        this._model,
        this._roundActivity,
        this._commandMessage,
        this._commandInFlight,
        [...this._selection],
        this._focusItemId,
        [...this._cut],
      );
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
    deps?.loadQuery ?? makeProductionQueryFnThunk(workerModel, scratchpadLog);

  // Resolve clock: use injected fake or system clock
  const nowFn: () => Date = deps?.now ?? (() => new Date());

  // Resolve dossier store: use injected store or create the default one
  // rooted at <sidecarRoot>/<namespace>/research/
  const dossierStore: DossierStore | undefined =
    deps?.dossier ??
    (sidecarRoot ? makeDefaultDossierStore(sidecarRoot, namespace) : undefined);

  // Resolve runSlicer: injected fake, or the production blind readiness judge.
  // (Wiring gap found in field use 2026-07-16: without a runSlicer no readiness
  // record can ever be written, so freeze could never enable in production.)
  const runSlicerFn =
    deps?.runSlicer ?? makeProductionRunSlicer(workerModel, scratchpadLog);

  // Resolve signing: injected fake, or the production ThinkubeStore-backed tool
  // (same secret mechanism as spec certification — THINKUBE_SIGNING_KEY_DIR).
  // Left undefined when the env or sidecarRoot is missing; the freeze handler
  // then surfaces a loud, actionable error instead of doing nothing.
  let signingTool = deps?.signing;
  if (!signingTool && sidecarRoot) {
    const keyDir = process.env.THINKUBE_SIGNING_KEY_DIR?.trim();
    if (keyDir) {
      const wsRoot =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? sidecarRoot;
      signingTool = makeServerSigningTool(
        new ThinkubeStore(wsRoot, nodePath.join(sidecarRoot, namespace)),
        keyDir,
      );
    }
  }

  const session = new ScratchpadSessionImpl(
    model,
    sidecarRoot,
    namespace,
    space,
    workerModel,
    loadQueryFn,
    dossierStore,
    nowFn,
    runSlicerFn,
    signingTool,
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
