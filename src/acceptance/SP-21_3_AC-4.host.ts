/**
 * SP-21/3 AC-4 — One intent surface; reframe rewrites from checked items only.
 *
 * WHY (INVARIANT): The panel contains exactly one intent editor element
 * (#goal-input). This is a cardinality guarantee — not a one-time removal
 * check — and must hold in every future rendering of the panel regardless of
 * how many items exist or what state the space is in.
 *
 * WHY (INVARIANT): The reframe worker's prompt must contain the verbatim text
 * of every checked item and NO unchecked item's text. This deliberate scope —
 * only what the human has settled — is the mechanism that grounds the reframed
 * intent in the author's choices rather than in proposed-but-unjudged content.
 * Both invariants must hold forever.
 */

import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as vscode from "vscode";
import type { TandemExtensionApi } from "../extension";

// ── SP-3 type additions (not yet in source — resolve once the implementer ships) ──

type SP3InboundMessage =
  | { type: "seedGoal"; text: string }
  | { type: "addItem"; sectionId: string; text: string }
  | { type: "toggleItem"; itemId: string; checked: boolean }
  | { type: "prefill" }
  | { type: "reframe" }
  | { type: "resolveEdit"; itemId: string; accept: boolean };

type SP3WorkerMessage = { type: "actions"; actions: never[] };

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

type SP3Item = {
  id: string;
  text: string;
  checked: boolean;
  modality: string;
  state: string;
};

type SP3Section = {
  id: string;
  kind: string;
  items: SP3Item[];
};

type SP3Model = {
  sections: SP3Section[];
};

type WithSP3 = {
  postFromWebview(msg: SP3InboundMessage): Promise<void>;
  renderedHtml(): string;
  model: SP3Model;
  dispatch(action: unknown): unknown;
};

// Marker strings — all-caps alphanumeric, HTML-escape safe.
const CHECKED_CONSTRAINT = "CHECKEDCONSTRAINTTEXT";
const CHECKED_ELEMENT = "CHECKEDELEMENTTEXT";
const UNCHECKED_GAP = "UNCHECKEDGAPITEMTEXT";
const UNCHECKED_CRITERIA = "UNCHECKEDCRITERIAITEMTEXT";

/**
 * Count occurrences of id="goal-input" (single or double quotes) in the HTML.
 * The spec contract mandates EXACTLY ONE such element in the panel at all times.
 */
