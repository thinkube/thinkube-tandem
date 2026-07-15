// TANDEM_PHASES=2
/**
 * SP-21/3 AC-11 — Deferred items wait in the space.
 *
 * WHY (INVARIANT): An author can mark an unchecked item deferred rather than
 * dropped. Deferred items must survive a flush and a cold-start reopen of the
 * same named thinking space; they must reappear in their section with every
 * attribute intact — state:'deferred', modality, evaluations, and any attached
 * evidence chips. This must hold forever — a serialisation refactor that strips
 * deferred items, loses their evidence, or resets their modality/evals breaks
 * the guarantee that a half-finished space can be resumed without losing work.
 *
 * Two fresh extension hosts, same fixed sidecarRoot + namespace + space name:
 *   Phase 0 — author a deferred item (with optional modality, complexity eval,
 *              and an evidence attachment), call flush(), write the live model
 *              as expected.json.
 *   Phase 1 — cold-start openScratchpad with the same deps, assert the
 *              deferred item reappears in the constraints section with ALL
 *              attributes intact, including the evidence chip in renderedHtml().
 */

import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as vscode from "vscode";
import type { TandemExtensionApi } from "../extension";
import type { ScratchpadSession } from "../scratchpad/session";
import type { Action } from "../scratchpad/model";

// ── SP-3 extended types (defined locally) ────────────────────────────────────

interface SP3Evidence {
  source: string;
  method: string;
  checkedAt: string;
  dossierRef?: string;
}

interface SP3Item {
  id: string;
  text: string;
  checked: boolean;
  modality: string;
  evals: { complexity?: number; risk?: number };
  origin: string;
  state: string;
  evidence: SP3Evidence[];
  notes: unknown[];
}

interface SP3Section {
  id: string;
  kind: string;
  items: SP3Item[];
}

interface SP3Model {
  sections: SP3Section[];
}

// SP-3 inbound webview message vocabulary
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

// ── Fixed paths — deterministic; no Date.now() / Math.random() ───────────────
const SIDECAR_ROOT = path.join(os.tmpdir(), "tandem-probe-sp21-3-ac11");
const NAMESPACE = "ns-deferred";
const SPACE = "deferred-space";
// Document path: <sidecarRoot>/<namespace>/thinking/<space>.json
const THINKING_JSON = path.join(
  SIDECAR_ROOT,
  NAMESPACE,
  "thinking",
  `${SPACE}.json`,
);
const EXPECTED_JSON = path.join(
  SIDECAR_ROOT,
  NAMESPACE,
  "thinking",
  "expected.json",
);

// ── Marker strings — all-caps alphanumeric, safe through HTML escaping ────────
const DEFERRED_TEXT = "DEFERREDITEMTEXT";
const EVIDENCE_SOURCE = "EVIDENCESOURCEMARKER";
const EVIDENCE_METHOD = "EVIDENCEMETHODMARKER";
const EVIDENCE_CHECKED_AT = "2026-07-15T00:00:00Z";

