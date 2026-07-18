/**
 * SP-21/3 AC-8 — Freeze produces a TEP from the new checked items.
 *
 * WHY (INVARIANT): The freeze control (button#freeze) is gated on item-derived section
 * coverage and a scripted dry-run signal. A section lacking any checked active item (or the
 * goal lacking non-empty intent text) means coverage failure: the button is disabled and
 * its data-reason names the specific section kind. Once all sections are covered AND a
 * clean scripted dry-run has been recorded via the checkReadiness{} message, the button
 * enables (data-reason=""). Triggering freeze{} calls signing.stamp() exactly once with a
 * body projected from ONLY checked+active items — no unchecked item ever appears — then
 * calls signing.writeTep() exactly once with the stamped body (which carries the provenance
 * stamp line appended by stamp()). This must hold forever: any implementation that fires
 * the freeze while items are uncovered, includes unchecked items in the projected body, or
 * misorders stamp → writeTep, breaks this test.
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

// ── SP-3 types defined locally; resolve once the implementer ships ─────────────
// They will be exported from their respective modules (freeze.ts, session.ts, etc.)
// and imported directly in future versions of this file. Defining them here allows
// the test to compile and name the failure modes precisely before the implementation.

interface DryRunResult {
  covered: boolean;
  cleanCut: boolean;
  gapSection: string | null;
}

/**
 * SP-3 SigningTool — stamp() appends the provenance comment; writeTep() writes the frozen
 * artifact. Production implementation: makeServerSigningTool() in src/scratchpad/freeze.ts.
 */
interface SigningTool {
  stamp(body: string): string;
  writeTep(args: {
    thinking_space: string;
    title: string;
    status: string;
    body: string;
  }): Promise<{ tep: string }>;
}

/**
 * SP-3 additions to ScratchpadSessionDeps.
 * The implementer merges these into the exported ScratchpadSessionDeps type.
 */
interface SP3Deps extends ScratchpadSessionDeps {
  space?: string;
  namespace?: string;
  runSlicer?: (intent: string) => Promise<DryRunResult>;
  signing?: SigningTool;
  now?: () => Date;
}

/** Session widened to include the SP-3 postFromWebview vocabulary. */
type SP3Session = ScratchpadSession & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  postFromWebview(msg: Record<string, unknown>): Promise<void>;
};

// ── HTML helpers ────────────────────────────────────────────────────────────────

/** Extract the opening tag of <button id="freeze"> from the rendered HTML. */
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

/**
 * Extract the data-reason attribute value from the freeze button.
 * An absent data-reason attribute is itself a test failure — the freeze button must
 * always carry one (empty string = enabled; non-empty = the specific failing signal).
 */
function freezeReason(html: string): string {
  const tag = freezeButtonTag(html);
  const m = tag.match(/\bdata-reason\s*=\s*["']([^"']*)["']/);
  if (m === null) {
    throw new Error(
      `freeze button tag '${tag}' must carry a data-reason attribute — ` +
        "empty string means enabled; 'coverage:<kind>' or 'dryrun:<kind>' means blocked",
    );
  }
  return m[1];
}

/** True iff the freeze button's opening tag contains the bare 'disabled' attribute. */
function freezeIsDisabled(html: string): boolean {
  return /\bdisabled\b/.test(freezeButtonTag(html));
}

// ── Marker strings — all-caps alphanumeric only, HTML-escape safe ─────────────
// No quotes, angle-brackets, or ampersands so HTML escaping cannot mask them.
const INTENT_AC8 = "INTENTTEXTAC8";
const CHECKED_ITEM_AC8 = "CHECKEDITEMAC8";
const UNCHECKED_ITEM_AC8 = "UNCHECKEDITEMAC8";
/** Sentinel appended by the fake stamp() — proves stamp → writeTep ordering. */
const STAMP_SENTINEL_AC8 = "STAMPSENTINELAC8";
const TEP_ID_AC8 = "TEPIDAC8";

