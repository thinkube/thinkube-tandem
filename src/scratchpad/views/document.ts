import type * as vscode from "vscode";
// Lazy runtime handle (attend 2026-07-15): buildScratchpadHtml must be importable
// from a plain node test; only the panel class touches the live vscode API.
function vs(): typeof vscode {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("vscode") as typeof vscode;
}
import type {
  Item,
  Modality,
  Section,
  SectionKind,
  SectionState,
  WorkingModel,
} from "../model";
import { freezeEnabled } from "../model";
import { uncoveredSections } from "../coverage";

/**
 * The complete inbound message protocol (webview → extension).
 * Every authoring control posts exactly one of these; the session applies
 * each through the one reducer with actor:"human".
 *
 * askStructure is REMOVED. The delta-log feed is REMOVED.
 */
export type ScratchpadInboundMessage =
  | { type: "seedGoal"; text: string }
  | { type: "editGoal"; text: string }
  | { type: "addItem"; sectionId: string; text: string }
  | { type: "toggleItem"; itemId: string; checked: boolean }
  | { type: "editItemText"; itemId: string; text: string }
  | { type: "setModality"; itemId: string; modality: Modality }
  | {
      type: "setEval";
      itemId: string;
      facet: "complexity" | "risk";
      value: 1 | 2 | 3;
    }
  | { type: "deferItem"; itemId: string }
  | { type: "dropItem"; itemId: string }
  | { type: "supersedeItem"; itemId: string; supersedes: string }
  | { type: "resolveEdit"; itemId: string; accept: boolean }
  | { type: "addItemNote"; itemId: string; text: string }
  | { type: "prefill" }
  | { type: "reframe" }
  | { type: "research"; itemId?: string; subject?: string }
  | { type: "checkReadiness" }
  | { type: "freeze" }
  | { type: "command"; utterance: string }
  // ── Selection flow (2026-07-16): destructive verbs are two-step — select
  //    first (command or per-item toggle), then apply over the selection.
  | { type: "toggleSelect"; itemId: string }
  | { type: "clearSelection" }
  | {
      type: "applySelection";
      verb: "check" | "uncheck" | "defer" | "drop";
    };

/** Visual marker for each section state. */
export const STATE_MARKERS: Record<SectionState, string> = {
  empty: "○",
  proposed: "◌",
  shaping: "◑",
  settled: "●",
};

/**
 * Per-section activity state for rendering.
 * "running" — a worker round targeting this section is in flight.
 * "landed"  — the most recent round completed successfully.
 * "failed"  — the most recent round errored.
 */
export type SectionActivity = "running" | "landed" | "failed";

/**
 * Round-level activity: which sections are targeted and what error (if any).
 */
export interface RoundActivity {
  /** Section kinds targeted by the in-flight or just-completed round. */
  targetedKinds: SectionKind[];
  /** Per-kind error messages (present when activity is "failed"). */
  errors: Partial<Record<SectionKind, string>>;
  /** Overall state for all targeted sections. */
  state: SectionActivity;
}