function countGoalInputs(html: string): number {
  return (html.match(/id\s*=\s*["']goal-input["']/g) ?? []).length;
}

export async function run(_phase: number): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension must be present");
  const api = (await ext.activate()) as TandemExtensionApi;

  // ── Part 1: exactly one #goal-input — cardinality test ───────────────────

  // Use a fake that records the reframe prompt for Part 2.
  let capturedReframePrompt: string | undefined;

  const fakeLoadQuery = (): SP3QueryFn => {
    return async function* (args) {
      // Every round passes through this fake.
      // We capture the prompt unconditionally; the reframe round is the last
      // one triggered in this test.
      capturedReframePrompt = args.prompt;
      yield { type: "actions" as const, actions: [] };
    };
  };

  const tmpDir = path.join(os.tmpdir(), "tandem-probe-sp21-3-ac4");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const session = await api.scratchpad.openScratchpad({
    sidecarRoot: tmpDir,
    loadQuery:
      fakeLoadQuery as unknown as () => import("../scratchpad/workers/worker").QueryFn,
  });
  assert.ok(session, "openScratchpad must return a live session");

  const sp3 = session as unknown as WithSP3;

  // Seed goal so the panel is in its normal authoring state.
  await sp3.postFromWebview({ type: "seedGoal", text: "REFRAMETESTINTENT" });

  // ── Assert cardinality on the freshly-opened panel ──────────────────────────
  // INVARIANT: exactly one #goal-input must be present immediately after open.
  assert.equal(
    countGoalInputs(sp3.renderedHtml()),
    1,
    'the panel must contain EXACTLY ONE element with id="goal-input" after opening — ' +
      "the spec contract mandates a single intent editor (the cardinality must hold always, " +
      "not only at first render)",
  );

  // ── Part 2: reframe prompt contains only checked items ────────────────────

  // Find sections by kind so we can add items to them.
  const constraintsSec = sp3.model.sections.find(
    (s) => s.kind === "constraints",
  );
  const elementsSec = sp3.model.sections.find((s) => s.kind === "elements");
  const gapSec = sp3.model.sections.find((s) => s.kind === "gap");
  const criteriaSec = sp3.model.sections.find((s) => s.kind === "acceptance");

  assert.ok(
    constraintsSec,
    "a fresh thinking space must have a constraints section",
  );
  assert.ok(
    elementsSec,
    "a fresh thinking space must have an elements section",
  );
  assert.ok(gapSec, "a fresh thinking space must have a gap section");
  assert.ok(criteriaSec, "a fresh thinking space must have a criteria section");

  // Add items that will be CHECKED (addItem with actor:"human" is born checked:true).
  await sp3.postFromWebview({
    type: "addItem",
    sectionId: constraintsSec.id,
    text: CHECKED_CONSTRAINT,
  });
  await sp3.postFromWebview({
    type: "addItem",
    sectionId: elementsSec.id,
    text: CHECKED_ELEMENT,
  });

  // Add items that will be UNCHECKED via proposeItem dispatch (actor != human,
  // born checked:false per the reducer invariant).
  sp3.dispatch({
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: gapSec.id,
    item: { text: UNCHECKED_GAP, modality: "optional", evals: {} },
  } as unknown as Parameters<WithSP3["dispatch"]>[0]);

  sp3.dispatch({
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: criteriaSec.id,
    item: { text: UNCHECKED_CRITERIA, modality: "optional", evals: {} },
  } as unknown as Parameters<WithSP3["dispatch"]>[0]);

  // Verify the mix before triggering reframe.
  const constraintsItems =
    sp3.model.sections.find((s) => s.kind === "constraints")?.items ?? [];
  const gapItems =
    sp3.model.sections.find((s) => s.kind === "gap")?.items ?? [];

  assert.ok(
    constraintsItems.some((i) => i.text === CHECKED_CONSTRAINT && i.checked),
    `${CHECKED_CONSTRAINT} must be in the model as a checked item before reframe`,
  );
  assert.ok(
    gapItems.some((i) => i.text === UNCHECKED_GAP && !i.checked),
    `${UNCHECKED_GAP} must be in the model as an unchecked item before reframe`,
  );

  // ── Trigger reframe — the fake records the prompt ─────────────────────────
  await sp3.postFromWebview({ type: "reframe" });

  assert.ok(
    capturedReframePrompt !== undefined,
    "the fake QueryFn must have been called for the reframe round — " +
      "capturedReframePrompt must be set",
  );

  // ── Checked items' text must appear in the reframe prompt ─────────────────
  // INVARIANT: checked items are the human-settled content; the reframe worker
  // must see all of them so it can synthesise the intent accurately.
  assert.ok(
    capturedReframePrompt!.includes(CHECKED_CONSTRAINT),
    `reframe prompt must contain '${CHECKED_CONSTRAINT}' — ` +
      "every checked item's verbatim text must be present in the reframe prompt",
  );
  assert.ok(
    capturedReframePrompt!.includes(CHECKED_ELEMENT),
    `reframe prompt must contain '${CHECKED_ELEMENT}' — ` +
      "every checked item's verbatim text must be present in the reframe prompt",
  );

  // ── Unchecked items' text must NOT appear in the reframe prompt ───────────
  // INVARIANT: unchecked items are proposals not yet accepted by the human; the
  // reframe worker must be blind to them — the prompt must contain NONE of their
  // text. This is the deliberate scope that grounds the reframed intent in human
  // choices, not proposed-but-unjudged content.
  assert.ok(
    !capturedReframePrompt!.includes(UNCHECKED_GAP),
    `reframe prompt must NOT contain '${UNCHECKED_GAP}' — ` +
      "unchecked items are not settled and must be absent from the reframe prompt",
  );
  assert.ok(
    !capturedReframePrompt!.includes(UNCHECKED_CRITERIA),
    `reframe prompt must NOT contain '${UNCHECKED_CRITERIA}' — ` +
      "unchecked items are not settled and must be absent from the reframe prompt",
  );

  // ── Cardinality after adding items and triggering reframe ─────────────────
  // INVARIANT: the single #goal-input must survive item additions and rounds.
  // This is the standing guarantee — not just at first render.
  assert.equal(
    countGoalInputs(sp3.renderedHtml()),
    1,
    'the panel must still contain EXACTLY ONE element with id="goal-input" ' +
      "after adding items and running the reframe round — " +
      "the cardinality must hold through all model changes, not only at first render",
  );
}
