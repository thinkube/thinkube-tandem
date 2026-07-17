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
import { projectCut } from "../projection";

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
  | { type: "resolveItem"; itemId: string }
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
  | { type: "explainItem"; itemId: string }
  | { type: "explainAll" }
  // ── 2026-07-16 redesign ──
  | { type: "addRoughRequest"; text: string }
  | { type: "toggleCut"; itemId: string }
  | { type: "clearCut" }
  | { type: "previewTep" }
  | { type: "openEvidence"; dossierRef?: string; source: string }
  | { type: "suggestLinks" }
  | { type: "removeNote"; itemId: string; noteId: string }
  | { type: "toggleDepFocus"; itemId: string }
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
  /** Human-readable round name for the busy banner ("prefill", "research"…). */
  label?: string;
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

/**
 * Per-item dependency render metadata, derived (never stored) from the
 * requires edges in buildScratchpadHtml.
 */
interface ItemDepMeta {
  /** Edges touching this item (requires + required-by). */
  depCount: number;
  /** How many items depend on THIS one (structural risk signal). */
  dependentsCount: number;
  /** True when a required item is dropped/deferred — the rationale is stale. */
  stale: boolean;
  /** The dropped/deferred dependency texts (for the stale badge title). */
  staleDeps: string[];
  /** Role under the current dependency focus, if any. */
  focusRole?: "focus" | "req" | "dependent" | "dim";
  /** Rendered only on the focused item: its dependencies as chips. */
  chips?: { id: string; text: string; state: string }[];
}

/** Compute dependency render metadata for every item. Pure; exported for tests. */
export function computeDepMeta(
  model: WorkingModel,
  focusItemId?: string,
): Map<string, ItemDepMeta> {
  const byId = new Map<string, Item>();
  const requiredBy = new Map<string, string[]>();
  for (const sec of model.sections) {
    for (const it of sec.items) byId.set(it.id, it);
  }
  for (const it of byId.values()) {
    for (const req of it.requires ?? []) {
      const list = requiredBy.get(req) ?? [];
      list.push(it.id);
      requiredBy.set(req, list);
    }
  }
  const focus = focusItemId !== undefined ? byId.get(focusItemId) : undefined;
  const focusReq = new Set(focus?.requires ?? []);
  const focusDependents = new Set(
    focus !== undefined ? (requiredBy.get(focus.id) ?? []) : [],
  );

  const meta = new Map<string, ItemDepMeta>();
  for (const it of byId.values()) {
    const requires = it.requires ?? [];
    const staleDeps = requires
      .map((id) => byId.get(id))
      .filter(
        (dep): dep is Item =>
          dep !== undefined &&
          (dep.state === "dropped" || dep.state === "deferred"),
      )
      .map((dep) => `${dep.text} (${dep.state})`);
    const m: ItemDepMeta = {
      depCount: requires.length + (requiredBy.get(it.id)?.length ?? 0),
      dependentsCount: requiredBy.get(it.id)?.length ?? 0,
      stale: staleDeps.length > 0,
      staleDeps,
    };
    if (focus !== undefined) {
      if (it.id === focus.id) {
        m.focusRole = "focus";
        m.chips = requires
          .map((id) => byId.get(id))
          .filter((dep): dep is Item => dep !== undefined)
          .map((dep) => ({
            id: dep.id,
            text: dep.text,
            state: dep.state,
          }));
      } else if (focusReq.has(it.id)) {
        m.focusRole = "req";
      } else if (focusDependents.has(it.id)) {
        m.focusRole = "dependent";
      } else {
        m.focusRole = "dim";
      }
    }
    meta.set(it.id, m);
  }
  return meta;
}

