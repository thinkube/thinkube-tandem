/**
 * The BOARD (2026-07-17, approved redesign) — the thinking space's reading
 * and sovereignty surface, replacing the row-farm webview as the live panel.
 *
 * Design contract (user-approved layout):
 *  - Sections as full-width lists; complete item text, never truncated.
 *  - ONE selection (file-explorer semantics: click / ctrl+click / shift+click)
 *    shared with the chat agent's staging — the ONLY ephemeral set.
 *  - States render as states, never selections: settled = checkbox,
 *    in-cut = gold left border + badge, protected = lock badge.
 *  - The chevron expands an inline detail (notes with provenance, edges,
 *    evidence, eval controls, pending-edit resolution) — replaces tooltips,
 *    dep-focus and the detail panel.
 *  - Action bar appears ONLY while the selection is non-empty:
 *    Settle / Defer / Drop / Set as cut / Ask Thinky / Clear.
 *  - Zero per-row buttons, no command field: AI verbs live in the chat.
 *
 * The certified probe surface (buildScratchpadHtml in document.ts) remains
 * untouched and tested; the board is a NEW surface with its own integrity
 * tests (board.test.ts).
 */

import type * as vscode from "vscode";
// Lazy runtime handle (same pattern as document.ts): buildBoardHtml must be
// importable from a plain node test; only BoardView touches the live API.
function vs(): typeof vscode {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("vscode") as typeof vscode;
}
import type { WorkingModel, Item, Section } from "../model";
import { freezeEnabled } from "../model";
import type { ScratchpadInboundMessage } from "./document";

