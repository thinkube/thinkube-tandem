/**
 * SP-21/3 AC-5 — Changes to settled items are old→new pairs; provenance persists.
 *
 * WHY (INVARIANT): A worker proposing an edit to a checked item must land as a
 * pending old→new pair rendered on that item — the checked text must not change
 * until a human resolve accepts it. A human resolve with accept:true applies the
 * new text; accept:false leaves the original text intact. In both cases the
 * pending pair is cleared. This visible-delta contract must hold forever: any
 * implementation that applies a proposeEdit silently (without the pending pair),
 * or that changes checked text without a human resolve, breaks this invariant.
 *
 * WHY (INVARIANT): After a save (flush), the item's origin field and attached
 * evidence array must be present in the persisted space document. Provenance
 * must round-trip through serialisation; it cannot live only in memory.
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

type Evidence = {
  source: string;
  method: string;
  checkedAt: string;
  dossierRef?: string;
};

type PendingEdit = { oldText: string; newText: string; origin: string };

type SP3Item = {
  id: string;
  text: string;
  checked: boolean;
  modality: string;
  state: string;
  origin: string;
  evidence: Evidence[];
  pendingEdit?: PendingEdit;
};

type SP3Section = {
  id: string;
  kind: string;
  items: SP3Item[];
};

type SP3Model = {
  sections: SP3Section[];
};

// WithSP3 is self-contained (not an intersection with ScratchpadSession) to
// avoid a structural conflict on `model` between SP-2's Section[] and SP-3's
// SP3Section[] — the cast from openScratchpad's return value handles the seam.
type WithSP3 = {
  postFromWebview(msg: SP3InboundMessage): Promise<void>;
  renderedHtml(): string;
  model: SP3Model;
  dispatch(action: unknown): unknown;
  flush(): Promise<void>;
};

// Marker strings — all-caps alphanumeric, HTML-escape safe.
const ORIGINAL_TEXT_A = "ORIGINALTEXTFORPENDINGACCEPT";
const NEW_TEXT_A = "NEWTEXTACCEPTEDBYRESOLVE";
const ORIGINAL_TEXT_B = "ORIGINALTEXTFORPENDINGREJECT";
const NEW_TEXT_B = "NEWTEXTREJECTEDBYRESOLVE";
const EVIDENCE_SOURCE = "EVIDENCESOURCEMARKER";
const EVIDENCE_METHOD = "manual";

/**
 * Find the first item matching predicate in any section of the model.
 * Returns undefined when not found (never throws).
 */
function findItem(
  model: SP3Model,
  predicate: (item: SP3Item) => boolean,
): SP3Item | undefined {
  for (const section of model.sections) {
    const found = section.items.find(predicate);
    if (found) return found;
  }
  return undefined;
}