export async function run(phase: number): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension must be present in the host");
  const api = (await ext.activate()) as TandemExtensionApi;

  if (phase === 0) {
    // ── Phase 0: author a deferred item and persist ───────────────────────────

    fs.rmSync(SIDECAR_ROOT, { recursive: true, force: true });
    fs.mkdirSync(path.join(SIDECAR_ROOT, NAMESPACE, "thinking"), {
      recursive: true,
    });

    // Open the named thinking space
    const raw = await (
      api.scratchpad.openScratchpad as (
        d: Record<string, unknown>,
      ) => Promise<ScratchpadSession>
    )({
      sidecarRoot: SIDECAR_ROOT,
      namespace: NAMESPACE,
      space: SPACE,
    });
    assert.ok(raw, "openScratchpad must return a live session in phase 0");
    const session = raw as unknown as SP3Session;

    assert.equal(
      typeof session.postFromWebview,
      "function",
      "session must expose postFromWebview in phase 0",
    );

    // Locate the constraints section
    const model0 = session.model as unknown as SP3Model;
    const constraintsSec = model0.sections.find(
      (s) => s.kind === "constraints",
    );
    assert.ok(
      constraintsSec,
      "constraints section must exist on the fresh named space",
    );

    // 1. Add a human item — it's born-checked and active
    await session.postFromWebview({
      type: "addItem",
      sectionId: constraintsSec.id,
      text: DEFERRED_TEXT,
    });

    const afterAdd = session.model as unknown as SP3Model;
    const itemAfterAdd = afterAdd.sections
      .find((s) => s.kind === "constraints")!
      .items.find((i) => i.text === DEFERRED_TEXT);
    assert.ok(itemAfterAdd, "item must exist in constraints after addItem");
    const itemId = itemAfterAdd.id;

    // Verify born-checked state (precondition for the uncheck + defer flow)
    assert.equal(
      itemAfterAdd.checked,
      true,
      "human-added item must be born checked:true",
    );

    // 2. Uncheck the item — a deferred item is unchecked (the human decided to
    //    set it aside rather than shipping it in the next TEP)
    await session.postFromWebview({
      type: "toggleItem",
      itemId,
      checked: false,
    });

    const afterUncheck = session.model as unknown as SP3Model;
    const itemAfterUncheck = afterUncheck.sections
      .find((s) => s.kind === "constraints")!
      .items.find((i) => i.id === itemId)!;
    assert.equal(
      itemAfterUncheck.checked,
      false,
      "item must be unchecked after toggleItem(checked:false)",
    );

    // 3. Set modality to 'optional'
    await session.postFromWebview({
      type: "setModality",
      itemId,
      modality: "optional",
    });

    // 4. Set complexity eval to 3
    await session.postFromWebview({
      type: "setEval",
      itemId,
      facet: "complexity",
      value: 3,
    });

    // 5. Attach evidence directly via dispatch (attachEvidence is not in the
    //    webview message vocab — it's an action the session exposes via dispatch)
    session.dispatch({
      type: "attachEvidence",
      actor: "human",
      itemId,
      evidence: {
        source: EVIDENCE_SOURCE,
        method: EVIDENCE_METHOD,
        checkedAt: EVIDENCE_CHECKED_AT,
      },
    } as unknown as Action);

    // 6. Defer the item
    await session.postFromWebview({ type: "deferItem", itemId });

    // Verify the item is now deferred with all attributes before flush
    const afterDefer = session.model as unknown as SP3Model;
    const deferredItem = afterDefer.sections
      .find((s) => s.kind === "constraints")!
      .items.find((i) => i.id === itemId);
    assert.ok(deferredItem, "deferred item must still be in the section");
    assert.equal(
      deferredItem.state,
      "deferred",
      "item state must be 'deferred' after deferItem",
    );
    assert.equal(
      deferredItem.modality,
      "optional",
      "item modality must be 'optional' as set",
    );
    assert.equal(
      deferredItem.evals.complexity,
      3,
      "item complexity eval must be 3 as set",
    );
    assert.equal(
      deferredItem.evidence.length,
      1,
      "item must have one evidence attachment",
    );
    assert.equal(
      (deferredItem.evidence[0] as SP3Evidence).source,
      EVIDENCE_SOURCE,
    );
    assert.equal(
      (deferredItem.evidence[0] as SP3Evidence).method,
      EVIDENCE_METHOD,
    );

    // 7. Flush to disk
    await session.flush();

    // The document must have been written at the contract path
    assert.ok(
      fs.existsSync(THINKING_JSON),
      `session file must exist at ${THINKING_JSON} after flush() — ` +
        "document path is <sidecarRoot>/<namespace>/thinking/<space>.json",
    );

    // Save the live model as the reference for phase 1 assertions
    fs.writeFileSync(EXPECTED_JSON, JSON.stringify(session.model), "utf8");
    assert.ok(
      fs.existsSync(EXPECTED_JSON),
      "expected.json must be written for phase 1 comparison",
    );
  } else {
    // ── Phase 1: cold-start — deferred item must survive ─────────────────────

    assert.ok(
      fs.existsSync(EXPECTED_JSON),
      `expected.json must exist at ${EXPECTED_JSON} — was phase 0 skipped or flush() fail?`,
    );
    assert.ok(
      fs.existsSync(THINKING_JSON),
      `thinking/${SPACE}.json must exist — phase 1 depends on phase 0 flushing it`,
    );

    const expected = JSON.parse(
      fs.readFileSync(EXPECTED_JSON, "utf8"),
    ) as object;

    // Cold-start: openScratchpad with the same named space and namespace
    const raw = await (
      api.scratchpad.openScratchpad as (
        d: Record<string, unknown>,
      ) => Promise<ScratchpadSession>
    )({
      sidecarRoot: SIDECAR_ROOT,
      namespace: NAMESPACE,
      space: SPACE,
    });
    assert.ok(raw, "openScratchpad must return a live session in phase 1");
    const session = raw;

    // ── The model must be fully reconstituted ────────────────────────────────
    // Belt-and-suspenders: deep-equal against what phase 0 flushed.
    assert.deepStrictEqual(
      session.model,
      expected,
      "model after cold-start reopen must deep-equal the model flushed in phase 0 — " +
        "all items, their state, modality, evals, and evidence must be reconstituted",
    );

    // ── The deferred item must be in the constraints section ─────────────────
    const phase1Model = session.model as unknown as SP3Model;
    const constraintsSec1 = phase1Model.sections.find(
      (s) => s.kind === "constraints",
    );
    assert.ok(
      constraintsSec1,
      "constraints section must be present after cold-start",
    );
    assert.equal(
      constraintsSec1.items.length,
      1,
      "constraints section must have exactly one item — the deferred one",
    );

    const deferredItem = constraintsSec1.items[0];

    // State
    assert.equal(
      deferredItem.state,
      "deferred",
      "deferred item must have state:'deferred' after cold-start reopen",
    );

    // Text
    assert.equal(
      deferredItem.text,
      DEFERRED_TEXT,
      `deferred item text must be '${DEFERRED_TEXT}' — item text must survive flush+reopen`,
    );

    // Modality
    assert.equal(
      deferredItem.modality,
      "optional",
      "deferred item modality must be 'optional' as authored in phase 0",
    );

    // Evals
    assert.equal(
      deferredItem.evals.complexity,
      3,
      "deferred item complexity eval must be 3 as authored in phase 0",
    );

    // Evidence
    assert.equal(
      deferredItem.evidence.length,
      1,
      "deferred item must retain its one evidence attachment after flush+reopen",
    );
    const ev = deferredItem.evidence[0] as SP3Evidence;
    assert.equal(
      ev.source,
      EVIDENCE_SOURCE,
      `evidence source must be '${EVIDENCE_SOURCE}'`,
    );
    assert.equal(
      ev.method,
      EVIDENCE_METHOD,
      `evidence method must be '${EVIDENCE_METHOD}'`,
    );
    assert.equal(
      ev.checkedAt,
      EVIDENCE_CHECKED_AT,
      "evidence checkedAt ISO string must survive serialisation round-trip",
    );

    // ── The rendered panel shows the deferred item and its evidence ───────────
    // INVARIANT: the person sees their deferred item when they reopen the space.
    const html = session.renderedHtml();

    assert.ok(
      html.includes(DEFERRED_TEXT),
      `renderedHtml() must contain '${DEFERRED_TEXT}' — the deferred item must be visible after reopen`,
    );

    // data-state="deferred" on the item element
    assert.ok(
      html.includes('data-state="deferred"'),
      "renderedHtml() must carry data-state='deferred' on the deferred item element",
    );

    // Evidence chip: class="evidence-chip" with data-method
    assert.ok(
      /class\s*=\s*["'][^"']*\bevidence-chip\b[^"']*["']/.test(html),
      "renderedHtml() must contain an element with class='evidence-chip' — the evidence attachment must be visible",
    );
    assert.ok(
      html.includes(EVIDENCE_METHOD),
      `renderedHtml() must include the evidence method '${EVIDENCE_METHOD}' — visible in the chip`,
    );

    // The item's modality marker must be visible
    assert.ok(
      /data-modality\s*=\s*["']optional["']/.test(html),
      "renderedHtml() must carry data-modality='optional' on the deferred item's modality span",
    );

    // The evals span must reflect complexity:3
    assert.ok(
      /data-complexity\s*=\s*["']3["']/.test(html),
      "renderedHtml() must carry data-complexity='3' on the deferred item's evals span",
    );
  }
}
