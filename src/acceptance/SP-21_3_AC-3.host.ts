/**
 * SP-21/3 AC-3 — Prefill works and is visible.
 *
 * WHY (INVARIANT): After the author writes intent and triggers prefill, every
 * section receives proposed unchecked items carrying modality and evaluations.
 * While the worker round runs, the triggering control carries the disabled
 * attribute and the affected sections show data-activity="running". A round
 * failure surfaces as <div class="round-error"> inside the targeted section —
 * never as a silent nothing. These three visibility guarantees must hold
 * forever; any implementation that skips disabling controls, omits the
 * activity attribute, or silently swallows errors breaks this test.
 */

import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as vscode from "vscode";
import type { TandemExtensionApi } from "../extension";

// ── SP-3 type additions (not yet in source — resolve once the implementer ships) ──

/** The SP-3 extended inbound-message vocabulary (part-1 contract). */
type SP3InboundMessage =
  | { type: "seedGoal"; text: string } // kept from SP-2
  | { type: "addItem"; sectionId: string; text: string }
  | { type: "toggleItem"; itemId: string; checked: boolean }
  | { type: "prefill" }
  | { type: "reframe" }
  | { type: "resolveEdit"; itemId: string; accept: boolean };

/** Worker action types the SP-3 gapFiller may yield. */
type SP3ProposeItemAction = {
  type: "proposeItem";
  actor: "gap-filler";
  sectionId: string;
  item: {
    text: string;
    modality: "mandatory" | "optional";
    evals: { complexity?: 1 | 2 | 3; risk?: 1 | 2 | 3 };
  };
};

type SP3WorkerMessage = { type: "actions"; actions: SP3ProposeItemAction[] };

/** The SP-3 extended QueryFn signature (mcpTools + corpusPaths on options). */
type SP3QueryFn = (args: {
  prompt: string;
  options: {
    model: string;
    allowedTools: string[];
    disallowedTools: string[];
    mcpTools?: string[];
    corpusPaths?: string[];
  };
}) => AsyncIterable<SP3WorkerMessage>;

type WithSP3Post = {
  postFromWebview(msg: SP3InboundMessage): Promise<void>;
  renderedHtml(): string;
  model: { sections: Array<{ id: string; kind: string }> };
};

// Marker strings — all-caps alphanumeric, HTML-escape safe.
const GOAL_TEXT = "INTENTDRAFTFORGAPFILL";
const ITEM_CONSTRAINTS = "CONSTRAINTPROPOSEDITEMTEXT";
const ITEM_ELEMENTS = "ELEMENTPROPOSEDITEMTEXT";

/**
 * Count opening <button> tags that carry `disabled` but are NOT id="freeze".
 * The freeze button is independently and persistently disabled (no readiness
 * record) — we track only controls that gain/lose disabled around a round.
 */