export async function run(_phase: number): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension must be present");
  const api = (await ext.activate()) as TandemExtensionApi;

  // Use a fixed namespace and space so we can construct the file path for the
  // persistence assertion (Part 3).
  const NAMESPACE = "probens";
  const SPACE = "probespace";

  const tmpDir = path.join(os.tmpdir(), "tandem-probe-sp21-3-ac5");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  // No-op loadQuery — this test drives everything through dispatch; worker
  // rounds are not exercised here.
  const noopQuery = (): import("../scratchpad/workers/worker").QueryFn => {
    return async function* () {
      yield { type: "actions", actions: [] } as never;
    };
  };

  const session = await api.scratchpad.openScratchpad({
    sidecarRoot: tmpDir,
    namespace: NAMESPACE,
    space: SPACE,
    loadQuery: noopQuery,
  } as unknown as import("../scratchpad/session").ScratchpadSessionDeps);
  assert.ok(session, "openScratchpad must return a live session");

  const sp3 = session as unknown as WithSP3;

  // Seed the intent.
  await sp3.postFromWebview({
    type: "seedGoal",
    text: "PENDINGEDITTESTINTENT",
  });

  // ── Set up two checked items in a non-goal section ───────────────────────
  const constraintsSec = sp3.model.sections.find(
    (s) => s.kind === "constraints",
  );
  assert.ok(
    constraintsSec,
    "a fresh thinking space must have a constraints section to add items to",
  );

  // addItem with actor:"human" is born checked:true — these are the "settled" items.
  await sp3.postFromWebview({
    type: "addItem",
    sectionId: constraintsSec.id,
    text: ORIGINAL_TEXT_A,
  });
  await sp3.postFromWebview({
    type: "addItem",
    sectionId: constraintsSec.id,
    text: ORIGINAL_TEXT_B,
  });

  // Find both items by their text in the live model.
  const itemA = findItem(sp3.model, (i) => i.text === ORIGINAL_TEXT_A);
  const itemB = findItem(sp3.model, (i) => i.text === ORIGINAL_TEXT_B);

  assert.ok(
    itemA,
    `item '${ORIGINAL_TEXT_A}' must appear in the model after addItem via postFromWebview`,
  );
  assert.ok(
    itemA.checked,
    `item '${ORIGINAL_TEXT_A}' must be born checked:true (human addItem)`,
  );
  assert.ok(
    itemB,
    `item '${ORIGINAL_TEXT_B}' must appear in the model after addItem via postFromWebview`,
  );
  assert.ok(
    itemB.checked,
    `item '${ORIGINAL_TEXT_B}' must be born checked:true (human addItem)`,
  );

  // ── Part 1a: proposeEdit lands as a pending old→new pair ─────────────────
  // The integrator worker dispatches proposeEdit; here we dispatch directly to
  // test the rendering contract without relying on debounce timing.
  sp3.dispatch({
    type: "proposeEdit",
    actor: "integrator",
    itemId: itemA.id,
    newText: NEW_TEXT_A,
  } as unknown as Parameters<WithSP3["dispatch"]>[0]);

  sp3.dispatch({
    type: "proposeEdit",
    actor: "integrator",
    itemId: itemB.id,
    newText: NEW_TEXT_B,
  } as unknown as Parameters<WithSP3["dispatch"]>[0]);

  // The model must now carry a pendingEdit on both items.
  const itemAAfterPropose = findItem(sp3.model, (i) => i.id === itemA.id);
  assert.ok(
    itemAAfterPropose?.pendingEdit,
    `item '${ORIGINAL_TEXT_A}' must have a pendingEdit after proposeEdit is dispatched`,
  );
  assert.equal(
    itemAAfterPropose!.pendingEdit!.oldText,
    ORIGINAL_TEXT_A,
    "pendingEdit.oldText must equal the item's original text",
  );
  assert.equal(
    itemAAfterPropose!.pendingEdit!.newText,
    NEW_TEXT_A,
    "pendingEdit.newText must equal the proposed new text",
  );

  // The checked text must not have changed — only the pendingEdit is added.
  assert.equal(
    itemAAfterPropose!.text,
    ORIGINAL_TEXT_A,
    "the item's text must remain ORIGINAL_TEXT_A after proposeEdit — " +
      "checked text must never change without a human resolve",
  );

  // ── Part 1b: the rendered HTML must show the pending old→new pair ─────────
  const htmlWithPending = sp3.renderedHtml();

  assert.ok(
    /class\s*=\s*["'][^"']*\bpending-edit\b[^"']*["']/.test(htmlWithPending),
    'renderedHtml() must contain an element with class "pending-edit" after proposeEdit — ' +
      "the pending old→new pair must be visible in the panel markup",
  );
  assert.ok(
    /<del[^>]*>/.test(htmlWithPending),
    "the pending-edit element must contain a <del> tag showing the old text",
  );
  assert.ok(
    /<ins[^>]*>/.test(htmlWithPending),
    "the pending-edit element must contain an <ins> tag showing the new text",
  );
  assert.ok(
    htmlWithPending.includes(ORIGINAL_TEXT_A),
    `renderedHtml() must contain '${ORIGINAL_TEXT_A}' (the old text) inside the pending-edit del`,
  );
  assert.ok(
    htmlWithPending.includes(NEW_TEXT_A),
    `renderedHtml() must contain '${NEW_TEXT_A}' (the new text) inside the pending-edit ins`,
  );

  // ── Part 2a: resolveEdit accept:true applies the new text ─────────────────
  // INVARIANT: after a human resolve with accept:true the item text becomes
  // newText and the pendingEdit is cleared from both the model and the HTML.
  sp3.dispatch({
    type: "resolveEdit",
    actor: "human",
    itemId: itemA.id,
    accept: true,
  } as unknown as Parameters<WithSP3["dispatch"]>[0]);

  const itemAAfterAccept = findItem(sp3.model, (i) => i.id === itemA.id);
  assert.equal(
    itemAAfterAccept?.text,
    NEW_TEXT_A,
    "after resolveEdit accept:true the item text must equal NEW_TEXT_A — " +
      "the human's acceptance is the only act that applies the new text",
  );
  assert.equal(
    itemAAfterAccept?.pendingEdit,
    undefined,
    "after resolveEdit accept:true the pendingEdit must be cleared from the model",
  );

  const htmlAfterAccept = sp3.renderedHtml();
  assert.ok(
    htmlAfterAccept.includes(NEW_TEXT_A),
    `renderedHtml() must contain '${NEW_TEXT_A}' after accept — the applied text must be visible`,
  );
  assert.ok(
    !htmlAfterAccept.includes(ORIGINAL_TEXT_A) ||
      // Allow ORIGINAL_TEXT_A in contexts other than the pending-edit span
      // (e.g. a delta log) but the pending-edit span itself must be gone.
      !/<span[^>]*class\s*=\s*["'][^"']*\bpending-edit\b[^"']*["'][^>]*>[\s\S]*?ORIGINALTEXTFORPENDINGACCEPT/.test(
        htmlAfterAccept,
      ),
    "after resolveEdit accept:true the pending-edit span must be gone — " +
      "the original text must not remain inside a pending-edit element",
  );

  // ── Part 2b: resolveEdit accept:false leaves the original text unchanged ──
  // INVARIANT: after a human resolve with accept:false the item text stays at
  // its original value and the pendingEdit is cleared.
  sp3.dispatch({
    type: "resolveEdit",
    actor: "human",
    itemId: itemB.id,
    accept: false,
  } as unknown as Parameters<WithSP3["dispatch"]>[0]);

  const itemBAfterReject = findItem(sp3.model, (i) => i.id === itemB.id);
  assert.equal(
    itemBAfterReject?.text,
    ORIGINAL_TEXT_B,
    "after resolveEdit accept:false the item text must remain ORIGINAL_TEXT_B — " +
      "rejecting a proposed edit must leave the settled text unchanged",
  );
  assert.equal(
    itemBAfterReject?.pendingEdit,
    undefined,
    "after resolveEdit accept:false the pendingEdit must be cleared — " +
      "whether accepted or rejected, the pending pair is resolved and gone",
  );

  const htmlAfterReject = sp3.renderedHtml();
  assert.ok(
    htmlAfterReject.includes(ORIGINAL_TEXT_B),
    `renderedHtml() must still contain '${ORIGINAL_TEXT_B}' after reject — ` +
      "the original text must remain visible when the proposed edit is rejected",
  );
  assert.ok(
    !htmlAfterReject.includes(NEW_TEXT_B),
    `renderedHtml() must NOT contain '${NEW_TEXT_B}' after reject — ` +
      "the rejected new text must not appear anywhere in the panel",
  );

  // ── Part 3: after flush, origin and evidence are in the persisted document ─
  // INVARIANT: item provenance (origin, evidence) must survive serialisation.
  // We attach evidence to itemA (which now has text NEW_TEXT_A) and then flush.

  const NOW_ISO = "2025-01-01T12:00:00.000Z";

  sp3.dispatch({
    type: "attachEvidence",
    actor: "human",
    itemId: itemA.id,
    evidence: {
      source: EVIDENCE_SOURCE,
      method: EVIDENCE_METHOD,
      checkedAt: NOW_ISO,
      dossierRef: "research/probe-topic.md",
    },
  } as unknown as Parameters<WithSP3["dispatch"]>[0]);

  // Verify the evidence is in the model before flushing.
  const itemABeforeFlush = findItem(sp3.model, (i) => i.id === itemA.id);
  assert.ok(
    itemABeforeFlush?.evidence.some((e) => e.source === EVIDENCE_SOURCE),
    `item '${itemA.id}' must carry the attached evidence in the model before flush`,
  );

  // Flush to disk.
  await sp3.flush();

  // Construct the expected file path: <sidecarRoot>/<namespace>/thinking/<space>.json
  const spaceFilePath = path.join(
    tmpDir,
    NAMESPACE,
    "thinking",
    `${SPACE}.json`,
  );
  assert.ok(
    fs.existsSync(spaceFilePath),
    `the thinking-space document must exist at '${spaceFilePath}' after flush — ` +
      "the session must persist to <sidecarRoot>/<namespace>/thinking/<space>.json",
  );

  const savedDoc = JSON.parse(fs.readFileSync(spaceFilePath, "utf8")) as {
    sections: Array<{
      kind: string;
      items: Array<{
        id: string;
        text: string;
        origin: string;
        evidence: Evidence[];
      }>;
    }>;
  };

  // Find the saved item by id across all sections.
  const savedItem = savedDoc.sections
    .flatMap((s) => s.items)
    .find((i) => i.id === itemA.id);

  assert.ok(
    savedItem,
    `item '${itemA.id}' must appear in the saved document — ` +
      "the persisted space must include all items with their ids",
  );
  assert.equal(
    savedItem!.origin,
    "human",
    "the saved item must carry origin='human' — " +
      "items added via addItem with actor:human must persist their origin",
  );
  assert.ok(
    Array.isArray(savedItem!.evidence) &&
      savedItem!.evidence.some((e) => e.source === EVIDENCE_SOURCE),
    `the saved item must carry the attached evidence (source='${EVIDENCE_SOURCE}') — ` +
      "evidence must survive serialisation and be present in the space document",
  );
}
