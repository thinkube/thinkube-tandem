/**
 * SP-21/3 AC-9 — The space lives across TEPs.
 *
 * WHY (INVARIANT): A thinking space is not single-use. After a freeze produces a TEP id,
 * the items that shipped render locked (data-state="shipped", data-shipped-in="<tep>") and
 * the space remains editable — the intent editor is still present and new items can be
 * added. The space's accumulated context — shipped items and their evidence dossier
 * references — travels into the prefill worker's observed prompt so subsequent rounds are
 * grounded in prior research. A second freeze projects ONLY the newly checked+active items
 * into its body; the previously shipped items never reappear in that body. This behaviour
 * must hold forever: any implementation that locks the space after a freeze, drops shipped
 * items from the prefill prompt, or re-ships previously shipped items in a subsequent
 * freeze, breaks this test.
 */

import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as vscode from "vscode";
import type { TandemExtensionApi } from "../extension";
import type {
  ScratchpadSession,
  ScratchpadSessionDeps,
} from "../scratchpad/session";
import type { Action } from "../scratchpad/model";
import type { QueryFn } from "../scratchpad/workers/worker";

// ── SP-3 types defined locally; resolve once the implementer ships ─────────────

interface DryRunResult {
  covered: boolean;
  cleanCut: boolean;
  gapSection: string | null;
}

interface SigningTool {
  stamp(body: string): string;
  writeTep(args: {
    thinking_space: string;
    title: string;
    status: string;
    body: string;
  }): Promise<{ tep: string }>;
}

interface SP3Deps extends ScratchpadSessionDeps {
  space?: string;
  namespace?: string;
  runSlicer?: (intent: string) => Promise<DryRunResult>;
  signing?: SigningTool;
  now?: () => Date;
}

type SP3Session = ScratchpadSession & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  postFromWebview(msg: Record<string, unknown>): Promise<void>;
};

// ── HTML helpers ────────────────────────────────────────────────────────────────

