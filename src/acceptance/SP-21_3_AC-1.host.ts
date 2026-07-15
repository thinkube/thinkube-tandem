/**
 * SP-21/3 AC-1 — Sections are checklists.
 *
 * WHY (INVARIANT): Opening a named thinking space shows every section except the
 * intent (goal) as a list of discrete items. Each rendered item carries a
 * checkbox (class "item-check"), a mandatory/optional marker (<span
 * class="modality" data-modality="…">), and a facets span (<span class="evals">).
 * Adding items to different sections in arbitrary order lands each in the model
 * and in the rendered HTML with the correct data attributes. This must hold
 * forever — any implementation that renders non-goal sections as free-text areas
 * or drops the required HTML selectors breaks this test.
 */

import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as vscode from "vscode";
import type { TandemExtensionApi } from "../extension";
import type { ScratchpadSession } from "../scratchpad/session";

// ── SP-3 extended types (defined locally; the implementation exports these) ──

interface SP3Item {
  id: string;
  text: string;
  checked: boolean;
  modality: "mandatory" | "optional";
  evals: { complexity?: 1 | 2 | 3; risk?: 1 | 2 | 3 };
  origin: string;
  state: string;
  shippedIn?: string;
  supersedes?: string;
  supersededBy?: string;
  evidence: unknown[];
  notes: unknown[];
}

interface SP3Section {
  id: string;
  kind: string;
  items: SP3Item[];
  [key: string]: unknown;
}

interface SP3Model {
  sections: SP3Section[];
  [key: string]: unknown;
}

// ── SP-3 inbound webview message vocabulary (replaces SP-2's askStructure vocab) ──
type SP3InboundMessage =
  | {
      type: "addItem";
      sectionId: string;
      text: string;
      modality?: "mandatory" | "optional";
    }
  | { type: "toggleItem"; itemId: string; checked: boolean }
  | { type: "editItemText"; itemId: string; text: string }
  | { type: "setModality"; itemId: string; modality: "mandatory" | "optional" }
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
  | { type: "command"; utterance: string };

type SP3Session = ScratchpadSession & {
  postFromWebview(message: SP3InboundMessage): Promise<void>;
};

// ── Marker strings — all-caps alphanumeric, safe through HTML escaping ────────
const ITEM_CONSTRAINTS_1 = "CONSTRAINTITEMONETEXT";
const ITEM_GAP_1 = "GAPITEMONETEXT";
const ITEM_CONSTRAINTS_2 = "CONSTRAINTITEMTWOTEXT";
const ITEM_ELEMENTS_1 = "ELEMENTSITEMONETEXT";