export interface BoardOptions {
  selection: readonly string[];
  cut: readonly string[];
  commandMessage?: string;
  busy?: boolean;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isProtected(item: Item): boolean {
  return item.state === "shipped" || (item.flaggedBy ?? []).length > 0;
}

function badges(item: Item): string {
  const parts: string[] = [];
  if (item.evals.complexity !== undefined)
    parts.push(`<span class="badge">C${item.evals.complexity}</span>`);
  if (item.evals.risk !== undefined)
    parts.push(`<span class="badge">R${item.evals.risk}</span>`);
  if (item.modality === "mandatory")
    parts.push(`<span class="badge mand">mandatory</span>`);
  if (item.state === "shipped")
    parts.push(
      `<span class="badge ship">shipped${item.shippedIn ? `:${esc(item.shippedIn)}` : ""}</span>`,
    );
  else if (item.state !== "active")
    parts.push(`<span class="badge">${item.state}</span>`);
  if ((item.flaggedBy ?? []).length > 0)
    parts.push(`<span class="badge lock">⚑ protected</span>`);
  if (item.pendingEdit)
    parts.push(`<span class="badge edit">proposed edit</span>`);
  return parts.join("");
}

/**
 * Split a Why/Impact/Modality note into its labeled parts (2026-07-18 field
 * request: the board flattened the structured note into one paragraph; the
 * three labels render bold, each part on its own line). Notes without the
 * structure pass through untouched.
 */
export function splitExplainNote(
  text: string,
): { label: string; body: string }[] | null {
  const m = text.match(
    /^\s*Why\s*:\s*([\s\S]*?)(?:\s*Impact\s*:\s*([\s\S]*?))?(?:\s*Modality\s*:\s*([\s\S]*?))?\s*$/i,
  );
  if (!m || m[1] === undefined) return null;
  const parts: { label: string; body: string }[] = [
    { label: "Why", body: m[1].trim() },
  ];
  if (m[2]?.trim()) parts.push({ label: "Impact", body: m[2].trim() });
  if (m[3]?.trim()) parts.push({ label: "Modality", body: m[3].trim() });
  return parts.length >= 1 && parts[0].body ? parts : null;
}

function detailHtml(item: Item, model: WorkingModel): string {
  const byId = new Map<string, string>();
  for (const s of model.sections)
    for (const it of s.items) byId.set(it.id, it.text);
  const rows: string[] = [];
  for (const note of item.notes) {
    const by = note.by ? `<span class="noteby">${esc(note.by)}</span>` : "";
    const parts = splitExplainNote(note.text);
    if (parts) {
      rows.push(
        `<div class="note">${by}${parts
          .map((p) => `<div class="notepart"><b>${p.label}:</b> ${esc(p.body)}</div>`)
          .join("")}</div>`,
      );
    } else {
      rows.push(`<div class="note">${by}${esc(note.text)}</div>`);
    }
  }
  for (const req of item.requires ?? []) {
    rows.push(`<div class="edge">requires: ${esc(byId.get(req) ?? req)}</div>`);
  }
  for (const ev of item.evidence) {
    rows.push(`<div class="evid">evidence: ${esc(ev.source)}</div>`);
  }
  if (item.accepted?.complexity)
    rows.push(
      `<div class="acc">complexity accepted: ${esc(item.accepted.complexity.reason)}</div>`,
    );
  if (item.accepted?.risk)
    rows.push(
      `<div class="acc">risk accepted: ${esc(item.accepted.risk.reason)}</div>`,
    );
  if (item.pendingEdit) {
    rows.push(
      `<div class="pending">proposed: ${esc(item.pendingEdit.newText)}
       <button data-resolve-edit="accept" data-id="${item.id}">Accept</button>
       <button data-resolve-edit="reject" data-id="${item.id}">Reject</button></div>`,
    );
  }
  // Eval controls (sovereign act, kept in the detail — not on the row).
  if (!isProtected(item) && item.state === "active") {
    const evalRow = (facet: "complexity" | "risk", label: string): string =>
      `<span class="evalset">${label}: ${[1, 2, 3]
        .map(
          (v) =>
            `<button data-eval="${facet}" data-val="${v}" data-id="${item.id}" class="${item.evals[facet] === v ? "on" : ""}">${v}</button>`,
        )
        .join("")}</span>`;
    rows.push(
      `<div class="controls">${evalRow("complexity", "C")} ${evalRow("risk", "R")}` +
        `<span class="accept-wrap"><input data-accept-reason="${item.id}" placeholder="acceptance reason…"/>` +
        `<button data-accept="complexity" data-id="${item.id}">accept C</button>` +
        `<button data-accept="risk" data-id="${item.id}">accept R</button></span>` +
        `<button data-resolve="${item.id}" class="resolve">Resolve (answered)</button></div>`,
    );
  }
  return rows.length > 0
    ? rows.join("")
    : `<div class="note dim">no notes yet — ask Thinky "why?"</div>`;
}

function rowHtml(
  item: Item,
  model: WorkingModel,
  selected: boolean,
  inCut: boolean,
  open: boolean,
): string {
  const classes = [
    "item",
    selected ? "sel" : "",
    inCut ? "cut" : "",
    item.state !== "active" ? "inactive" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const checkbox =
    item.state === "active"
      ? `<input type="checkbox" data-check="${item.id}" ${item.checked ? "checked" : ""} ${isProtected(item) && !item.checked ? "" : ""}/>`
      : `<span class="nocheck"></span>`;
  void open;
  return (
    `<div class="${classes}" data-item="${item.id}">` +
    `<button class="chev" data-chev="${item.id}">▸</button>` +
    checkbox +
    `<span class="text">${esc(item.text)}</span>` +
    `<span class="badges">${inCut ? `<span class="badge cutb">cut</span>` : ""}${badges(item)}</span>` +
    `</div>` +
    // Detail content is always rendered; CSS hides it until the chevron opens
    // it (open state is client-restored from webview state across re-renders).
    `<div class="detail" data-detail="${item.id}">${detailHtml(item, model)}</div>`
  );
}

function sectionHtml(
  section: Section,
  model: WorkingModel,
  opts: BoardOptions,
  openIds: ReadonlySet<string>,
): string {
  const items = section.items.filter((it) => it.state !== "dropped");
  const active = items.filter((it) => it.state === "active");
  const settled = active.filter((it) => it.checked).length;
  const sel = new Set(opts.selection);
  const cut = new Set(opts.cut);
  return (
    `<section class="sec" data-section="${section.id}">` +
    `<header><h2>${esc(section.kind)}</h2><span class="count">${
      active.length > 0 ? `${settled}/${active.length} settled` : "empty"
    }</span></header>` +
    items
      .map((it) =>
        rowHtml(it, model, sel.has(it.id), cut.has(it.id), openIds.has(it.id)),
      )
      .join("") +
    `</section>`
  );
}

/** Pure HTML builder for the board (tested in board.test.ts). */
export function buildBoardHtml(
  model: WorkingModel,
  opts: BoardOptions,
): string {
  const goal = model.sections.find((s) => s.kind === "goal");
  const journal = model.roughRequests ?? [];
  const assumptions = model.assumptions ?? [];
  const canFreeze = freezeEnabled(model);
  const selCount = opts.selection.length;

  const body =
    `<div class="top">` +
    `<span class="title">Thinking Board</span>` +
    `<span class="spacer"></span>` +
    (opts.busy ? `<span class="busy">working…</span>` : "") +
    `<button data-act="openchat">Open chat</button>` +
    `<button data-act="panic" class="danger" title="Wipe derived state — journal and assumptions survive verbatim (refused after any freeze)">Panic</button>` +
    `<button data-act="freeze" ${canFreeze ? "" : "disabled"} title="${canFreeze ? "Freeze the cut into a TEP" : "Blocked — ask Thinky to check readiness"}">Freeze</button>` +
    `</div>` +
    (opts.commandMessage
      ? `<div class="msg">${esc(opts.commandMessage)}</div>`
      : "") +
    `<div class="goal">${esc(goal?.text ?? "")}</div>` +
    `<details class="fold"><summary>Journal (${1 + journal.length})</summary>` +
    `<ol><li>${esc(goal?.text ?? "")}</li>${journal
      .map(
        (r) =>
          `<li>${esc(r.text)} <button class="jdel" data-journal-del="${r.id}" title="Delete this entry (recording-error correction — asks to confirm)">✕</button></li>`,
      )
      .join("")}</ol></details>` +
    (assumptions.length > 0
      ? `<details class="fold"><summary>Assumptions (${assumptions.length})</summary>` +
        `<ol>${assumptions.map((a) => `<li>${esc(a.text)}</li>`).join("")}</ol></details>`
      : "") +
    model.sections
      .filter((s) => s.kind !== "goal")
      .map((s) => sectionHtml(s, model, opts, new Set()))
      .join("") +
    `<div class="bar ${selCount > 0 ? "show" : ""}">` +
    `<span>${selCount} selected</span>` +
    `<button data-verb="check">Settle</button>` +
    `<button data-verb="defer">Defer</button>` +
    `<button data-verb="drop" class="danger">Drop</button>` +
    `<button data-act="setcut">Set as cut</button>` +
    `<button data-act="ask">Ask Thinky</button>` +
    `<button data-act="clearsel">Clear</button>` +
    `</div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}</style></head>` +
    `<body>${body}<script>${SCRIPT}</script></body></html>`;
}

const CSS = `
:root{color-scheme:light dark}
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);margin:0;padding:0 0 64px 0}
.top{display:flex;align-items:center;gap:8px;padding:10px 16px;position:sticky;top:0;background:var(--vscode-editor-background);border-bottom:1px solid var(--vscode-panel-border);z-index:2}
.title{font-weight:600}
.spacer{flex:1}
.busy{opacity:.7;font-style:italic}
.msg{padding:6px 16px;background:var(--vscode-editorWidget-background);border-bottom:1px solid var(--vscode-panel-border)}
.goal{padding:14px 16px;font-size:1.05em;white-space:pre-wrap}
.fold{margin:0 16px 6px 16px}
.fold summary{cursor:pointer;opacity:.85}
.jdel{background:none;border:none;color:inherit;opacity:.4;cursor:pointer;padding:0 3px}
.jdel:hover{opacity:1;color:var(--vscode-errorForeground)}
.sec{margin:14px 0}
.sec header{display:flex;align-items:baseline;gap:10px;padding:0 16px}
.sec h2{font-size:.85em;text-transform:uppercase;letter-spacing:.08em;margin:6px 0;opacity:.8}
.count{font-size:.8em;opacity:.6}
.item{display:flex;align-items:flex-start;gap:8px;padding:6px 16px;cursor:default;border-left:3px solid transparent}
.item:hover{background:var(--vscode-list-hoverBackground)}
.item.sel{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}
.item.cut{border-left-color:#c9a227}
.item.inactive .text{opacity:.55;text-decoration:line-through}
.item .text{flex:1;white-space:pre-wrap;word-break:break-word}
.chev{background:none;border:none;color:inherit;cursor:pointer;padding:0 2px;opacity:.6}
.badges{display:flex;gap:4px;flex-wrap:wrap}
.badge{font-size:.72em;border:1px solid var(--vscode-panel-border);border-radius:3px;padding:0 4px;opacity:.85}
.badge.cutb{border-color:#c9a227;color:#c9a227}
.badge.lock{color:var(--vscode-charts-orange)}
.detail{display:none;padding:4px 16px 8px 46px;font-size:.9em;border-left:3px solid transparent}
.detail.open{display:block}
.detail .note,.detail .edge,.detail .evid,.detail .acc,.detail .pending{margin:2px 0;opacity:.9}
.detail .noteby{display:inline-block;font-size:.75em;opacity:.55;margin-right:6px;text-transform:uppercase;letter-spacing:.05em}
.detail .notepart{margin:2px 0}
.detail .notepart b{opacity:1}
.detail .dim{opacity:.5}
.detail .controls{margin-top:6px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.evalset button{min-width:22px}
.evalset button.on{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.bar{display:none;position:fixed;left:0;right:0;bottom:0;padding:10px 16px;gap:8px;align-items:center;background:var(--vscode-editorWidget-background);border-top:1px solid var(--vscode-panel-border)}
.bar.show{display:flex}
button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none;border-radius:3px;padding:3px 8px;cursor:pointer}
button:disabled{opacity:.4;cursor:default}
button.danger{background:var(--vscode-inputValidation-errorBackground)}
input[type=checkbox]{margin-top:3px}
input[data-accept-reason]{width:160px}
`;

const SCRIPT = `
const vscodeApi = acquireVsCodeApi();
const prior = vscodeApi.getState() || {};
let anchor = prior.anchor || null;
const openSet = new Set(prior.open || []);
// restore open details + scroll
for (const id of openSet) {
  const d = document.querySelector('[data-detail="'+id+'"]');
  const c = document.querySelector('[data-chev="'+id+'"]');
  if (d) d.classList.add('open');
  if (c) c.textContent = '▾';
}
if (prior.scroll) window.scrollTo(0, prior.scroll);
function saveState(){ vscodeApi.setState({scroll:window.scrollY, open:[...openSet], anchor}); }
window.addEventListener('scroll', saveState, {passive:true});
function rowIds(){ return [...document.querySelectorAll('[data-item]')].map(function(el){return el.getAttribute('data-item');}); }
function currentSel(){ return [...document.querySelectorAll('.item.sel')].map(function(el){return el.getAttribute('data-item');}); }
document.body.addEventListener('change', function(e){
  const t = e.target;
  if (t && t.hasAttribute && t.hasAttribute('data-check')) {
    vscodeApi.postMessage({type:'toggleItem', itemId:t.getAttribute('data-check'), checked:t.checked});
  }
});
document.body.addEventListener('click', function(e){
  let t = e.target;
  while (t && t !== document.body && !(t.hasAttribute && (t.hasAttribute('data-journal-del')||t.hasAttribute('data-chev')||t.hasAttribute('data-verb')||t.hasAttribute('data-act')||t.hasAttribute('data-eval')||t.hasAttribute('data-accept')||t.hasAttribute('data-resolve')||t.hasAttribute('data-resolve-edit')||t.hasAttribute('data-item')||t.hasAttribute('data-check')))) t = t.parentElement;
  if (!t || t === document.body) return;
  if (t.hasAttribute('data-check')) return; // checkbox handled on change
  if (t.hasAttribute('data-journal-del')) {
    vscodeApi.postMessage({type:'removeJournalEntry', requestId:t.getAttribute('data-journal-del')});
    return;
  }
  if (t.hasAttribute('data-chev')) {
    const id = t.getAttribute('data-chev');
    const d = document.querySelector('[data-detail="'+id+'"]');
    if (d) { d.classList.toggle('open'); if (d.classList.contains('open')) openSet.add(id); else openSet.delete(id); t.textContent = d.classList.contains('open') ? '▾' : '▸'; saveState(); }
    return;
  }
  if (t.hasAttribute('data-verb')) { vscodeApi.postMessage({type:'applySelection', verb:t.getAttribute('data-verb')}); return; }
  if (t.hasAttribute('data-eval')) { vscodeApi.postMessage({type:'setEval', itemId:t.getAttribute('data-id'), facet:t.getAttribute('data-eval'), value:Number(t.getAttribute('data-val'))}); return; }
  if (t.hasAttribute('data-accept')) {
    const id = t.getAttribute('data-id');
    const inp = document.querySelector('[data-accept-reason="'+id+'"]');
    const reason = inp && inp.value ? inp.value.trim() : '';
    if (reason) vscodeApi.postMessage({type:'acceptEval', itemId:id, facet:t.getAttribute('data-accept'), reason:reason});
    return;
  }
  if (t.hasAttribute('data-resolve')) { vscodeApi.postMessage({type:'resolveItem', itemId:t.getAttribute('data-resolve')}); return; }
  if (t.hasAttribute('data-resolve-edit')) { vscodeApi.postMessage({type:'resolveEdit', itemId:t.getAttribute('data-id'), accept:t.getAttribute('data-resolve-edit')==='accept'}); return; }
  if (t.hasAttribute('data-act')) {
    const act = t.getAttribute('data-act');
    if (act==='setcut') vscodeApi.postMessage({type:'setCutFromSelection'});
    else if (act==='clearsel') vscodeApi.postMessage({type:'clearSelection'});
    else if (act==='ask' || act==='openchat') vscodeApi.postMessage({type:'askThinky'});
    else if (act==='panic') vscodeApi.postMessage({type:'panic'});
    else if (act==='freeze') vscodeApi.postMessage({type:'freeze'});
    return;
  }
  if (t.hasAttribute('data-item')) {
    const id = t.getAttribute('data-item');
    const ids = rowIds();
    let next;
    if (e.shiftKey && anchor && ids.indexOf(anchor) !== -1) {
      const a = ids.indexOf(anchor), b = ids.indexOf(id);
      next = ids.slice(Math.min(a,b), Math.max(a,b)+1);
    } else if (e.ctrlKey || e.metaKey) {
      const cur = new Set(currentSel());
      if (cur.has(id)) cur.delete(id); else cur.add(id);
      next = [...cur]; anchor = id;
    } else {
      next = [id]; anchor = id;
    }
    saveState();
    vscodeApi.postMessage({type:'setSelection', itemIds:next});
  }
});
`;

/** Webview panel wrapper for the board. */
export class BoardView implements vscode.Disposable {
  private _panel: vscode.WebviewPanel | undefined;
  private _disposables: vscode.Disposable[] = [];

  show(
    extensionUri: vscode.Uri,
    model: WorkingModel,
    opts: BoardOptions,
    onMessage: (msg: ScratchpadInboundMessage) => void | Promise<void>,
    preserveFocus = false,
  ): void {
    if (this._panel) {
      this._panel.reveal(vs().ViewColumn.One, preserveFocus);
      this._panel.webview.html = buildBoardHtml(model, opts);
      return;
    }
    this._panel = vs().window.createWebviewPanel(
      "thinkubeScratchpad",
      "Thinking Board",
      { viewColumn: vs().ViewColumn.One, preserveFocus },
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
        retainContextWhenHidden: true,
      },
    );
    this._panel.webview.html = buildBoardHtml(model, opts);
    this._disposables.push(
      this._panel.webview.onDidReceiveMessage((msg) =>
        onMessage(msg as ScratchpadInboundMessage),
      ),
      this._panel.onDidDispose(() => {
        this._panel = undefined;
      }),
    );
  }

  update(model: WorkingModel, opts: BoardOptions): void {
    if (this._panel) {
      this._panel.webview.html = buildBoardHtml(model, opts);
    }
  }

  get visible(): boolean {
    return this._panel !== undefined;
  }

  dispose(): void {
    for (const d of this._disposables) d.dispose();
    this._disposables = [];
    this._panel?.dispose();
    this._panel = undefined;
  }
}