function countNonFreezeDisabledButtons(html: string): number {
  let count = 0;
  const re = /<button\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    if (/\bid\s*=\s*["']freeze["']/.test(attrs)) continue;
    if (/\bdisabled\b/.test(attrs)) count++;
  }
  return count;
}

export async function run(_phase: number): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension must be present");
  const api = (await ext.activate()) as TandemExtensionApi;

  // ── Part 1 & 2: prefill lands unchecked items; sections show activity ───────

  // sessionRef is set before any round runs; the fake captures HTML via closure.
  let sessionRef: WithSP3Post | undefined;
  let htmlDuringRound: string | undefined;
  let disabledDuringRound = 0;

  const fakeLoadQuery = (): SP3QueryFn => {
    return async function* () {
      // This body runs while the prefill round is in flight (before actions land).
      if (sessionRef) {
        htmlDuringRound = sessionRef.renderedHtml();
        disabledDuringRound = countNonFreezeDisabledButtons(htmlDuringRound);
      }

      // Resolve section ids from the live model so proposeItem targets real sections.
      const constraintsSec = sessionRef?.model.sections.find(
        (s) => s.kind === "constraints",
      );
      const elementsSec = sessionRef?.model.sections.find(
        (s) => s.kind === "elements",
      );

      const actions: SP3ProposeItemAction[] = [];
      if (constraintsSec) {
        actions.push({
          type: "proposeItem",
          actor: "gap-filler",
          sectionId: constraintsSec.id,
          item: {
            text: ITEM_CONSTRAINTS,
            modality: "mandatory",
            evals: { complexity: 2, risk: 1 },
          },
        });
      }
      if (elementsSec) {
        actions.push({
          type: "proposeItem",
          actor: "gap-filler",
          sectionId: elementsSec.id,
          item: {
            text: ITEM_ELEMENTS,
            modality: "optional",
            evals: { complexity: 1 },
          },
        });
      }

      yield { type: "actions" as const, actions };
    };
  };

  const tmpDir = path.join(os.tmpdir(), "tandem-probe-sp21-3-ac3");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const session = await api.scratchpad.openScratchpad({
    sidecarRoot: tmpDir,
    loadQuery:
      fakeLoadQuery as unknown as () => import("../scratchpad/workers/worker").QueryFn,
  });
  assert.ok(session, "openScratchpad must return a live session");

  const sp3 = session as unknown as WithSP3Post;
  sessionRef = sp3; // wire before any round runs

  // Seed the intent so the gapFiller has something to work from.
  await sp3.postFromWebview({ type: "seedGoal", text: GOAL_TEXT });

  // Baseline: how many non-freeze buttons are disabled BEFORE the round.
  const disabledBefore = countNonFreezeDisabledButtons(sp3.renderedHtml());

  // ── Trigger prefill — runs through the fake synchronously ────────────────
  await sp3.postFromWebview({ type: "prefill" });

  // ── Part 2a: during the round the sections must show data-activity="running" ─
  assert.ok(
    htmlDuringRound !== undefined,
    "the fake QueryFn must have been called during the prefill round — " +
      "htmlDuringRound must be set, confirming the round ran through the fake",
  );
  assert.ok(
    /data-activity\s*=\s*["']running["']/.test(htmlDuringRound!),
    "while the prefill round is in flight, at least one section element must " +
      'carry data-activity="running" — the running-state visibility must appear ' +
      "before actions land",
  );

  // ── Part 2b: during the round the triggering control must be disabled ──────
  assert.ok(
    disabledDuringRound > disabledBefore,
    "while the prefill round is in flight, at least one non-freeze control must " +
      "gain the disabled attribute — the triggering control must be disabled " +
      "while the round runs so the author cannot double-trigger it",
  );

  // ── Part 1: after the round, proposed items are unchecked with modality/evals ─
  const htmlAfter = sp3.renderedHtml();

  // Items render as <li class="item"> with data-item-id.
  assert.ok(
    /class\s*=\s*["'][^"']*\bitem\b[^"']*["']/.test(htmlAfter),
    'renderedHtml() must contain elements with class "item" after prefill — ' +
      "proposed items must be rendered in the panel",
  );
  assert.ok(
    /data-item-id/.test(htmlAfter),
    "renderedHtml() must carry data-item-id on item elements after prefill — " +
      "the item id attribute is required by the spec contract render markup",
  );

  // Checkboxes must be UNCHECKED: no <input class="item-check"> carries `checked`.
  assert.ok(
    /<input[^>]*class\s*=\s*["'][^"']*\bitem-check\b[^"']*["'][^>]*>/.test(
      htmlAfter,
    ),
    'renderedHtml() must contain <input class="item-check"> for proposed items',
  );
  const itemCheckWithChecked =
    /<input[^>]*class\s*=\s*["'][^"']*\bitem-check\b[^"']*["'][^>]*\bchecked\b[^>]*>/g;
  assert.ok(
    !itemCheckWithChecked.test(htmlAfter),
    'worker-proposed items must arrive UNCHECKED — no <input class="item-check"> ' +
      "must carry the checked attribute after prefill; only a human act can check them",
  );

  // Modality span must be present.
  assert.ok(
    /class\s*=\s*["'][^"']*\bmodality\b[^"']*["']/.test(htmlAfter),
    'renderedHtml() must contain <span class="modality"> on proposed items — ' +
      "the modality each item carries must be visible in the panel markup",
  );
  assert.ok(
    /data-modality/.test(htmlAfter),
    "modality span must carry the data-modality attribute — " +
      "the spec contract render markup requires data-modality on the modality span",
  );

  // Evals span must be present.
  assert.ok(
    /class\s*=\s*["'][^"']*\bevals\b[^"']*["']/.test(htmlAfter),
    'renderedHtml() must contain <span class="evals"> on proposed items — ' +
      "the complexity/risk evaluations must be present in the item markup",
  );

  // The proposed item marker texts must appear in the rendered HTML.
  assert.ok(
    htmlAfter.includes(ITEM_CONSTRAINTS),
    `renderedHtml() must contain '${ITEM_CONSTRAINTS}' — ` +
      "the constraints item proposed by the gapFiller must be visible in the panel",
  );
  assert.ok(
    htmlAfter.includes(ITEM_ELEMENTS),
    `renderedHtml() must contain '${ITEM_ELEMENTS}' — ` +
      "the elements item proposed by the gapFiller must be visible in the panel",
  );

  // After the round, targeted sections must flip to data-activity="landed".
  assert.ok(
    /data-activity\s*=\s*["']landed["']/.test(htmlAfter),
    'after the round completes, at least one section must carry data-activity="landed" — ' +
      "the post-round landed state must be set on targeted sections",
  );

  // No section should still show "running" after the round is complete.
  assert.ok(
    !/data-activity\s*=\s*["']running["']/.test(htmlAfter),
    'after the round completes, no section may carry data-activity="running" — ' +
      "the running state is transient and must clear once the round is done",
  );

  // ── Part 3: a failing round renders <div class="round-error"> in-section ───

  const errTmpDir = path.join(os.tmpdir(), "tandem-probe-sp21-3-ac3-err");
  fs.rmSync(errTmpDir, { recursive: true, force: true });
  fs.mkdirSync(errTmpDir, { recursive: true });

  const errorFakeLoadQuery = (): SP3QueryFn => {
    // Throws immediately — simulates a round that fails (network error, etc.).
    return async function* () {
      throw new Error("ROUNDFAILUREMARKER");
      yield { type: "actions" as const, actions: [] }; // unreachable; satisfies TS
    };
  };

  const errorSession = await api.scratchpad.openScratchpad({
    sidecarRoot: errTmpDir,
    loadQuery:
      errorFakeLoadQuery as unknown as () => import("../scratchpad/workers/worker").QueryFn,
  });
  assert.ok(
    errorSession,
    "openScratchpad must return a live error-test session",
  );

  const errSP3 = errorSession as unknown as WithSP3Post;
  await errSP3.postFromWebview({ type: "seedGoal", text: "ERRORTESTINTENT" });

  // postFromWebview must NOT reject — the session absorbs the error and renders it.
  await errSP3.postFromWebview({ type: "prefill" });

  const errorHtml = errSP3.renderedHtml();

  assert.ok(
    /class\s*=\s*["'][^"']*\bround-error\b[^"']*["']/.test(errorHtml),
    'a round failure must render an element with class "round-error" inside the ' +
      "targeted section — errors must surface in place, never as a silent nothing",
  );
  assert.ok(
    /data-activity\s*=\s*["']failed["']/.test(errorHtml),
    'a round failure must set data-activity="failed" on the targeted section — ' +
      "the failure state must be reflected on the section element, not only in the error div",
  );
}