function freezeButtonTag(html: string): string {
  const m = html.match(/<button\b[^>]*\bid\s*=\s*["']freeze["'][^>]*>/i);
  if (!m) {
    throw new Error(
      'renderedHtml() must contain <button id="freeze"> — ' +
        "the Freeze control must always be rendered in the panel",
    );
  }
  return m[0];
}

function freezeIsDisabled(html: string): boolean {
  return /\bdisabled\b/.test(freezeButtonTag(html));
}

// ── Marker strings — all-caps alphanumeric only, HTML-escape safe ─────────────
/** Text of the item shipped in the first freeze. */
const FIRST_TEP_ITEM_AC9 = "FIRSTTEPITEMAC9";
/** Dossier reference attached as evidence to the first freeze's item. */
const DOSSIER_REF_AC9 = "DOSSIERREFAC9";
/** Text of the item added for the second freeze. */
const SECOND_TEP_ITEM_AC9 = "SECONDTEPITEMAC9";
/** Stamp sentinel appended by fake signing.stamp(). */
const STAMP_SENTINEL_AC9 = "STAMPSENTINELAC9";
/** TEP id returned by the first fake writeTep() call. */
const TEP_ID_FIRST = "TEPIDAC9FIRST";
/** TEP id returned by the second fake writeTep() call. */
const TEP_ID_SECOND = "TEPIDAC9SECOND";

export async function run(_phase: number): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension must be present");
  const api = (await ext.activate()) as TandemExtensionApi;

  const tmpDir = path.join(os.tmpdir(), "tandem-probe-sp21-3-ac9");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  // ── Fake signing tool — returns different TEP ids on each call ───────────
  let freezeCount = 0;
  const stampBodies: string[] = [];
  const writeTepBodies: string[] = [];

  const fakeSigning: SigningTool = {
    stamp(body: string): string {
      stampBodies.push(body);
      return body + "\n<!-- " + STAMP_SENTINEL_AC9 + " -->";
    },
    async writeTep(args) {
      freezeCount++;
      writeTepBodies.push(args.body);
      return { tep: freezeCount === 1 ? TEP_ID_FIRST : TEP_ID_SECOND };
    },
  };

  // ── Fake runSlicer — scripted to return a clean result every time ─────────
  const fakeRunSlicer = async (_intent: string): Promise<DryRunResult> => ({
    covered: true,
    cleanCut: true,
    gapSection: null,
  });

  // ── Fake loadQuery — captures all observed prompts without side effects ───
  // The prefill worker runs via the gapFiller role; this fake observes the full
  // prompt that the session builds for it (which must include shipped items and
  // their evidence dossierRefs per the SPEC CONTRACT) and yields nothing (no
  // item proposals are needed for this probe).
  const observedPrompts: string[] = [];
  const fakeLoadQuery = (): QueryFn => {
    return async function* (args) {
      observedPrompts.push(args.prompt);
      // Yield nothing — no proposals needed; this probe only observes the prompt.
    };
  };

  const deps: SP3Deps = {
    sidecarRoot: tmpDir,
    namespace: "probe-ac9-ns",
    space: "ac9-space",
    signing: fakeSigning,
    runSlicer: fakeRunSlicer,
    loadQuery: fakeLoadQuery,
    now: () => new Date("2024-06-01T00:00:00Z"),
  };

  const raw = await api.scratchpad.openScratchpad(
    deps as unknown as ScratchpadSessionDeps,
  );
  assert.ok(raw, "openScratchpad must return a live session");
  const session = raw as unknown as SP3Session;

  // ── Set up the space for the first freeze ────────────────────────────────

  // Goal: set non-empty intent text (SP-1 editGoal action; covers the goal section).
  session.dispatch({ type: "editGoal", text: "INTENTAC9FIRST" } as Action);

  // Constraints: add the item that will ship in the first freeze.
  const constraintsSec = (
    session.model.sections as Array<{ id: string; kind: string }>
  ).find((s) => s.kind === "constraints");
  assert.ok(constraintsSec, "constraints section must exist in a fresh space");

  session.dispatch({
    type: "addItem",
    actor: "human",
    sectionId: constraintsSec.id,
    text: FIRST_TEP_ITEM_AC9,
    modality: "mandatory",
  } as unknown as Action);

  // Retrieve the newly added item so we can attach evidence to it.
  // The reducer assigns an id to every item; we read it from the live model.
  const constraintsAfterAdd = (
    session.model.sections as Array<{
      id: string;
      kind: string;
      items: Array<{ id: string; text: string }>;
    }>
  ).find((s) => s.kind === "constraints");
  const firstItem = constraintsAfterAdd?.items.find(
    (i) => i.text === FIRST_TEP_ITEM_AC9,
  );
  assert.ok(
    firstItem,
    "the added item must be findable in the model after dispatch",
  );

  // Attach evidence with a recognisable dossierRef so we can verify it travels
  // into the prefill prompt after the first freeze.
  session.dispatch({
    type: "attachEvidence",
    actor: "human",
    itemId: firstItem.id,
    evidence: {
      source: "probe-manual",
      method: "review",
      checkedAt: "2024-06-01T00:00:00Z",
      dossierRef: DOSSIER_REF_AC9,
    },
  } as unknown as Action);

  // Cover the remaining non-goal sections.
  const COVER_KINDS = ["elements", "gap", "criteria", "verification"] as const;
  for (const kind of COVER_KINDS) {
    const sec = (
      session.model.sections as Array<{ id: string; kind: string }>
    ).find((s) => s.kind === kind);
    assert.ok(sec, `${kind} section must exist in a fresh space`);
    session.dispatch({
      type: "addItem",
      actor: "human",
      sectionId: sec.id,
      text: `COVERITEMAC9${kind.toUpperCase()}`,
      modality: "mandatory",
    } as unknown as Action);
  }

  // Trigger the first checkReadiness → clean dry-run → freeze enables.
  await session.postFromWebview({ type: "checkReadiness" });
  assert.ok(
    !freezeIsDisabled(session.renderedHtml()),
    "freeze button must not be disabled after all sections are covered and dry-run is clean (first freeze setup)",
  );

  // ── First freeze ─────────────────────────────────────────────────────────
  await session.postFromWebview({ type: "freeze" });

  assert.equal(
    freezeCount,
    1,
    "signing.writeTep() must have been called exactly once after the first freeze{}",
  );

  // ── Part A: Shipped items render locked carrying the first TEP id ─────────
  //
  // WHY (INVARIANT): after a freeze the items that were projected (checked+active)
  // transition to state "shipped" and shippedIn = "<tep>". The rendered HTML must
  // reflect this with data-state="shipped" and data-shipped-in="<tep>" so the
  // person can see which TEP each item shipped in. Shipped items must carry the
  // disabled attribute on their checkbox — they are locked, not re-checkable.
  {
    const html = session.renderedHtml();

    assert.ok(
      html.includes(`data-state="shipped"`),
      'renderedHtml() must contain data-state="shipped" after the first freeze — ' +
        "the item must be marked as shipped in the rendered panel",
    );

    assert.ok(
      html.includes(`data-shipped-in="${TEP_ID_FIRST}"`),
      `renderedHtml() must contain data-shipped-in="${TEP_ID_FIRST}" — ` +
        "the item must carry the id of the TEP it shipped in",
    );

    // ── Part A continued: space stays editable ─────────────────────────────
    //
    // WHY (INVARIANT): a freeze must not close the space. The person must still
    // be able to write new intent and add new items — the #goal-input must remain
    // in the rendered panel, not be removed or disabled by the freeze.
    assert.ok(
      /id\s*=\s*["']goal-input["']/.test(html),
      'renderedHtml() must still contain id="goal-input" after the first freeze — ' +
        "the space stays open for continued authoring; it is not closed by a freeze",
    );

    // The freeze button must still be rendered (though likely re-disabled, since
    // new items need a new readiness check before the next freeze).
    assert.ok(
      /id\s*=\s*["']freeze["']/.test(html),
      'renderedHtml() must still contain <button id="freeze"> after the first freeze — ' +
        "the freeze control persists for the next cycle",
    );
  }

  // ── Part B: Prefill includes prior items and their evidence dossier refs ──
  //
  // WHY (INVARIANT): the prefill worker's prompt must include the full accumulated
  // context of the space — every existing item (including shipped ones) and each
  // item's evidence dossierRefs. This grounds subsequent prefill rounds in the
  // research already done for prior TEPs. An implementation that drops shipped
  // items or strips evidence from the prompt causes the assistant to re-investigate
  // things already settled, wasting the dossier.
  //
  // Add new intent text to simulate "adding new intent lines later" (the scenario
  // described in AC-9), then trigger prefill and observe the prompt.
  session.dispatch({ type: "editGoal", text: "INTENTAC9SECOND" } as Action);

  const promptCountBefore = observedPrompts.length;
  await session.postFromWebview({ type: "prefill" });

  assert.ok(
    observedPrompts.length > promptCountBefore,
    "triggering prefill{} must invoke the loadQuery (the worker's prompt must be observable)",
  );

  const prefillPrompt = observedPrompts[observedPrompts.length - 1];
  assert.ok(
    typeof prefillPrompt === "string" && prefillPrompt.length > 0,
    "the observed prefill prompt must be a non-empty string",
  );

  // The shipped item's text must appear in the prefill prompt.
  assert.ok(
    prefillPrompt.includes(FIRST_TEP_ITEM_AC9),
    `prefill prompt must contain '${FIRST_TEP_ITEM_AC9}' — ` +
      "shipped items must travel into the prefill prompt as accumulated context",
  );

  // The shipped item's evidence dossierRef must appear in the prefill prompt.
  assert.ok(
    prefillPrompt.includes(DOSSIER_REF_AC9),
    `prefill prompt must contain '${DOSSIER_REF_AC9}' (the evidence dossierRef) — ` +
      "evidence dossier references must travel into the prefill prompt so the worker can " +
      "build on prior research instead of re-investigating settled questions",
  );

  // ── Part C: Second freeze ships ONLY the new items, not the shipped ones ──
  //
  // WHY (INVARIANT): projectDelta selects items where checked === true AND
  // state === "active". The previously shipped items (state === "shipped") must
  // never appear in a subsequent freeze body. This is the "space lives across
  // TEPs" invariant in its sharpest form: each TEP is a clean projection of ONLY
  // the new intent, not a re-publication of everything ever decided.
  //
  // Add a new checked item to constraints for the second TEP.
  const constraintsSecForSecondTep = (
    session.model.sections as Array<{ id: string; kind: string }>
  ).find((s) => s.kind === "constraints");
  assert.ok(
    constraintsSecForSecondTep,
    "constraints section must still exist after the first freeze",
  );

  session.dispatch({
    type: "addItem",
    actor: "human",
    sectionId: constraintsSecForSecondTep.id,
    text: SECOND_TEP_ITEM_AC9,
    modality: "mandatory",
  } as unknown as Action);

  // Re-cover the non-goal sections that may now lack a checked active item
  // (the items added for the first freeze are now "shipped", not "active").
  // Add fresh items to each non-goal section to restore coverage.
  for (const kind of COVER_KINDS) {
    const sec = (
      session.model.sections as Array<{ id: string; kind: string }>
    ).find((s) => s.kind === kind);
    assert.ok(sec, `${kind} section must still exist after the first freeze`);
    session.dispatch({
      type: "addItem",
      actor: "human",
      sectionId: sec.id,
      text: `REFILLITEMAC9${kind.toUpperCase()}`,
      modality: "mandatory",
    } as unknown as Action);
  }

  // Trigger the second checkReadiness → freeze enables for the second cycle.
  await session.postFromWebview({ type: "checkReadiness" });
  assert.ok(
    !freezeIsDisabled(session.renderedHtml()),
    "freeze button must not be disabled after new items are checked and dry-run is clean (second freeze setup)",
  );

  // Trigger the second freeze.
  await session.postFromWebview({ type: "freeze" });

  assert.equal(
    freezeCount,
    2,
    "signing.writeTep() must have been called exactly twice in total — once per freeze",
  );

  assert.equal(
    stampBodies.length,
    2,
    "signing.stamp() must have been called exactly twice in total — once per freeze",
  );

  // The second freeze's stamp body must include the new item.
  const secondStampBody = stampBodies[1];
  assert.ok(
    secondStampBody.includes(SECOND_TEP_ITEM_AC9),
    `second freeze's stamp body must contain '${SECOND_TEP_ITEM_AC9}' — ` +
      "the newly checked+active item must be projected into the second freeze body",
  );

  // The second freeze's stamp body must NOT include the first TEP's shipped item.
  // projectDelta selects state === "active" items only; shipped items are excluded.
  assert.ok(
    !secondStampBody.includes(FIRST_TEP_ITEM_AC9),
    `second freeze's stamp body must NOT contain '${FIRST_TEP_ITEM_AC9}' — ` +
      "items already shipped in the first TEP (state='shipped') must never reappear " +
      "in a subsequent freeze body; each TEP projects only the new intent",
  );

  // Belt-and-suspenders: the second body also carries the stamp sentinel.
  const secondWriteTepBody = writeTepBodies[1];
  assert.ok(
    secondWriteTepBody.includes(STAMP_SENTINEL_AC9),
    `second freeze's writeTep body must contain the stamp sentinel '${STAMP_SENTINEL_AC9}' — ` +
      "the stamp → writeTep ordering must hold on every freeze cycle, not only the first",
  );
}