/** Escape HTML special characters. */
function esc(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Render one Item as an <li> with the contract's exact selectors. */
function itemHtml(item: Item, selected = false): string {
  const liAttrs: string[] = [
    `class="item${selected ? " selected" : ""}"`,
    `data-item-id="${esc(item.id)}"`,
    `data-state="${esc(item.state)}"`,
    `data-origin="${esc(item.origin)}"`,
  ];
  if (selected) {
    liAttrs.push(`data-selected="true"`);
  }
  if (item.shippedIn !== undefined) {
    liAttrs.push(`data-shipped-in="${esc(item.shippedIn)}"`);
  }
  if (item.supersedes !== undefined) {
    liAttrs.push(`data-supersedes="${esc(item.supersedes)}"`);
  }
  if (item.supersededBy !== undefined) {
    liAttrs.push(`data-superseded-by="${esc(item.supersededBy)}"`);
  }

  const checkedAttr = item.checked ? " checked" : "";

  // Evals span — only emit data-complexity / data-risk when defined
  const evalsAttrs: string[] = [`class="evals"`];
  if (item.evals.complexity !== undefined) {
    evalsAttrs.push(`data-complexity="${item.evals.complexity}"`);
  }
  if (item.evals.risk !== undefined) {
    evalsAttrs.push(`data-risk="${item.evals.risk}"`);
  }
  const evalsSpan = `<span ${evalsAttrs.join(" ")}></span>`;

  // Pending-edit span
  const pendingEditSpan = item.pendingEdit
    ? `<span class="pending-edit"><del>${esc(item.pendingEdit.oldText)}</del><ins>${esc(item.pendingEdit.newText)}</ins></span>`
    : "";

  // Evidence chips (zero or more)
  const evidenceChips = item.evidence
    .map((ev) => {
      const chipAttrs: string[] = [
        `class="evidence-chip"`,
        `data-method="${esc(ev.method)}"`,
        `data-checked-at="${esc(ev.checkedAt)}"`,
      ];
      if (ev.dossierRef !== undefined) {
        chipAttrs.push(`data-dossier-ref="${esc(ev.dossierRef)}"`);
      }
      return `<span ${chipAttrs.join(" ")}>${esc(ev.source)}</span>`;
    })
    .join("");

  // Per-item human control (refined 2026-07-16): destructive verbs are
  // two-step everywhere — this button only toggles SELECTION; the verb
  // (drop/defer/check/uncheck) is applied from the selection bar as a
  // separate, explicit act. No single gesture can destroy an item.
  const itemControls =
    item.state === "active"
      ? `<span class="item-actions">` +
        `<button class="item-select" title="${
          selected
            ? "Remove from selection"
            : "Select — then apply an action from the selection bar"
        }">${selected ? "deselect" : "select"}</button>` +
        `</span>`
      : "";
  return (
    `<li ${liAttrs.join(" ")}>` +
    `<input type="checkbox" class="item-check"${checkedAttr}>` +
    `<span class="modality" data-modality="${esc(item.modality)}">${esc(item.modality)}</span>` +
    evalsSpan +
    `<span class="item-text">${esc(item.text)}</span>` +
    pendingEditSpan +
    evidenceChips +
    itemControls +
    `</li>`
  );
}

/** Render the goal (intent) section — contains EXACTLY ONE #goal-input. */
function goalSectionHtml(
  section: Section,
  activity?: SectionActivity,
  errorMsg?: string,
  roundInFlight?: boolean,
): string {
  const marker = STATE_MARKERS[section.state];
  const goalWasEmpty = section.text === "";
  const activityAttr =
    activity !== undefined ? ` data-activity="${activity}"` : "";
  const activityClass = activity !== undefined ? ` activity-${activity}` : "";
  const errorHtml =
    errorMsg !== undefined
      ? `<div class="round-error">${esc(errorMsg)}</div>`
      : "";
  const prefillDisabled = roundInFlight ? " disabled" : "";

  return /* html */ `
<section class="section goal-section${activityClass}" data-kind="goal" data-id="${esc(section.id)}"${activityAttr}>
  <div class="section-header">
    <span class="state-marker" title="${esc(section.state)}">${marker}</span>
    <span class="kind-label">goal</span>
    <span class="state-label">${esc(section.state)}</span>
    <button id="prefill-btn" class="worker-btn"${prefillDisabled} onclick="triggerPrefill()">Prefill</button>
    <button id="reframe-btn" class="worker-btn"${prefillDisabled} onclick="triggerReframe()">Reframe</button>
  </div>
  <textarea id="goal-input">${esc(section.text)}</textarea>
  <button onclick="confirmGoal(${JSON.stringify(goalWasEmpty)})">Confirm goal</button>
  ${errorHtml}
</section>`;
}

/** Render a non-goal section as a checklist with add-item controls. */
function checklistSectionHtml(
  section: Section,
  activity?: SectionActivity,
  errorMsg?: string,
  selection?: ReadonlySet<string>,
): string {
  const marker = STATE_MARKERS[section.state];
  // Dropped items are not rendered; all other states show
  const visibleItems = section.items.filter((it) => it.state !== "dropped");
  const itemsHtml =
    visibleItems.length > 0
      ? `<ul class="item-list">${visibleItems
          .map((it) => itemHtml(it, selection?.has(it.id) ?? false))
          .join("")}</ul>`
      : `<ul class="item-list"></ul>`;

  const activityAttr =
    activity !== undefined ? ` data-activity="${activity}"` : "";
  const activityClass = activity !== undefined ? ` activity-${activity}` : "";
  const errorHtml =
    errorMsg !== undefined
      ? `<div class="round-error">${esc(errorMsg)}</div>`
      : "";

  return /* html */ `
<section class="section${activityClass}" data-kind="${esc(section.kind)}" data-id="${esc(section.id)}"${activityAttr}>
  <div class="section-header">
    <span class="state-marker" title="${esc(section.state)}">${marker}</span>
    <span class="kind-label">${esc(section.kind)}</span>
    <span class="state-label">${esc(section.state)}</span>
  </div>
  ${itemsHtml}
  ${errorHtml}
  <div class="add-item-area">
    <input type="text" class="add-item-input" data-section-id="${esc(section.id)}" placeholder="Add item…">
    <button class="add-item-btn" onclick="addItemToSection('${esc(section.id)}')">Add</button>
  </div>
</section>`;
}

/**
 * Build the full Thinking Space HTML from the current working model.
 *
 * Exported so that ScratchpadSession.renderedHtml() returns the exact same
 * string the webview receives.
 *
 * Guarantees:
 *  - Exactly ONE element with id="goal-input".
 *  - Non-goal sections render item checklists with the contract's selectors.
 *  - No delta-log feed.
 *  - No ask-structure button.
 *  - Per-section data-activity states when roundActivity is provided.
 *  - Round errors render inside the targeted section as <div class="round-error">.
 *  - The prefill/reframe buttons carry disabled when a round is in flight.
 *  - The #command-input field renders under the sections; disabled while a command
 *    interpretation is in flight; a <div class="command-error"> appears under the
 *    field when commandMessage is present.
 */
/**
 * Human-readable freeze readiness status — one actionable sentence derived
 * from the same signals as the freeze button's data-reason attribute.
 * Exported for tests.
 */
export function freezeStatusText(
  model: WorkingModel,
  canFreeze: boolean,
): string {
  if (canFreeze) {
    return "Ready to freeze — Freeze signs the checked items into a proposed TEP.";
  }
  const uncovered = uncoveredSections(model);
  if (uncovered.length > 0) {
    const parts = uncovered.map((k) =>
      k === "goal" ? "goal (write the intent text)" : k,
    );
    return `Freeze locked — every section needs at least one CHECKED item; still uncovered: ${parts.join(", ")}.`;
  }
  const hist = model.readinessHistory;
  if (hist.length === 0) {
    return "Freeze locked — coverage is green; run “Check readiness” to get a clean-cut verdict on the intent.";
  }
  const latest = hist[hist.length - 1];
  if (!latest.covered) {
    return "Freeze locked — the last readiness run saw incomplete coverage; re-run “Check readiness” now that items are checked.";
  }
  if (!latest.cleanCut) {
    // Prefer the judge's own explanation (carried in note) — a bare section
    // kind is unactionable, and for the section literally named "gap" it read
    // as nonsense ("found a gap in 'gap'").
    const where = latest.gapSection
      ? ` (${latest.gapSection} section)`
      : "";
    if (latest.note) {
      return `Freeze locked — readiness check${where}: ${latest.note} Re-run “Check readiness” after addressing it.`;
    }
    return latest.gapSection
      ? `Freeze locked — the readiness check flagged the ${latest.gapSection} section as incomplete or ambiguous; settle it and re-run “Check readiness”.`
      : "Freeze locked — the readiness check did not find a clean cut; refine the intent and re-run “Check readiness”.";
  }
  return "Freeze locked — run “Check readiness”.";
}

export function buildScratchpadHtml(
  model: WorkingModel,
  _deltas?: unknown[],
  roundActivity?: RoundActivity,
  commandMessage?: string,
  commandInFlight?: boolean,
  selectedItemIds?: readonly string[],
): string {
  const selection: ReadonlySet<string> = new Set(selectedItemIds ?? []);
  const goalSec = model.sections.find((s) => s.kind === "goal");
  const nonGoalSections = model.sections.filter((s) => s.kind !== "goal");

  // Determine per-section activity and errors from roundActivity
  function sectionActivity(kind: SectionKind): SectionActivity | undefined {
    if (!roundActivity) return undefined;
    if (!roundActivity.targetedKinds.includes(kind)) return undefined;
    return roundActivity.state;
  }
  function sectionError(kind: SectionKind): string | undefined {
    if (!roundActivity) return undefined;
    if (roundActivity.state !== "failed") return undefined;
    return roundActivity.errors[kind];
  }

  // A round is in flight when roundActivity.state === "running"
  const roundInFlight = roundActivity?.state === "running";

  const goalHtml = goalSec
    ? goalSectionHtml(
        goalSec,
        sectionActivity("goal"),
        sectionError("goal"),
        roundInFlight,
      )
    : "";
  const sectionsHtml = nonGoalSections
    .map((s) =>
      checklistSectionHtml(
        s,
        sectionActivity(s.kind),
        sectionError(s.kind),
        selection,
      ),
    )
    .join("\n");

  // Selection bar — the second step of the two-step destructive flow: it
  // appears only while a selection exists, and applying a verb (or clearing)
  // is its own explicit act, separate from selecting.
  const liveSelectedCount = model.sections.reduce(
    (n, s) =>
      n +
      s.items.filter((it) => selection.has(it.id) && it.state === "active")
        .length,
    0,
  );
  const selectionBar =
    liveSelectedCount > 0
      ? `<div id="selection-bar" title="Staged for an action — distinct from checking: nothing here enters the TEP until you check it">
      <span class="selection-count">${liveSelectedCount} item${liveSelectedCount === 1 ? "" : "s"} staged for action</span>
      <button onclick="applySelection('check')">Check</button>
      <button onclick="applySelection('uncheck')">Uncheck</button>
      <button onclick="applySelection('defer')">Defer</button>
      <button class="danger" onclick="applySelection('drop')">Drop</button>
      <button onclick="clearSelection()">Clear</button>
    </div>`
      : "";

  const objectionsHtml =
    model.objections.length > 0
      ? `<section class="objections">
          <h2>Objections</h2>
          ${model.objections
            .map(
              (o) =>
                `<div class="objection ${o.resolved ? "resolved" : "open"}">
                  ${esc(o.text)}${o.resolved ? ' <span class="badge">resolved</span>' : ""}
                </div>`,
            )
            .join("\n")}
        </section>`
      : "";

  // (freeze status text is computed below via freezeStatusText)
  // Freeze control: disabled attribute PRESENT when freezeEnabled is false.
  // data-reason names the FIRST failing signal:
  //   "coverage:<kind>" when a section is uncovered,
  //   "dryrun:<kind>"   when coverage is green but the dry-run found a gap,
  //   ""                when enabled (no failing signal).
  const canFreeze = freezeEnabled(model);
  let freezeReason = "";
  if (!canFreeze) {
    const uncovered = uncoveredSections(model);
    if (uncovered.length > 0) {
      freezeReason = `coverage:${uncovered[0]}`;
    } else {
      // Coverage is green; check the latest readiness record for a dry-run gap.
      const hist = model.readinessHistory;
      if (hist.length > 0) {
        const latest = hist[hist.length - 1];
        if (!latest.cleanCut) {
          freezeReason = latest.gapSection
            ? `dryrun:${latest.gapSection}`
            : "dryrun:unknown";
        }
      } else {
        // No readiness record yet — treat as unchecked (no readiness run done)
        freezeReason = "dryrun:unknown";
      }
    }
  }
  const freezeBtn = canFreeze
    ? `<button id="freeze" data-reason="" onclick="triggerFreeze()">Freeze</button>`
    : `<button id="freeze" disabled data-reason="${esc(freezeReason)}" onclick="triggerFreeze()">Freeze</button>`;

  // Human-visible readiness status — the same signals as data-reason, but as a
  // sentence a person can act on (field defect 2026-07-16: the reason lived only
  // in an invisible DOM attribute, so "what do I do to enable Freeze?" had no
  // answer on the surface).
  const freezeStatus = freezeStatusText(model, canFreeze);

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Thinkube Thinking Space</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; }
    h1 { font-size: 1.2em; margin: 0 0 16px; }
    h2 { font-size: 1em; margin-bottom: 8px; }
    .section { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 12px; padding: 12px; }
    .goal-section { margin-bottom: 16px; }
    .section-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .state-marker { font-size: 1.2em; }
    .kind-label { font-weight: bold; text-transform: capitalize; }
    .state-label { font-size: 0.8em; opacity: 0.7; }
    /* Per-section activity states (class-based to avoid literal attribute strings in CSS) */
    .section.activity-running { border-color: var(--vscode-progressBar-background, #007acc); opacity: 0.85; }
    .section.activity-landed { border-color: var(--vscode-terminal-ansiGreen, #4caf50); }
    .section.activity-failed { border-color: var(--vscode-errorForeground, #f44336); }
    /* Round error block inside the section */
    .round-error { margin-top: 8px; padding: 6px 10px; border-radius: 3px; background: var(--vscode-inputValidation-errorBackground, rgba(244,67,54,0.1)); color: var(--vscode-errorForeground); font-size: 0.85em; }
    /* Worker round buttons */
    .worker-btn { font-size: 0.8em; padding: 2px 8px; border: 1px solid var(--vscode-button-border, var(--vscode-panel-border)); background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); border-radius: 2px; cursor: pointer; }
    .worker-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    #goal-input { width: 100%; min-height: 60px; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px 8px; border-radius: 2px; resize: vertical; }
    .goal-section > button:not(.worker-btn) { margin-top: 8px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; }
    .item-list { list-style: none; margin: 0; padding: 0; }
    .item { display: flex; align-items: flex-start; gap: 6px; padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border); flex-wrap: wrap; }
    .item:last-child { border-bottom: none; }
    .item-check { margin-top: 2px; flex-shrink: 0; }
    .modality { font-size: 0.75em; padding: 1px 5px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); flex-shrink: 0; }
    .evals { font-size: 0.75em; opacity: 0.7; flex-shrink: 0; }
    .item-text { flex: 1; }
    .pending-edit { font-size: 0.85em; width: 100%; margin-left: 18px; }
    .pending-edit del { color: var(--vscode-errorForeground); text-decoration: line-through; }
    .pending-edit ins { color: var(--vscode-terminal-ansiGreen, green); text-decoration: none; }
    .evidence-chip { font-size: 0.75em; padding: 1px 4px; border-radius: 3px; border: 1px solid var(--vscode-panel-border); opacity: 0.8; }
    .add-item-area { display: flex; gap: 8px; margin-top: 8px; }
    .add-item-input { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px 8px; border-radius: 2px; }
    .add-item-btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; }
    .objections { margin-top: 24px; }
    .objection.open { color: var(--vscode-errorForeground); }
    .badge { font-size: 0.75em; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 1px 6px; border-radius: 8px; }
    .research-control { margin-top: 24px; padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
    .research-input-area { display: flex; gap: 8px; margin-top: 8px; }
    #research-input { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px 8px; border-radius: 2px; }
    #research-btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; }
    .freeze-control { margin-top: 24px; padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
    #freeze { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 16px; border-radius: 2px; cursor: pointer; }
    #freeze:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    #freeze:disabled { opacity: 0.5; cursor: not-allowed; }
    .command-control { margin-top: 24px; padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
    .command-input-area { display: flex; gap: 8px; margin-top: 8px; }
    #command-input { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px 8px; border-radius: 2px; }
    #command-input:disabled { opacity: 0.5; cursor: not-allowed; }
    #command-btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; }
    .freeze-controls-row { display: flex; gap: 8px; align-items: center; }
    .freeze-controls-row button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; }
    .freeze-controls-row button:disabled { opacity: 0.5; cursor: not-allowed; }
    .freeze-status { margin-top: 8px; font-size: 0.85em; opacity: 0.85; }
    .item-actions { margin-left: auto; display: inline-flex; gap: 4px; opacity: 0; }
    li.item:hover .item-actions, li.item.selected .item-actions { opacity: 1; }
    .item-actions button { background: transparent; color: var(--vscode-descriptionForeground); border: 1px solid var(--vscode-panel-border); padding: 0 6px; border-radius: 2px; cursor: pointer; font-size: 0.8em; }
    .item-actions button:hover { color: var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }
    /* Selection-for-ACTION (staging) — deliberately distinct from checking
       (the checkbox = settled into the TEP): dashed outline, no fill that
       could read as a settled/accepted state. */
    li.item.selected { outline: 1px dashed var(--vscode-focusBorder); outline-offset: -1px; border-radius: 2px; }
    li.item[data-state="deferred"] { opacity: 0.55; }
    li.item[data-state="deferred"] .item-text::after { content: " (deferred)"; font-size: 0.85em; opacity: 0.8; }
    #selection-bar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 8px; padding: 8px 12px; margin-bottom: 12px; border: 1px solid var(--vscode-focusBorder); border-radius: 4px; background: var(--vscode-editor-background); }
    #selection-bar .selection-count { font-weight: bold; margin-right: 4px; }
    #selection-bar button { background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); border: 1px solid var(--vscode-panel-border); padding: 2px 10px; border-radius: 2px; cursor: pointer; }
    #selection-bar button.danger { color: var(--vscode-errorForeground); border-color: var(--vscode-errorForeground); }
  </style>
  ${commandMessage ? `<style>.command-error { margin-top: 8px; padding: 6px 10px; border-radius: 3px; background: var(--vscode-inputValidation-errorBackground, rgba(244,67,54,0.1)); color: var(--vscode-errorForeground); font-size: 0.85em; }</style>` : ""}
</head>
<body>
  <h1>Thinking Space <span style="opacity:0.5;font-size:0.8em;">${esc(model.phase)}</span></h1>
  ${goalHtml}
  ${selectionBar}
  ${sectionsHtml}
  ${objectionsHtml}
  <section class="research-control">
    <h2>Research</h2>
    <div class="research-input-area">
      <input type="text" id="research-input" placeholder="Investigate a subject… (e.g. &quot;migration strategies&quot;)">
      <button id="research-btn" onclick="triggerResearch()">Research</button>
    </div>
  </section>
  <section class="command-control">
    <h2>Command</h2>
    <div class="command-input-area">
      <input type="text" id="command-input" placeholder="e.g. &quot;accept all constraints&quot;"${commandInFlight ? " disabled" : ""}>
      <button id="command-btn" onclick="submitCommand()"${commandInFlight ? " disabled" : ""}>Run</button>
    </div>
    ${commandMessage ? `<div class="command-error">${esc(commandMessage)}</div>` : ""}
  </section>
  <section class="freeze-control">
    <h2>Freeze</h2>
    <div class="freeze-controls-row">
      <button id="check-readiness" onclick="triggerReadiness()">Check readiness</button>
      ${freezeBtn}
    </div>
    <div class="freeze-status">${esc(freezeStatus)}</div>
  </section>
  <script>
    const vscode = acquireVsCodeApi();

    function confirmGoal(wasEmpty) {
      const textarea = document.getElementById('goal-input');
      const text = textarea ? textarea.value.trim() : '';
      if (!text) return;
      vscode.postMessage({ type: wasEmpty ? 'seedGoal' : 'editGoal', text });
    }

    function addItemToSection(sectionId) {
      const input = document.querySelector('.add-item-input[data-section-id="' + sectionId + '"]');
      const text = input ? input.value.trim() : '';
      if (!text) return;
      vscode.postMessage({ type: 'addItem', sectionId, text });
      if (input) input.value = '';
    }

    function triggerFreeze() {
      vscode.postMessage({ type: 'freeze' });
    }

    function triggerReadiness() {
      vscode.postMessage({ type: 'checkReadiness' });
    }

    function triggerPrefill() {
      vscode.postMessage({ type: 'prefill' });
    }

    function triggerReframe() {
      vscode.postMessage({ type: 'reframe' });
    }

    function triggerResearch() {
      var input = document.getElementById('research-input');
      var subject = input ? input.value.trim() : '';
      if (!subject) return;
      vscode.postMessage({ type: 'research', subject: subject });
      if (input) input.value = '';
    }

    function submitCommand() {
      var input = document.getElementById('command-input');
      var utterance = input ? input.value.trim() : '';
      if (!utterance) return;
      vscode.postMessage({ type: 'command', utterance: utterance });
      if (input) input.value = '';
    }

    // Per-item selection toggle (event delegation, like the checkbox handler)
    document.addEventListener('click', function(e) {
      var target = e.target;
      if (!target || !target.classList) return;
      if (!target.classList.contains('item-select')) return;
      var li = target.closest('li.item');
      if (!li) return;
      var itemId = li.getAttribute('data-item-id');
      if (!itemId) return;
      vscode.postMessage({ type: 'toggleSelect', itemId: itemId });
    });

    function applySelection(verb) {
      vscode.postMessage({ type: 'applySelection', verb: verb });
    }

    function clearSelection() {
      vscode.postMessage({ type: 'clearSelection' });
    }

    // Checkbox toggle handler
    document.addEventListener('change', function(e) {
      var target = e.target;
      if (target && target.classList && target.classList.contains('item-check')) {
        var li = target.closest('li.item');
        if (li) {
          var itemId = li.getAttribute('data-item-id');
          if (itemId) {
            vscode.postMessage({ type: 'toggleItem', itemId: itemId, checked: target.checked });
          }
        }
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Editable document view for the Thinking Space.
 *
 * Non-goal sections render as item checklists. The goal section contains the
 * intent textarea (#goal-input, exactly one). No delta log.
 */
export class ScratchpadDocumentView implements vscode.Disposable {
  private _panel: vscode.WebviewPanel | undefined;
  private _disposables: vscode.Disposable[] = [];

  /**
   * Reveal or create the webview panel.
   *
   * @param extensionUri  Extension URI for resource roots.
   * @param model         The current working model.
   * @param onMessage     Handler for inbound webview messages.
   */
  show(
    extensionUri: vscode.Uri,
    model: WorkingModel,
    onMessage: (msg: ScratchpadInboundMessage) => void | Promise<void>,
  ): void {
    if (this._panel) {
      this._panel.reveal(vs().ViewColumn.One);
      this._panel.webview.html = buildScratchpadHtml(model);
      return;
    }

    this._panel = vs().window.createWebviewPanel(
      "thinkubeScratchpad",
      "Thinkube Scratchpad",
      vs().ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
        // Keep the DOM alive when the tab hides (2026-07-16): typed-but-unconfirmed
        // text lives only in the DOM until confirm posts it — without retention,
        // switching tabs destroyed the webview and the author's words with it.
        retainContextWhenHidden: true,
      },
    );

    this._panel.webview.html = buildScratchpadHtml(model);

    this._panel.webview.onDidReceiveMessage(
      (msg: ScratchpadInboundMessage) => {
        void onMessage(msg);
      },
      undefined,
      this._disposables,
    );

    this._panel.onDidDispose(
      () => {
        this._panel = undefined;
        this._disposables.forEach((d) => d.dispose());
        this._disposables = [];
      },
      undefined,
      this._disposables,
    );
  }

  /**
   * Push an updated model into the already-open panel, with optional
   * round-activity overlay (running/landed/failed + per-section errors) and
   * optional command-field state (in-flight flag + last error message).
   */
  update(
    model: WorkingModel,
    roundActivity?: RoundActivity,
    commandMessage?: string,
    commandInFlight?: boolean,
    selectedItemIds?: readonly string[],
  ): void {
    if (this._panel) {
      this._panel.webview.html = buildScratchpadHtml(
        model,
        undefined,
        roundActivity,
        commandMessage,
        commandInFlight,
        selectedItemIds,
      );
    }
  }

  dispose(): void {
    this._panel?.dispose();
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
  }
}