/** Render one Item as an <li> with the contract's exact selectors. */
function itemHtml(
  item: Item,
  selected = false,
  dep?: ItemDepMeta,
  isElement = false,
  inCut = false,
  cutRole?: "context" | "context-unsettled",
  isGap = false,
): string {
  const depClass =
    dep?.focusRole !== undefined ? ` dep-${dep.focusRole}` : "";
  const isProtectedItem =
    item.state === "shipped" || (item.flaggedBy?.length ?? 0) > 0;
  const cutClass =
    cutRole === "context"
      ? " cut-context"
      : cutRole === "context-unsettled"
        ? " cut-context unsettled"
        : "";
  const liAttrs: string[] = [
    `class="item${selected ? " selected" : ""}${depClass}${inCut ? " in-cut" : ""}${cutClass}${isProtectedItem ? " protected" : ""}"`,
    `data-item-id="${esc(item.id)}"`,
    `data-state="${esc(item.state)}"`,
    `data-origin="${esc(item.origin)}"`,
  ];
  if (selected) {
    liAttrs.push(`data-selected="true"`);
  }
  if (item.requires !== undefined && item.requires.length > 0) {
    liAttrs.push(`data-requires="${esc(item.requires.join(" "))}"`);
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
  // (probe-contract selectors; the human-visible badges render separately).
  const evalsAttrs: string[] = [`class="evals"`];
  if (item.evals.complexity !== undefined) {
    evalsAttrs.push(`data-complexity="${item.evals.complexity}"`);
  }
  if (item.evals.risk !== undefined) {
    evalsAttrs.push(`data-risk="${item.evals.risk}"`);
  }
  const evalsSpan = `<span ${evalsAttrs.join(" ")}></span>`;

  // Visible eval badges (2026-07-16: the scores were an EMPTY span — on
  // screen and physically invisible). Click cycles 1→2→3 (human setEval;
  // the reducer drops the worker's factor on override). The factor renders
  // in the tooltip so every score answers "based on what".
  const evalBadge = (
    facet: "complexity" | "risk",
    label: string,
    value: 1 | 2 | 3 | undefined,
    factor: string | undefined,
    hint: string | undefined,
  ): string => {
    const title =
      (value === undefined
        ? `${facet}: unset — click to set`
        : `${facet} ${value}${factor ? ` [${factor}]` : " — no factor claimed"} — click to cycle`) +
      (hint ? ` · ${hint}` : "");
    return (
      `<button class="eval-badge ${facet}${value !== undefined ? ` v${value}` : " unset"}${hint ? " hinted" : ""}"` +
      ` data-facet="${facet}" data-value="${value ?? 0}" title="${esc(title)}">${label}${value ?? "·"}</button>`
    );
  };
  // Structural hints: derived signals challenge (or fill in for) claimed scores.
  const riskHint =
    dep !== undefined &&
    dep.dependentsCount >= 2 &&
    (item.evals.risk === undefined || item.evals.risk === 1)
      ? `structurally risky: ${dep.dependentsCount} items depend on this`
      : undefined;
  const complexityHint =
    item.evidence.length === 0 &&
    (item.evals.complexity === 3 || item.evals.risk === 3)
      ? "uncharted: scored 3 with no evidence — research first"
      : undefined;
  const evalBadges =
    item.state === "active"
      ? `<span class="eval-badges">` +
        evalBadge(
          "complexity",
          "C",
          item.evals.complexity,
          item.evalFactors?.complexity,
          complexityHint,
        ) +
        evalBadge("risk", "R", item.evals.risk, item.evalFactors?.risk, riskHint) +
        `</span>`
      : "";

  // Pending-edit span — WITH resolution controls (2026-07-16: resolveEdit was
  // in the vocabulary but no control existed; a proposed edit was undecidable
  // from the surface — sixth capability-without-a-surface find).
  const pendingEditSpan = item.pendingEdit
    ? `<span class="pending-edit"><del>${esc(item.pendingEdit.oldText)}</del><ins>${esc(item.pendingEdit.newText)}</ins>` +
      `<button class="edit-accept" title="Accept the proposed rewrite">accept</button>` +
      `<button class="edit-reject" title="Reject the proposed rewrite">reject</button></span>`
    : "";

  // Evidence chips (zero or more)
  const evidenceChips = item.evidence
    .map((ev) => {
      const chipAttrs: string[] = [
        `class="evidence-chip"`,
        `data-method="${esc(ev.method)}"`,
        `data-checked-at="${esc(ev.checkedAt)}"`,
        `data-source="${esc(ev.source)}"`,
      ];
      if (ev.dossierRef !== undefined) {
        chipAttrs.push(`data-dossier-ref="${esc(ev.dossierRef)}"`);
      }
      // Compact label (field defect 2026-07-17: full paths/URLs rendered as
      // giant unclickable badges): basename/domain, full source in the
      // tooltip, click opens the dossier (rendered) or the URL.
      const label = compactEvidenceLabel(ev.source);
      const openable = ev.dossierRef !== undefined || /^https?:\/\//.test(ev.source);
      const title = `${ev.method} — ${ev.source}${ev.dossierRef ? ` (dossier: ${ev.dossierRef})` : ""}${openable ? " — click to open" : ""}`;
      return `<button ${chipAttrs.join(" ")} title="${esc(title)}">📄 ${esc(label)}</button>`;
    })
    .join("");

  // Per-item human control (refined 2026-07-16): destructive verbs are
  // two-step everywhere — this button only toggles SELECTION; the verb
  // (drop/defer/check/uncheck) is applied from the selection bar as a
  // separate, explicit act. No single gesture can destroy an item.
  const depsButton =
    dep !== undefined && dep.depCount > 0
      ? `<button class="item-deps" title="Highlight this item's dependencies and dependents">⌗${dep.depCount}</button>`
      : "";
  const cutButton =
    isElement && item.state === "active"
      ? `<button class="item-cut" title="${
          inCut
            ? "Remove from the cut (the next TEP's scope)"
            : "Add to the cut — the elements that will ship as the next TEP"
        }">${inCut ? "− cut" : "+ cut"}</button>`
      : "";
  // Protected items (shipped / TEP-flagged) get no staging control: drop and
  // edits are reducer-rejected anyway; supersede is the evolution path.
  const selectButton = isProtectedItem
    ? ""
    : `<button class="item-select" title="${
        selected
          ? "Remove from selection"
          : "Select — then apply an action from the selection bar"
      }">${selected ? "deselect" : "select"}</button>`;
  const resolveButton =
    isGap && item.state === "active"
      ? `<button class="item-resolve" title="Resolve — this question has been ANSWERED (typically after research): closes it as a visible record">resolve</button>`
      : "";
  const itemControls =
    item.state === "active"
      ? `<span class="item-actions">` +
        cutButton +
        depsButton +
        resolveButton +
        `<button class="item-research" title="Research this item — a direction field opens so you can say WHAT to investigate">research</button>` +
        `<button class="item-explain" title="Analyze — attach a Why / Impact / Modality note to inform your decision">why?</button>` +
        selectButton +
        `</span>`
      : "";
  // Cut-context badge: this row was pulled into the cut through the edges.
  const cutContextBadge =
    cutRole === "context"
      ? `<span class="cut-badge" title="Pulled into the cut as context — will be flagged with the TEP on freeze and stay live">in cut (context)</span>`
      : cutRole === "context-unsettled"
        ? `<span class="cut-badge unsettled" title="In the cut's reach but NOT settled — check it to include it; unchecked context is left out of the TEP">in cut reach — unsettled</span>`
        : "";

  // TEP-flag badge: this item is signed context — protected, supersede-only.
  const flagBadge =
    (item.flaggedBy?.length ?? 0) > 0
      ? `<span class="flag-badge" title="Signed context — TEPs were cut under this item: ${esc(item.flaggedBy!.join(", "))}. Protected: immutable, supersede-only, still serves future cuts.">⚑ ${esc(item.flaggedBy!.join(", "))}</span>`
      : "";

  // Stale-rationale badge: a required item was dropped/deferred — the why,
  // impact, and modality of THIS item may no longer hold.
  const staleBadge =
    dep !== undefined && dep.stale
      ? `<span class="stale-badge" title="Rationale may be stale — dependencies changed: ${esc(dep.staleDeps.join("; "))}">⚠ rationale stale</span>`
      : "";

  // Dependency chips render on the FOCUSED item only: what it requires, each
  // chip scrolls to its target; dropped/deferred targets read as broken.
  const depChips =
    dep?.chips !== undefined && dep.chips.length > 0
      ? `<div class="dep-chips">requires: ${dep.chips
          .map(
            (c) =>
              `<button class="dep-chip${c.state !== "active" ? " broken" : ""}" data-target-id="${esc(c.id)}">${
                c.state !== "active" ? `(${esc(c.state)}) ` : ""
              }${esc(truncateChip(c.text))}</button>`,
          )
          .join(" ")}</div>`
      : "";

  // Notes render under the item (field request 2026-07-16: notes existed in
  // the model but the surface never showed them — an informed settle/defer/
  // drop decision needs the why and the impact visible).
  const notesHtml =
    item.notes.length > 0
      ? `<div class="item-notes">${item.notes
          .map(
            (n) =>
              `<div class="item-note" data-note-id="${esc(n.id)}">${esc(n.text)}` +
              `<span class="note-by">— ${esc(n.by ?? "unknown origin")}</span>` +
              `<button class="note-remove" title="Remove this note (human-only — workers can never delete an annotation)">✕</button></div>`,
          )
          .join("")}</div>`
      : "";
  return (
    `<li ${liAttrs.join(" ")}>` +
    `<input type="checkbox" class="item-check"${checkedAttr}>` +
    `<span class="modality" data-modality="${esc(item.modality)}">${esc(item.modality)}</span>` +
    evalsSpan +
    evalBadges +
    `<span class="item-text">${esc(item.text)}</span>` +
    staleBadge +
    cutContextBadge +
    flagBadge +
    pendingEditSpan +
    evidenceChips +
    itemControls +
    (item.state === "active"
      ? `<div class="research-direction" hidden>
      <input type="text" class="research-direction-input" placeholder="Research what? — direct the investigation (empty = the item text itself)">
      <button class="research-direction-go">Go</button>
      <button class="research-direction-cancel">✕</button>
    </div>`
      : "") +
    depChips +
    notesHtml +
    `</li>`
  );
}

/** Clip a dependency chip's text. */
function truncateChip(text: string): string {
  return text.length <= 60 ? text : `${text.slice(0, 59)}…`;
}

/** Compact display label for an evidence source: domain for URLs, basename
 *  for paths, clipped otherwise. The full source lives in the tooltip. */
function compactEvidenceLabel(source: string): string {
  try {
    if (/^https?:\/\//.test(source)) return new URL(source).hostname;
  } catch {
    /* fall through */
  }
  if (source.includes("/")) {
    const base = source.split("/").filter(Boolean).pop() ?? source;
    return base.length <= 40 ? base : `${base.slice(0, 39)}…`;
  }
  return source.length <= 40 ? source : `${source.slice(0, 39)}…`;
}

/** Render the goal (intent) section — contains EXACTLY ONE #goal-input. */
function goalSectionHtml(
  section: Section,
  activity?: SectionActivity,
  errorMsg?: string,
  roundInFlight?: boolean,
  roughRequests?: readonly { id: string; text: string }[],
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
    <button id="explain-btn" class="worker-btn"${prefillDisabled} onclick="triggerExplainAll()" title="One round annotates every unexplained item with Why / Impact / Modality">Explain</button>
    <button id="link-btn" class="worker-btn"${prefillDisabled} onclick="suggestLinks()" title="One round proposes dependency links (requires edges) between existing items — cuts pull context through these">Link</button>
  </div>
  <textarea id="goal-input" hidden>${esc(section.text)}</textarea>
  <div class="journal">
    ${
      goalWasEmpty
        ? ""
        : `<div class="rough-request journal-origin" title="The first entry — the original ask">1. ${esc(section.text)}</div>`
    }
    ${(roughRequests ?? [])
      .map(
        (r, i) =>
          `<div class="rough-request" data-request-id="${esc(r.id)}">${i + 2}. ${esc(r.text)}</div>`,
      )
      .join("")}
    <div class="rough-request-input-area">
      <input type="text" id="rough-request-input" placeholder="${
        goalWasEmpty
          ? "Write the first entry — the rough goal. Entries are permanent; the space grows from them."
          : "Add a journal entry — a new raw ask that expands this space…"
      }">
      <button id="rough-request-btn"${roundInFlight ? " disabled" : ""} onclick="addRoughRequest()">Add entry</button>
    </div>
  </div>
  ${errorHtml}
</section>`;
}

/** Render a non-goal section as a checklist with add-item controls. */
function checklistSectionHtml(
  section: Section,
  activity?: SectionActivity,
  errorMsg?: string,
  selection?: ReadonlySet<string>,
  depMeta?: Map<string, ItemDepMeta>,
  cut?: ReadonlySet<string>,
  cutContext?: { flagged: ReadonlySet<string>; unsettled: ReadonlySet<string> },
): string {
  const marker = STATE_MARKERS[section.state];
  // Dropped items are not rendered; all other states show
  const visibleItems = section.items.filter((it) => it.state !== "dropped");
  const itemsHtml =
    visibleItems.length > 0
      ? `<ul class="item-list">${visibleItems
          .map((it) =>
            itemHtml(
              it,
              selection?.has(it.id) ?? false,
              depMeta?.get(it.id),
              section.kind === "elements",
              cut?.has(it.id) ?? false,
              cutContext?.flagged.has(it.id)
                ? "context"
                : cutContext?.unsettled.has(it.id)
                  ? "context-unsettled"
                  : undefined,
              section.kind === "gap",
            ),
          )
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
  // Unsettled MANDATORY items are surfaced in every state (2026-07-16: the
  // label previously fed no mechanism at all — a "mandatory" item could stay
  // unchecked and freeze proceeded silently). A warning, not a lock: the
  // label is worker-assigned advice; the human stays sovereign (reclassify,
  // defer, or drop if the label is wrong).
  const unsettledMandatory = model.sections.flatMap((s) =>
    s.items.filter(
      (it) =>
        it.modality === "mandatory" && it.state === "active" && !it.checked,
    ),
  );
  const highRiskUnsettled = model.sections.flatMap((s) =>
    s.items.filter(
      (it) => it.evals.risk === 3 && it.state === "active" && !it.checked,
    ),
  );
  const mandatoryWarning =
    (unsettledMandatory.length > 0
      ? ` ⚠ ${unsettledMandatory.length} MANDATORY item${
          unsettledMandatory.length === 1 ? " is" : "s are"
        } not settled — settle, defer, or reclassify before freezing.`
      : "") +
    (highRiskUnsettled.length > 0
      ? ` ⚠ ${highRiskUnsettled.length} HIGH-RISK item${
          highRiskUnsettled.length === 1 ? " (risk 3) is" : "s (risk 3) are"
        } not settled — research or settle them first.`
      : "");
  if (canFreeze) {
    return `Ready to freeze — Freeze signs the checked items into a proposed TEP.${mandatoryWarning}`;
  }
  const uncovered = uncoveredSections(model);
  if (uncovered.length > 0) {
    const parts = uncovered.map((k) =>
      k === "goal"
        ? "goal (write the first journal entry)"
        : k === "gap"
          ? "gap (attend every open question — check, resolve, defer, or drop each)"
          : k,
    );
    return `Freeze locked — every section needs at least one CHECKED item; still uncovered: ${parts.join(", ")}.${mandatoryWarning}`;
  }
  const hist = model.readinessHistory;
  if (hist.length === 0) {
    return `Freeze locked — coverage is green; run “Check readiness” to get a clean-cut verdict on the intent.${mandatoryWarning}`;
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
      return `Freeze locked — readiness check${where}: ${latest.note} Re-run “Check readiness” after addressing it.${mandatoryWarning}`;
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
  focusItemId?: string,
  cutItemIds?: readonly string[],
  curatedScope?: "space" | "cut",
): string {
  const selection: ReadonlySet<string> = new Set(selectedItemIds ?? []);
  const cut: ReadonlySet<string> = new Set(cutItemIds ?? []);
  const depMeta = computeDepMeta(model, focusItemId);
  const goalSec = model.sections.find((s) => s.kind === "goal");
  // Display order (2026-07-16): elements is the goal's DERIVED decomposition —
  // an output of the shaping, not an input — so the shaping inputs (what must
  // hold, what's unknown, what success means) come first. Render-order only:
  // persisted section arrays are untouched.
  // Elements come FIRST (the user's model, 2026-07-16): they are the subject
  // matter — the goal decomposed into parts — and constraints/gap/criteria/
  // verification derive FROM them.
  const displayRank: Record<string, number> = {
    elements: 0,
    constraints: 1,
    gap: 2,
    criteria: 3,
    verification: 4,
  };
  const nonGoalSections = model.sections
    .filter((s) => s.kind !== "goal")
    .slice()
    .sort((a, b) => (displayRank[a.kind] ?? 9) - (displayRank[b.kind] ?? 9));

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

  // BUSY BANNER (field defect 2026-07-16: "the UI is not reactive" — worker
  // rounds take 30–60s and the only signal was a subtle section attribute, so
  // working buttons read as dead). Sticky, unmissable, names the round.
  const busyBanner =
    roundInFlight || commandInFlight
      ? `<div id="busy-banner"><span class="spinner"></span> ${
          commandInFlight
            ? "Interpreting command…"
            : `${esc(roundActivity?.label ?? "worker")} round running…`
        } <span class="busy-hint">workers are thinking — the panel updates when it lands</span></div>`
      : "";

  const goalHtml = goalSec
    ? goalSectionHtml(
        goalSec,
        sectionActivity("goal"),
        sectionError("goal"),
        roundInFlight,
        model.roughRequests,
      )
    : "";
  // Cut context (computed BEFORE sections render so rows can be marked):
  // flagged = pulled and settled (will flag on freeze); unsettled = pulled by
  // the edges but unchecked (silently excluded unless the human settles it).
  const cutElementsForRows = [...cut].filter((id) =>
    model.sections.some(
      (s) =>
        s.kind === "elements" &&
        s.items.some((it) => it.id === id && it.state !== "dropped"),
    ),
  );
  let cutContext:
    | { flagged: ReadonlySet<string>; unsettled: ReadonlySet<string> }
    | undefined;
  if (cutElementsForRows.length > 0) {
    const projForRows = projectCut(model, { elementIds: cutElementsForRows });
    const flagged = new Set(projForRows.flagIds);
    cutContext = {
      flagged,
      unsettled: new Set(
        projForRows.contextIds.filter((id) => !flagged.has(id)),
      ),
    };
  }

  const sectionsHtml = nonGoalSections
    .map((s) =>
      checklistSectionHtml(
        s,
        sectionActivity(s.kind),
        sectionError(s.kind),
        selection,
        depMeta,
        cut,
        cutContext,
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
  // Cut bar — the third selection channel: elements that ship as the next TEP.
  const cutElements = [...cut].filter((id) =>
    model.sections.some(
      (s) =>
        s.kind === "elements" &&
        s.items.some((it) => it.id === id && it.state !== "dropped"),
    ),
  );
  let cutBar = "";
  if (cutElements.length > 0) {
    const proj = projectCut(model, { elementIds: cutElements });
    const unsettledNote =
      proj.uncheckedElements.length > 0
        ? ` · ⚠ ${proj.uncheckedElements.length} not settled`
        : "";
    const anyEdges = model.sections.some((s) =>
      s.items.some((it) => (it.requires?.length ?? 0) > 0),
    );
    const contextNote =
      proj.flagIds.length === 0
        ? anyEdges
          ? " — the selected elements have no linked context"
          : " — no dependency links exist yet; run “Suggest links”"
        : "";
    cutBar = `<div id="cut-bar" title="The cut: these elements ship as the next TEP; their edge-connected context gets flagged and stays live">
      <span class="cut-count">Cut: ${cutElements.length} element${cutElements.length === 1 ? "" : "s"} (+${proj.flagIds.length} context pulled${contextNote})${unsettledNote}</span>
      <button onclick="triggerReframe()">Curate intent</button>
      ${proj.flagIds.length === 0 ? `<button onclick="suggestLinks()">Suggest links</button>` : ""}
      <button onclick="previewTep()">Preview draft</button>
      <button onclick="clearCut()">Clear cut</button>
      <span class="cut-note">Freeze ships this cut.</span>
    </div>`;
  }

  // Curated intent panel (bottom): the derived synthesis freeze signs —
  // maintained by Reframe, never the human's raw words.
  const scopeLabel =
    curatedScope === "cut"
      ? "curated for the CURRENT CUT — describes the upcoming TEP, not the whole space; clear the cut and Reframe to re-synthesize space-wide"
      : curatedScope === "space"
        ? "curated for the whole space"
        : "derived — maintained by Reframe; this is what Freeze signs";
  const curatedPanel = `<section class="curated-intent${curatedScope === "cut" ? " cut-scoped" : ""}">
    <h2>Curated intent <span class="curated-hint">(${scopeLabel})</span></h2>
    ${
      model.curatedIntent?.trim()
        ? `<div id="curated-intent-text">${esc(model.curatedIntent)}</div>`
        : `<div id="curated-intent-text" class="empty">(none yet — run Reframe to synthesize it from the rough requests and settled items)</div>`
    }
  </section>`;

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
    /* Dependency focus (transient inspection): illumination channel — distinct
       from the checkbox (settled) and the dashed outline (staged for action). */
    li.item.dep-focus { border-left: 3px solid var(--vscode-focusBorder); padding-left: 6px; }
    li.item.dep-req { border-left: 3px solid var(--vscode-charts-green, #89d185); padding-left: 6px; }
    li.item.dep-dependent { border-left: 3px solid var(--vscode-charts-orange, #d18616); padding-left: 6px; }
    li.item.dep-dim { opacity: 0.35; }
    .stale-badge { font-size: 0.8em; color: var(--vscode-errorForeground); border: 1px solid var(--vscode-errorForeground); border-radius: 3px; padding: 0 5px; }
    .dep-chips { flex-basis: 100%; margin: 4px 0 2px 24px; font-size: 0.85em; opacity: 0.9; }
    .dep-chip { background: transparent; color: var(--vscode-foreground); border: 1px solid var(--vscode-charts-green, #89d185); border-radius: 8px; padding: 1px 8px; cursor: pointer; font-size: 0.95em; margin: 2px; }
    .dep-chip.broken { border-color: var(--vscode-errorForeground); color: var(--vscode-errorForeground); }
    .item-deps { white-space: nowrap; }
    #busy-banner, #optimistic-busy { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 8px; padding: 8px 12px; margin-bottom: 12px; border: 1px solid var(--vscode-progressBar-background, #0e70c0); border-radius: 4px; background: var(--vscode-editor-background); font-weight: bold; }
    #busy-banner .busy-hint, #optimistic-busy .busy-hint { font-weight: normal; opacity: 0.7; font-size: 0.85em; }
    .spinner { width: 12px; height: 12px; border: 2px solid var(--vscode-progressBar-background, #0e70c0); border-top-color: transparent; border-radius: 50%; display: inline-block; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    section.section[data-activity="running"] { border-color: var(--vscode-progressBar-background, #0e70c0); animation: pulse 1.6s ease-in-out infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.65; } }
    .journal { margin-top: 8px; }
    .journal-origin { font-weight: 500; }
    .rough-request { font-size: 0.9em; opacity: 0.9; padding: 3px 8px; border-left: 2px solid var(--vscode-charts-blue, #3794ff); margin-bottom: 3px; white-space: pre-wrap; }
    .rough-request-input-area { display: flex; gap: 6px; margin-top: 6px; }
    #rough-request-input { flex: 1; padding: 4px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; }
    #cut-bar { position: sticky; top: 0; z-index: 11; display: flex; align-items: center; gap: 8px; padding: 8px 12px; margin-bottom: 12px; border: 1px solid var(--vscode-charts-yellow, #cca700); border-radius: 4px; background: var(--vscode-editor-background); }
    #cut-bar .cut-count { font-weight: bold; }
    #cut-bar .cut-note { opacity: 0.7; font-size: 0.85em; margin-left: auto; }
    #cut-bar button { background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); border: 1px solid var(--vscode-panel-border); padding: 2px 10px; border-radius: 2px; cursor: pointer; }
    li.item.in-cut { border-left: 3px double var(--vscode-charts-yellow, #cca700); padding-left: 6px; }
    li.item.cut-context { border-left: 3px dotted var(--vscode-charts-yellow, #cca700); padding-left: 6px; }
    .cut-badge { font-size: 0.8em; color: var(--vscode-charts-yellow, #cca700); border: 1px dotted var(--vscode-charts-yellow, #cca700); border-radius: 3px; padding: 0 5px; }
    .cut-badge.unsettled { color: var(--vscode-errorForeground); border-color: var(--vscode-errorForeground); }
    li.item.protected { background: color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-charts-yellow, #cca700) 8%); }
    .flag-badge { font-size: 0.8em; color: var(--vscode-charts-yellow, #cca700); border: 1px solid var(--vscode-charts-yellow, #cca700); border-radius: 3px; padding: 0 5px; }
    .curated-intent { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 12px; padding: 12px; }
    .curated-intent.cut-scoped { border-left: 3px double var(--vscode-charts-yellow, #cca700); }
    .curated-intent .curated-hint { font-weight: normal; font-size: 0.75em; opacity: 0.7; }
    #curated-intent-text { white-space: pre-wrap; }
    #curated-intent-text.empty { opacity: 0.5; font-style: italic; }
    .eval-badges { display: inline-flex; gap: 3px; }
    .eval-badge { border: 1px solid var(--vscode-panel-border); background: transparent; color: var(--vscode-foreground); border-radius: 3px; padding: 0 5px; font-size: 0.8em; cursor: pointer; }
    .eval-badge.unset { opacity: 0.45; }
    .eval-badge.risk.v2 { border-color: var(--vscode-charts-orange, #d18616); color: var(--vscode-charts-orange, #d18616); }
    .eval-badge.risk.v3 { border-color: var(--vscode-errorForeground); color: var(--vscode-errorForeground); }
    .eval-badge.complexity.v3 { border-color: var(--vscode-charts-orange, #d18616); color: var(--vscode-charts-orange, #d18616); }
    .eval-badge.hinted { border-style: dashed; }
    .edit-accept, .edit-reject { margin-left: 6px; border: 1px solid var(--vscode-panel-border); background: transparent; color: var(--vscode-foreground); border-radius: 2px; padding: 0 6px; cursor: pointer; font-size: 0.85em; }
    .edit-accept:hover { color: var(--vscode-charts-green, #89d185); border-color: var(--vscode-charts-green, #89d185); }
    .edit-reject:hover { color: var(--vscode-errorForeground); border-color: var(--vscode-errorForeground); }
    .evidence-chip { background: transparent; color: var(--vscode-textLink-foreground, #3794ff); border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 0 8px; margin: 0 2px; cursor: pointer; font-size: 0.8em; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .evidence-chip:hover { border-color: var(--vscode-textLink-foreground, #3794ff); }
    .item-notes { flex-basis: 100%; margin: 4px 0 2px 24px; }
    .item-note { font-size: 0.85em; opacity: 0.85; padding: 4px 8px; border-left: 2px solid var(--vscode-panel-border); margin-bottom: 4px; white-space: pre-wrap; position: relative; }
    .note-by { opacity: 0.55; font-size: 0.85em; margin-left: 6px; font-style: italic; }
    .note-remove { background: transparent; border: none; color: var(--vscode-descriptionForeground); cursor: pointer; font-size: 0.9em; margin-left: 6px; opacity: 0; }
    .item-note:hover .note-remove { opacity: 1; }
    .note-remove:hover { color: var(--vscode-errorForeground); }
    li.item[data-state="deferred"] { opacity: 0.55; }
    li.item[data-state="deferred"] .item-text::after { content: " (deferred)"; font-size: 0.85em; opacity: 0.8; }
    li.item[data-state="resolved"] { opacity: 0.6; }
    li.item[data-state="resolved"] .item-text::after { content: " ✓ resolved"; font-size: 0.85em; color: var(--vscode-charts-green, #89d185); }
    .research-direction { flex-basis: 100%; display: flex; gap: 6px; margin: 4px 0 2px 24px; }
    .research-direction input { flex: 1; padding: 3px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; }
    .research-direction button { border: 1px solid var(--vscode-panel-border); background: transparent; color: var(--vscode-foreground); border-radius: 2px; padding: 0 8px; cursor: pointer; }
    #selection-bar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 8px; padding: 8px 12px; margin-bottom: 12px; border: 1px solid var(--vscode-focusBorder); border-radius: 4px; background: var(--vscode-editor-background); }
    #selection-bar .selection-count { font-weight: bold; margin-right: 4px; }
    #selection-bar button { background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); border: 1px solid var(--vscode-panel-border); padding: 2px 10px; border-radius: 2px; cursor: pointer; }
    #selection-bar button.danger { color: var(--vscode-errorForeground); border-color: var(--vscode-errorForeground); }
  </style>
  ${commandMessage ? `<style>.command-error { margin-top: 8px; padding: 6px 10px; border-radius: 3px; background: var(--vscode-inputValidation-errorBackground, rgba(244,67,54,0.1)); color: var(--vscode-errorForeground); font-size: 0.85em; }</style>` : ""}
</head>
<body>
  <h1>Thinking Space <span style="opacity:0.5;font-size:0.8em;">${esc(model.phase)}</span></h1>
  ${busyBanner}
  ${goalHtml}
  ${cutBar}
  ${selectionBar}
  ${sectionsHtml}
  ${objectionsHtml}
  ${curatedPanel}
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
      <button id="preview-tep" onclick="previewTep()" title="Render exactly what Freeze would sign — a side-effect-free DRAFT">Preview draft</button>
      ${freezeBtn}
    </div>
    <div class="freeze-status">${esc(freezeStatus)}</div>
  </section>
  <script>
    const vscode = acquireVsCodeApi();

    // Preserve scroll + unconfirmed input text across full-html re-renders
    // (every dispatch replaces the document; without this the page jumps to
    // top and clicks land on different rows — field defect 2026-07-17).
    (function restoreViewState() {
      var st = vscode.getState() || {};
      if (typeof st.scrollY === 'number') window.scrollTo(0, st.scrollY);
      ['goal-input','research-input','command-input','rough-request-input'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el && st.inputs && typeof st.inputs[id] === 'string' && !el.value) {
          el.value = st.inputs[id];
        }
      });
    })();
    function saveViewState() {
      var st = vscode.getState() || {};
      st.scrollY = window.scrollY;
      st.inputs = {};
      ['goal-input','research-input','command-input','rough-request-input'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el && el.value) st.inputs[id] = el.value;
      });
      vscode.setState(st);
    }
    window.addEventListener('scroll', saveViewState, { passive: true });
    document.addEventListener('input', saveViewState);

    // Optimistic busy: show feedback IMMEDIATELY on gestures that start a
    // worker round — the server-rendered banner replaces this on the next
    // panel update (every update rebuilds the whole HTML, clearing it).
    function showBusy(label, btn) {
      if (btn && btn.tagName === 'BUTTON') { btn.disabled = true; btn.dataset.prevText = btn.textContent; btn.textContent = '…'; }
      if (document.getElementById('busy-banner') || document.getElementById('optimistic-busy')) return;
      var div = document.createElement('div');
      div.id = 'optimistic-busy';
      div.innerHTML = '<span class="spinner"></span> ' + label + ' <span class="busy-hint">workers are thinking — the panel updates when it lands</span>';
      document.body.insertBefore(div, document.body.firstChild.nextSibling);
    }

    function confirmGoal(wasEmpty) {
      const textarea = document.getElementById('goal-input');
      const text = textarea ? textarea.value.trim() : '';
      if (!text) return;
      vscode.postMessage({ type: wasEmpty ? 'seedGoal' : 'editGoal', text });
      var st = vscode.getState() || {}; if (st.inputs) delete st.inputs['goal-input']; vscode.setState(st);
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
      showBusy('Readiness check running…', document.getElementById('check-readiness'));
      vscode.postMessage({ type: 'checkReadiness' });
    }

    function triggerPrefill() {
      showBusy('Prefill round starting…', document.getElementById('prefill-btn'));
      vscode.postMessage({ type: 'prefill' });
    }

    function triggerReframe() {
      showBusy('Reframe round starting…', document.getElementById('reframe-btn'));
      vscode.postMessage({ type: 'reframe' });
    }

    function triggerExplainAll() {
      showBusy('Explain round starting…', document.getElementById('explain-btn'));
      vscode.postMessage({ type: 'explainAll' });
    }

    function addRoughRequest() {
      var input = document.getElementById('rough-request-input');
      var text = input ? input.value.trim() : '';
      if (!text) return;
      showBusy('Absorbing the rough request (expansion round)…', document.getElementById('rough-request-btn'));
      vscode.postMessage({ type: 'addRoughRequest', text: text });
      if (input) input.value = '';
      saveViewState();
    }

    function previewTep() {
      vscode.postMessage({ type: 'previewTep' });
    }

    function clearCut() {
      vscode.postMessage({ type: 'clearCut' });
    }

    function suggestLinks() {
      showBusy('Link round starting…', document.getElementById('link-btn'));
      vscode.postMessage({ type: 'suggestLinks' });
    }

    function triggerResearch() {
      var input = document.getElementById('research-input');
      var subject = input ? input.value.trim() : '';
      if (!subject) return;
      showBusy('Research round starting…', document.getElementById('research-btn'));
      vscode.postMessage({ type: 'research', subject: subject });
      if (input) input.value = '';
      saveViewState();
    }

    function submitCommand() {
      var input = document.getElementById('command-input');
      var utterance = input ? input.value.trim() : '';
      if (!utterance) return;
      showBusy('Interpreting command…', document.getElementById('command-btn'));
      vscode.postMessage({ type: 'command', utterance: utterance });
      if (input) input.value = '';
      saveViewState();
    }

    // Per-item controls: selection toggle + explain + dependency focus
    document.addEventListener('click', function(e) {
      var target = e.target;
      if (!target || !target.classList) return;
      // Evidence chip → open the dossier (rendered) or the source URL.
      if (target.classList.contains('evidence-chip')) {
        vscode.postMessage({
          type: 'openEvidence',
          dossierRef: target.getAttribute('data-dossier-ref') || undefined,
          source: target.getAttribute('data-source') || ''
        });
        return;
      }
      // Dependency chip → scroll to its target row (pure client-side).
      if (target.classList.contains('dep-chip')) {
        var tid = target.getAttribute('data-target-id');
        var row = tid ? document.querySelector('li.item[data-item-id="' + tid + '"]') : null;
        if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      // Note removal (human-only annotation cleanup).
      if (target.classList.contains('note-remove')) {
        var noteDiv = target.closest('.item-note');
        var noteLi = target.closest('li.item');
        if (noteDiv && noteLi) {
          var nid = noteDiv.getAttribute('data-note-id');
          var niid = noteLi.getAttribute('data-item-id');
          if (nid && niid) vscode.postMessage({ type: 'removeNote', itemId: niid, noteId: nid });
        }
        return;
      }
      var isSelect = target.classList.contains('item-select');
      var isExplain = target.classList.contains('item-explain');
      var isDeps = target.classList.contains('item-deps');
      var isResearch = target.classList.contains('item-research');
      var isCut = target.classList.contains('item-cut');
      var isEval = target.classList.contains('eval-badge');
      var isAccept = target.classList.contains('edit-accept');
      var isReject = target.classList.contains('edit-reject');
      var isResolve = target.classList.contains('item-resolve');
      var isDirGo = target.classList.contains('research-direction-go');
      var isDirCancel = target.classList.contains('research-direction-cancel');
      if (!isSelect && !isExplain && !isDeps && !isResearch && !isCut && !isEval && !isAccept && !isReject && !isResolve && !isDirGo && !isDirCancel) return;
      var li = target.closest('li.item');
      if (!li) return;
      var itemId = li.getAttribute('data-item-id');
      if (!itemId) return;
      if (isEval) {
        var facet = target.getAttribute('data-facet');
        var cur = parseInt(target.getAttribute('data-value') || '0', 10);
        var next = cur >= 3 ? 1 : cur + 1;
        if (facet === 'complexity' || facet === 'risk') {
          vscode.postMessage({ type: 'setEval', itemId: itemId, facet: facet, value: next });
        }
        return;
      }
      if (isAccept || isReject) {
        vscode.postMessage({ type: 'resolveEdit', itemId: itemId, accept: isAccept });
        return;
      }
      if (isResolve) {
        vscode.postMessage({ type: 'resolveItem', itemId: itemId });
        return;
      }
      if (isResearch) {
        // Open the direction field — the human says WHAT to research
        // (field requirement 2026-07-17); empty direction = the item text.
        var form = li.querySelector('.research-direction');
        if (form) {
          form.hidden = !form.hidden;
          if (!form.hidden) { var di = form.querySelector('input'); if (di) di.focus(); }
        }
        return;
      }
      if (isDirGo || isDirCancel) {
        var dirForm = target.closest('.research-direction');
        if (!dirForm) return;
        if (isDirCancel) { dirForm.hidden = true; return; }
        var dirInput = dirForm.querySelector('input');
        var direction = dirInput && dirInput.value.trim() ? dirInput.value.trim() : undefined;
        showBusy('Research round starting…', target);
        vscode.postMessage({ type: 'research', itemId: itemId, subject: direction });
        dirForm.hidden = true;
        return;
      }
      var type = isExplain ? 'explainItem' : isDeps ? 'toggleDepFocus' : isCut ? 'toggleCut' : 'toggleSelect';
      if (isExplain) showBusy('Explain round starting…', target);
      vscode.postMessage({ type: type, itemId: itemId });
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
    focusItemId?: string,
    cutItemIds?: readonly string[],
    curatedScope?: "space" | "cut",
  ): void {
    if (this._panel) {
      this._panel.webview.html = buildScratchpadHtml(
        model,
        undefined,
        roundActivity,
        commandMessage,
        commandInFlight,
        selectedItemIds,
        focusItemId,
        cutItemIds,
        curatedScope,
      );
    }
  }

  dispose(): void {
    this._panel?.dispose();
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
  }
}