export async function run(_phase: number): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension must be present in the host");
  const api = (await ext.activate()) as TandemExtensionApi;

  const tmpDir = path.join(os.tmpdir(), "tandem-probe-sp21-3-ac1");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  // ── Open a named thinking space (SP-3 introduces space + namespace deps) ────
  // Cast to bypass the pre-SP-3 type shape; the implementation adds these fields.
  const raw = await (
    api.scratchpad.openScratchpad as (
      d: Record<string, unknown>,
    ) => Promise<ScratchpadSession>
  )({
    sidecarRoot: tmpDir,
    space: "sp21-3-ac1",
    namespace: "probe-ns",
  });
  assert.ok(
    raw,
    "openScratchpad must return a live session for the named thinking space",
  );

  const session = raw as unknown as SP3Session;
  const model = session.model as unknown as SP3Model;

  assert.equal(
    typeof session.postFromWebview,
    "function",
    "session must expose postFromWebview — the SP-3 inbound message channel must be wired",
  );

  // ── A fresh thinking space seeds all six section kinds ──────────────────────
  // INVARIANT: goal, constraints, elements, gap, criteria, verification are seeded
  // with empty item lists immediately on open — no round trip required.
  const kinds = model.sections.map((s) => s.kind);
  for (const k of [
    "goal",
    "constraints",
    "elements",
    "gap",
    "criteria",
    "verification",
  ] as const) {
    assert.ok(
      kinds.includes(k),
      `fresh thinking space must seed a '${k}' section — got: [${kinds.join(", ")}]`,
    );
  }

  // ── Every non-goal section has an items array (possibly empty) ──────────────
  // INVARIANT: sections other than goal are item-list sections, never prose-only.
  for (const sec of model.sections.filter((s) => s.kind !== "goal")) {
    assert.ok(
      Array.isArray(sec.items),
      `section '${sec.kind}' must carry an items array — it is a checklist section`,
    );
  }

  // ── The goal section is the intent editor — exactly ONE #goal-input ─────────
  // INVARIANT: the panel always has exactly one intent editor; never 0, never 2+.
  const emptyHtml = session.renderedHtml();
  const goalInputCount = (emptyHtml.match(/id\s*=\s*["']goal-input["']/g) ?? [])
    .length;
  assert.equal(
    goalInputCount,
    1,
    `renderedHtml() must contain EXACTLY ONE element with id="goal-input", got ${goalInputCount}`,
  );

  // ── Non-goal sections appear in the rendered panel (even when empty) ─────────
  // INVARIANT: the section container for each non-goal kind is always rendered.
  for (const kind of [
    "constraints",
    "elements",
    "gap",
    "criteria",
    "verification",
  ]) {
    assert.ok(
      emptyHtml.includes(kind),
      `renderedHtml() must include section '${kind}' even when its item list is empty`,
    );
  }

  // ── Locate section ids for the addItem targets ───────────────────────────────
  const constraintsSec = model.sections.find((s) => s.kind === "constraints");
  const gapSec = model.sections.find((s) => s.kind === "gap");
  const elementsSec = model.sections.find((s) => s.kind === "elements");

  assert.ok(
    constraintsSec,
    "constraints section must exist on the fresh model",
  );
  assert.ok(gapSec, "gap section must exist on the fresh model");
  assert.ok(elementsSec, "elements section must exist on the fresh model");

  // ── Add items in arbitrary order across multiple sections ────────────────────
  // WHY: AC-1 explicitly names "in any order, at any time". The order here is:
  // constraints → gap (different section) → constraints again → elements.
  // This proves the model accepts any order, not just a single append-at-end path.

  // 1. First item into constraints (default modality → mandatory)
  await session.postFromWebview({
    type: "addItem",
    sectionId: constraintsSec!.id,
    text: ITEM_CONSTRAINTS_1,
  });

  // 2. Jump to a completely different section — gap
  await session.postFromWebview({
    type: "addItem",
    sectionId: gapSec!.id,
    text: ITEM_GAP_1,
  });

  // 3. Back to constraints — a second item, this time with explicit optional modality
  await session.postFromWebview({
    type: "addItem",
    sectionId: constraintsSec!.id,
    text: ITEM_CONSTRAINTS_2,
    modality: "optional",
  });

  // 4. A third section — elements
  await session.postFromWebview({
    type: "addItem",
    sectionId: elementsSec!.id,
    text: ITEM_ELEMENTS_1,
  });

  // ── Assert each item landed in the correct section of the model ──────────────
  // INVARIANT: postFromWebview dispatches addItem through the one reducer; items
  // appear in the section identified by sectionId, never anywhere else.
  const updatedModel = session.model as unknown as SP3Model;

  const cSec = updatedModel.sections.find((s) => s.kind === "constraints")!;
  assert.equal(
    cSec.items.length,
    2,
    "constraints section must hold exactly 2 items after two addItem calls targeting it",
  );

  const cTexts = cSec.items.map((i) => i.text);
  assert.ok(
    cTexts.includes(ITEM_CONSTRAINTS_1),
    `constraints items must include '${ITEM_CONSTRAINTS_1}'`,
  );
  assert.ok(
    cTexts.includes(ITEM_CONSTRAINTS_2),
    `constraints items must include '${ITEM_CONSTRAINTS_2}'`,
  );

  const gSec = updatedModel.sections.find((s) => s.kind === "gap")!;
  assert.equal(gSec.items.length, 1, "gap section must hold exactly 1 item");
  assert.equal(
    gSec.items[0].text,
    ITEM_GAP_1,
    "gap section item text must match what was posted",
  );

  const eSec = updatedModel.sections.find((s) => s.kind === "elements")!;
  assert.equal(
    eSec.items.length,
    1,
    "elements section must hold exactly 1 item",
  );
  assert.equal(eSec.items[0].text, ITEM_ELEMENTS_1);

  // ── Human-added items are born checked with state:'active' ──────────────────
  // INVARIANT: addItem via postFromWebview dispatches with actor:'human'; the
  // human's act of adding IS the settling act, so the item is born checked:true.
  for (const item of cSec.items) {
    assert.equal(
      item.checked,
      true,
      `human-added item '${item.text}' must be born checked:true — ` +
        "only the human settles items, and adding IS settling",
    );
    assert.equal(
      item.state,
      "active",
      `item '${item.text}' must have state:'active' immediately after addItem`,
    );
    assert.equal(
      item.origin,
      "human",
      `item '${item.text}' must carry origin:'human' — it was added via postFromWebview`,
    );
  }

  // ── Modality: explicit optional + default mandatory ──────────────────────────
  const optItem = cSec.items.find((i) => i.text === ITEM_CONSTRAINTS_2);
  assert.equal(
    optItem?.modality,
    "optional",
    "item posted with modality:'optional' must carry modality:'optional' in the model",
  );

  const mandItem = cSec.items.find((i) => i.text === ITEM_CONSTRAINTS_1);
  assert.equal(
    mandItem?.modality,
    "mandatory",
    "item posted without explicit modality must default to 'mandatory'",
  );

  // ── renderedHtml() carries all items and the contract's CSS selectors ─────────
  // INVARIANT: the panel re-renders from the live model after every dispatch;
  // the rendered HTML must carry all items visibly and with the exact selectors
  // the contract specifies so that the webview JS can wire each control.
  const html = session.renderedHtml();

  for (const text of [
    ITEM_CONSTRAINTS_1,
    ITEM_CONSTRAINTS_2,
    ITEM_GAP_1,
    ITEM_ELEMENTS_1,
  ]) {
    assert.ok(
      html.includes(text),
      `renderedHtml() must contain '${text}' — the item must be visible in the panel`,
    );
  }

  // Contract: <li class="item" data-item-id="…" data-state="…" data-origin="…">
  assert.ok(
    /class\s*=\s*["'][^"']*\bitem\b[^"']*["']/.test(html),
    "renderedHtml() must contain elements with class 'item' — the per-item list entry selector",
  );
  assert.ok(
    /data-item-id/.test(html),
    "renderedHtml() must carry data-item-id attributes on item elements",
  );
  assert.ok(
    /data-state/.test(html),
    "renderedHtml() must carry data-state attributes on item elements",
  );
  assert.ok(
    /data-origin/.test(html),
    "renderedHtml() must carry data-origin attributes on item elements",
  );

  // Contract: <input type="checkbox" class="item-check"> (checked mirrors Item.checked)
  assert.ok(
    /class\s*=\s*["'][^"']*\bitem-check\b[^"']*["']/.test(html),
    "renderedHtml() must carry class='item-check' on checkbox inputs — " +
      "the checkbox is the human's only settling control per item",
  );
  assert.ok(
    /type\s*=\s*["']checkbox["']/.test(html),
    "renderedHtml() must contain input type='checkbox' elements for item checkboxes",
  );

  // Born-checked items must have the 'checked' attribute on their checkbox.
  assert.ok(
    /\bchecked\b/.test(html),
    "renderedHtml() must include the 'checked' attribute — human-added items are born " +
      "checked:true and the checkbox must mirror Item.checked",
  );

  // Contract: <span class="modality" data-modality="mandatory|optional">
  assert.ok(
    /class\s*=\s*["'][^"']*\bmodality\b[^"']*["']/.test(html),
    "renderedHtml() must carry class='modality' on the mandatory/optional marker span",
  );
  assert.ok(
    /data-modality\s*=\s*["'](mandatory|optional)["']/.test(html),
    "renderedHtml() must carry data-modality='mandatory' or 'optional' on modality spans",
  );

  // Contract: <span class="evals" [data-complexity] [data-risk]>
  assert.ok(
    /class\s*=\s*["'][^"']*\bevals\b[^"']*["']/.test(html),
    "renderedHtml() must carry class='evals' on the evaluation facets span",
  );

  // The goal section's intent editor (#goal-input) must be distinct from the item lists.
  // Non-goal sections must NOT contain a #goal-input element.
  assert.equal(
    (html.match(/id\s*=\s*["']goal-input["']/g) ?? []).length,
    1,
    "the final rendered HTML must still contain EXACTLY ONE #goal-input — " +
      "adding items must not duplicate or remove the intent editor",
  );
}