export async function run(_phase: number): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension must be present");
  const api = (await ext.activate()) as TandemExtensionApi;

  const tmpDir = path.join(os.tmpdir(), "tandem-probe-sp21-3-ac8");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  // ── Fake signing tool — records stamp() and writeTep() calls verbatim ────
  // A real signing tool appends "<!-- frozen: hmac-sha256:<hex> -->"; the fake
  // appends the STAMP_SENTINEL_AC8 sentinel so the test can verify the pipeline
  // calls writeTep() with the stamped body (not the raw body), without needing a
  // real HMAC secret.
  let stampCalls = 0;
  let lastStampBodyArg = "";
  let writeTepCalls = 0;
  let lastWriteTepBodyArg = "";
  let lastWriteTepStatus = "";

  const fakeSigning: SigningTool = {
    stamp(body: string): string {
      stampCalls++;
      lastStampBodyArg = body;
      return body + "\n<!-- " + STAMP_SENTINEL_AC8 + " -->";
    },
    async writeTep(args) {
      writeTepCalls++;
      lastWriteTepBodyArg = args.body;
      lastWriteTepStatus = args.status;
      return { tep: TEP_ID_AC8 };
    },
  };

  // ── Fake runSlicer — scripted to return a clean result ───────────────────
  let slicerCalls = 0;
  const fakeRunSlicer = async (_intent: string): Promise<DryRunResult> => {
    slicerCalls++;
    return { covered: true, cleanCut: true, gapSection: null };
  };

  const deps: SP3Deps = {
    sidecarRoot: tmpDir,
    namespace: "probe-ac8-ns",
    space: "ac8-freeze",
    signing: fakeSigning,
    runSlicer: fakeRunSlicer,
    now: () => new Date("2024-06-01T00:00:00Z"),
    // No loadQuery: workers are no-op; the prefill/worker path is not exercised in AC-8.
  };

  const raw = await api.scratchpad.openScratchpad(
    deps as unknown as ScratchpadSessionDeps,
  );
  assert.ok(raw, "openScratchpad must return a live session");
  const session = raw as unknown as SP3Session;

  // ── Part A: Coverage failure — a fresh space has no checked items ─────────
  //
  // WHY (INVARIANT): A fresh thinking space seeds six sections with empty item
  // lists and no intent text. The freeze button must be disabled and data-reason
  // must name the first uncovered section kind with prefix "coverage:". The button
  // must carry the disabled attribute. This establishes the baseline gating rule:
  // coverage failure → disabled, reason names the offender.
  {
    const html = session.renderedHtml();

    assert.ok(
      freezeIsDisabled(html),
      "freeze button must carry 'disabled' on a fresh space — no section is covered yet",
    );

    const reason = freezeReason(html);
    assert.match(
      reason,
      /^coverage:/,
      `data-reason must start with 'coverage:' on a fresh space — got '${reason}'; ` +
        "the first failing signal on a space with no checked items and no intent text is always a coverage gap",
    );

    const namedKind = reason.slice("coverage:".length);
    assert.ok(
      namedKind.length > 0,
      `data-reason '${reason}' must name a specific section kind after 'coverage:' — ` +
        "the reason must identify the offending section, not just the signal class",
    );
  }

  // ── Set up the model: cover all sections, add one checked item and one
  //    unchecked item to constraints (for the body-content assertion in Part C).

  // Goal coverage: intent text non-empty. editGoal is the SP-1 action that sets
  // the goal section's text field; coverage for the goal kind is: section.text !== "".
  session.dispatch({ type: "editGoal", text: INTENT_AC8 } as Action);

  // Constraints: add one CHECKED item (actor:"human" → born checked:true, state:"active")
  // and one UNCHECKED item (actor:"gap-filler" → born checked:false, state:"active").
  // The checked item must appear in the freeze body; the unchecked one must not.
  const constraintsSec = (
    session.model.sections as Array<{ id: string; kind: string }>
  ).find((s) => s.kind === "constraints");
  assert.ok(constraintsSec, "constraints section must exist in a fresh space");

  session.dispatch({
    type: "addItem",
    actor: "human",
    sectionId: constraintsSec.id,
    text: CHECKED_ITEM_AC8,
    modality: "mandatory",
  } as unknown as Action);

  session.dispatch({
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: constraintsSec.id,
    item: { text: UNCHECKED_ITEM_AC8, modality: "optional", evals: {} },
  } as unknown as Action);

  // Cover the remaining non-goal sections with one human-added (checked) item each.
  const COVER_KINDS = ["elements", "gap", "acceptance"] as const;
  for (const kind of COVER_KINDS) {
    const sec = (
      session.model.sections as Array<{ id: string; kind: string }>
    ).find((s) => s.kind === kind);
    assert.ok(sec, `${kind} section must exist in a fresh space`);
    session.dispatch({
      type: "addItem",
      actor: "human",
      sectionId: sec.id,
      text: `COVERITEM${kind.toUpperCase()}`,
      modality: "mandatory",
    } as unknown as Action);
  }

  // ── Part B: After covering all sections + clean dry-run → freeze enables ──
  //
  // WHY (INVARIANT): The checkReadiness{} message must await deps.runSlicer and
  // dispatch recordReadiness with the result. Once coverage is green (all sections
  // have a checked active item or non-empty intent text) AND the dry-run is clean,
  // data-reason must be "" (empty) and the button must not carry 'disabled'. This
  // is the transition from disabled to enabled — only the combination of both
  // signals being green opens the Freeze control.
  await session.postFromWebview({ type: "checkReadiness" });

  assert.equal(
    slicerCalls,
    1,
    "deps.runSlicer must be called exactly once by the checkReadiness{} message — " +
      "readiness is only recorded via this path",
  );

  {
    const html = session.renderedHtml();

    const reason = freezeReason(html);
    assert.equal(
      reason,
      "",
      `data-reason must be empty (freeze enabled) after all sections are covered and dry-run is clean — ` +
        `got '${reason}'`,
    );
    assert.ok(
      !freezeIsDisabled(html),
      "freeze button must NOT carry 'disabled' when coverage is green and dry-run is clean — " +
        "both gate signals passing must open the control",
    );
  }

  // ── Part C: Freeze pipeline — signing seam receives the correct body ──────
  //
  // WHY (INVARIANT): Triggering freeze{} must:
  //   1. Call signing.stamp() exactly once with a body projected from ONLY
  //      checked+active items. Unchecked items (including UNCHECKED_ITEM_AC8) must
  //      never appear in that body. Checked items (CHECKED_ITEM_AC8) must appear.
  //   2. Call signing.writeTep() exactly once with the STAMPED body — i.e., the
  //      body that signing.stamp() returned (which contains STAMP_SENTINEL_AC8).
  //      This proves stamp → writeTep ordering and that the provenance stamp line
  //      travels into the artifact.
  //   3. Call writeTep with status "proposed" (the frozen artifact status from the
  //      SPEC CONTRACT).
  await session.postFromWebview({ type: "freeze" });

  assert.equal(
    stampCalls,
    1,
    "signing.stamp() must be called exactly once by the freeze pipeline",
  );
  assert.equal(
    writeTepCalls,
    1,
    "signing.writeTep() must be called exactly once by the freeze pipeline",
  );

  // The body passed to stamp() must include the checked item text.
  assert.ok(
    lastStampBodyArg.includes(CHECKED_ITEM_AC8),
    `signing.stamp() body must contain '${CHECKED_ITEM_AC8}' — ` +
      "checked+active items must be projected into the freeze body",
  );

  // The body passed to stamp() must NOT include the unchecked item text.
  assert.ok(
    !lastStampBodyArg.includes(UNCHECKED_ITEM_AC8),
    `signing.stamp() body must NOT contain '${UNCHECKED_ITEM_AC8}' — ` +
      "unchecked items must never appear in the projected freeze body",
  );

  // The body passed to writeTep() must carry the stamp sentinel — proving
  // the pipeline calls stamp() BEFORE writeTep(), not after.
  assert.ok(
    lastWriteTepBodyArg.includes(STAMP_SENTINEL_AC8),
    `signing.writeTep() body must contain the provenance stamp sentinel '${STAMP_SENTINEL_AC8}' ` +
      "appended by signing.stamp() — stamp must run before writeTep in the pipeline",
  );

  // Status must be "proposed" per the SPEC CONTRACT for frozen artifacts.
  assert.equal(
    lastWriteTepStatus,
    "proposed",
    "signing.writeTep() must be called with status 'proposed' — " +
      "the frozen artifact status from the SPEC CONTRACT",
  );
}
