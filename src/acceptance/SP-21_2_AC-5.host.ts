/**
 * SP-21/2 AC-5 — Workers act from the surface.
 *
 * WHY (INVARIANT): Asking for structure invokes the gap-filling worker through the
 * app-owned loop using the model id from the thinkube.orchestrator.workerModel setting,
 * and every action the worker yields lands in the held model through dispatch — proposed
 * sections appear as 'proposed' in both the model and the rendered HTML. This must hold
 * forever; any wiring that bypasses the configured model id or skips dispatch breaks this test.
 */

import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as vscode from "vscode";
import type { TandemExtensionApi } from "../extension";
import type { QueryFn, WorkerMessage } from "../scratchpad/workers/worker";

// Probe-unique model id — recognisable and not a real Claude model name.
const PROBE_MODEL_ID = "PROBEWORKERMODELID";

// Proposed section marker strings: all-caps, no special characters.
const SECTION_ONE_TEXT = "CONSTRAINTSPROPOSEDTEXT";
const SECTION_TWO_TEXT = "ELEMENTSPROPOSEDTEXT";

export async function run(_phase: number): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension must be present");
  const api = (await ext.activate()) as TandemExtensionApi;

  // ── Configure the worker model setting BEFORE opening the session ─────────
  // The probe sets a recognisable model id so we can assert openScratchpad
  // reads it and passes it through to the worker.
  const config = vscode.workspace.getConfiguration("thinkube.orchestrator");
  const previousModel = config.get<string>("workerModel");
  await config.update(
    "workerModel",
    PROBE_MODEL_ID,
    vscode.ConfigurationTarget.Global,
  );

  try {
    // ── Inject a fake QueryFn that records the model id and yields proposals ─
    let observedModel: string | undefined;
    const fakeLoadQuery = (): QueryFn => {
      return async function* (args: {
        prompt: string;
        options: {
          model: string;
          allowedTools: string[];
          disallowedTools: string[];
        };
      }) {
        // Record the model the session wired into the worker.
        observedModel = args.options.model;
        const msg: WorkerMessage = {
          type: "actions",
          actions: [
            {
              type: "proposeSection",
              kind: "constraints",
              text: SECTION_ONE_TEXT,
              workerId: "fake-gap-filler",
            },
            {
              type: "proposeSection",
              kind: "elements",
              text: SECTION_TWO_TEXT,
              workerId: "fake-gap-filler",
            },
          ],
        };
        yield msg;
      };
    };

    const tmpDir = path.join(os.tmpdir(), "tandem-probe-sp21-2-ac5");
    fs.mkdirSync(tmpDir, { recursive: true });

    // Open without passing workerModel in deps — the session must read it from
    // the thinkube.orchestrator.workerModel setting we configured above.
    const session = await api.scratchpad.openScratchpad({
      sidecarRoot: tmpDir,
      loadQuery: fakeLoadQuery,
    });
    assert.ok(session, "openScratchpad must return a live session");

    // Seed a goal so the gap-filler has something to work from.
    session.dispatch({ type: "seedGoal", text: "GOALTEXT" });

    // ── Invoke the worker from the surface ───────────────────────────────────
    await session.askForStructure();

    // ── The fake must have observed the configured model id ──────────────────
    // INVARIANT: the session reads workerModel from the setting when not given in deps.
    assert.equal(
      observedModel,
      PROBE_MODEL_ID,
      `the fake QueryFn must have observed model '${PROBE_MODEL_ID}' — ` +
        "openScratchpad must pass the thinkube.orchestrator.workerModel setting to the worker",
    );

    // ── Both proposed sections must be in the model with state 'proposed' ────
    // INVARIANT: worker actions land through dispatch, not through a side channel.
    const proposedSections = session.model.sections.filter(
      (s) => s.state === "proposed",
    );
    assert.equal(
      proposedSections.length,
      2,
      "both worker-proposed sections must be in the model with state 'proposed' after askForStructure()",
    );

    const sectionTexts = proposedSections.map((s) => s.text);
    assert.ok(
      sectionTexts.includes(SECTION_ONE_TEXT),
      `model must contain a proposed section with text '${SECTION_ONE_TEXT}'`,
    );
    assert.ok(
      sectionTexts.includes(SECTION_TWO_TEXT),
      `model must contain a proposed section with text '${SECTION_TWO_TEXT}'`,
    );

    // ── Both proposed sections must appear in renderedHtml() ─────────────────
    // INVARIANT: the panel re-renders from the live model after every dispatch.
    const html = session.renderedHtml();
    assert.ok(
      html.includes(SECTION_ONE_TEXT),
      `renderedHtml() must contain '${SECTION_ONE_TEXT}' — the proposed section must be visible in the panel`,
    );
    assert.ok(
      html.includes(SECTION_TWO_TEXT),
      `renderedHtml() must contain '${SECTION_TWO_TEXT}' — the proposed section must be visible in the panel`,
    );
  } finally {
    // Restore the setting so the probe leaves the environment clean.
    await vscode.workspace
      .getConfiguration("thinkube.orchestrator")
      .update("workerModel", previousModel, vscode.ConfigurationTarget.Global);
  }
}
