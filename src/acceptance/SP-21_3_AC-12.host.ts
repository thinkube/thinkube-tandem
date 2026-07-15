/**
 * SP-21/3 AC-12 — The command field drives the form.
 *
 * Three scenarios, each an INVARIANT that must hold forever:
 *
 * Scenario A (INVARIANT): 'accept all constraints' produces the same model change
 * as direct human gestures — every unchecked active constraint item becomes
 * checked with human attribution, just as if the author had pressed each
 * checkbox individually. This must hold forever: any implementation that ignores
 * the bulk expansion, checks the wrong items, or attributes the settling to a
 * non-human actor breaks the contract that the command field equals direct
 * manipulation.
 *
 * Scenario B (INVARIANT): When the scripted interpreter round returns a freeze
 * action, GATES.interpreter catches it (freeze is absent from its vocabulary),
 * no model state changes, and an explanation is rendered as
 * <div class="command-error"> under the field. This must hold forever: any path
 * that lets freeze slip through the interpreter gate would close the human's
 * intent on their behalf.
 *
 * Scenario C (INVARIANT): An unrecognized utterance (the model round returns
 * zero actions) changes nothing in the model and renders an explanation as
 * <div class="command-error"> under the field. The author must always receive
 * feedback — a silent nothing is not an acceptable response. This must hold
 * forever.
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
import type { QueryFn, WorkerMessage } from "../scratchpad/workers/worker";

// ── SP-3 local type helpers ────────────────────────────────────────────────────
// These will be exported from their implementation modules once the implementer
// ships. Defined locally here so the test compiles and names failure modes
// precisely before the implementation exists.

interface SP3Item {
  id: string;
  text: string;
  checked: boolean;
  modality: string;
  evals: { complexity?: number; risk?: number };
  origin: string;
  state: string;
}

interface SP3Section {
  id: string;
  kind: string;
  items: SP3Item[];
}

interface SP3Model {
  sections: SP3Section[];
}

// SP-3 extended session deps — adds space/namespace/loadQuery/workerModel that
// the SPEC CONTRACT adds to ScratchpadSessionDeps.
interface SP3Deps extends ScratchpadSessionDeps {
  space?: string;
  namespace?: string;
  loadQuery?: () => QueryFn;
  workerModel?: string;
}

// SP-3 inbound message vocabulary — only the messages exercised by this AC.
type SP3InboundMessage = { type: "command"; utterance: string };

type SP3Session = ScratchpadSession & {
  postFromWebview(
    msg: SP3InboundMessage | Record<string, unknown>,
  ): Promise<void>;
};

// ── Marker strings — all-caps alphanumeric, safe through HTML escaping ─────────
const UNCHECKED_CONSTRAINT_1 = "UNCHECKEDCONSTRAINTONE";
const UNCHECKED_CONSTRAINT_2 = "UNCHECKEDCONSTRAINTTWO";
const FREEZE_ITEM_TEXT = "FREEZESCENARIOITEM";
const FREEZE_CMD_UTTERANCE = "FREEZECOMMANDUTTERANCE";
const UNRECOGNIZED_ITEM_TEXT = "UNRECOGNIZEDSCENARIOITEM";
const UNRECOGNIZED_UTTERANCE = "XYZZYPLUGHFROBOZZUNKNOWN";

export async function run(_phase: number): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension must be present in the host");
  const api = (await ext.activate()) as TandemExtensionApi;

  // ═══════════════════════════════════════════════════════════════════════════
  // Scenario A: 'accept all constraints' — same model change as direct gesture,
  // attributed to the human.
  // ═══════════════════════════════════════════════════════════════════════════
  {
    // WHY (INVARIANT): Typing 'accept all constraints' must produce the same
    // model state as directly checking each unchecked active constraint item
    // one by one. The items become checked:true, and since the reducer only
    // accepts checkItem when actor:'human', the checked state is proof that
    // the dispatch was human-attributed. Any implementation that skips the
    // bulk expansion or uses a non-human actor leaves the items unchecked
    // and this test fails correctly.

    const tmpDir = path.join(os.tmpdir(), "tandem-probe-sp21-3-ac12-a");
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    // The fake captures the to-be-checked IDs by closure; it is populated AFTER
    // the session is open and the items are added.  If the interpreter makes a
    // model round, the fake returns the right checkItem actions.  If the
    // interpreter expands 'accept all constraints' deterministically (without a
    // model round), the fake is never called — either way the test checks the
    // end state.
    const itemIdsForBulk: string[] = [];
    const fakeLoadQueryA = (): QueryFn => {
      return async function* (_args: {
        prompt: string;
        options: {
          model: string;
          allowedTools: string[];
          disallowedTools: string[];
          mcpTools?: string[];
          corpusPaths?: string[];
        };
      }) {
        yield {
          type: "actions",
          actions: itemIdsForBulk.map((id) => ({
            type: "checkItem",
            actor: "human",
            itemId: id,
          })),
        } as unknown as WorkerMessage;
      };
    };

    const depsA: SP3Deps = {
      sidecarRoot: tmpDir,
      namespace: "ns-ac12-a",
      space: "space-ac12-a",
      workerModel: "PROBEMODEL",
      loadQuery: fakeLoadQueryA,
    };

    const rawA = await api.scratchpad.openScratchpad(
      depsA as unknown as ScratchpadSessionDeps,
    );
    assert.ok(rawA, "openScratchpad must return a session for scenario A");
    const sessionA = rawA as unknown as SP3Session;

    // Add 2 unchecked constraint items via proposeItem (non-human actor →
    // arrives checked:false, state:'active' per the SPEC CONTRACT).
    const modelA0 = sessionA.model as unknown as SP3Model;
    const conSecA = modelA0.sections.find((s) => s.kind === "constraints");
    assert.ok(
      conSecA,
      "constraints section must exist in a fresh thinking space — " +
        "a fresh space seeds EXACTLY one empty-items section per kind",
    );

    sessionA.dispatch({
      type: "proposeItem",
      actor: "gap-filler",
      sectionId: conSecA.id,
      item: { text: UNCHECKED_CONSTRAINT_1, modality: "mandatory", evals: {} },
    } as unknown as Action);

    sessionA.dispatch({
      type: "proposeItem",
      actor: "gap-filler",
      sectionId: conSecA.id,
      item: { text: UNCHECKED_CONSTRAINT_2, modality: "optional", evals: {} },
    } as unknown as Action);

    // Verify both items are unchecked before the command, and capture their IDs
    // for the closure-based fake.
    const constraintsBeforeA = (
      sessionA.model as unknown as SP3Model
    ).sections.find((s) => s.kind === "constraints")!;

    assert.equal(
      constraintsBeforeA.items.length,
      2,
      "2 proposed (unchecked) items must exist in constraints before the command",
    );

    for (const item of constraintsBeforeA.items) {
      assert.equal(
        item.checked,
        false,
        `item '${item.text}' must be unchecked before the command — ` +
          "proposeItem from a non-human actor must arrive checked:false",
      );
      assert.equal(
        item.state,
        "active",
        `item '${item.text}' must be state:'active' — ` +
          "'accept all constraints' applies to unchecked ACTIVE items",
      );
      itemIdsForBulk.push(item.id);
    }

    // Post the bulk command via the command field.
    await sessionA.postFromWebview({
      type: "command",
      utterance: "accept all constraints",
    });

    // INVARIANT: every unchecked active constraint item must now be checked.
    const constraintsAfterA = (
      sessionA.model as unknown as SP3Model
    ).sections.find((s) => s.kind === "constraints")!;

    assert.equal(
      constraintsAfterA.items.length,
      2,
      "item count must not change after 'accept all constraints' — " +
        "the command checks existing items, it does not add or remove them",
    );

    for (const item of constraintsAfterA.items) {
      assert.equal(
        item.checked,
        true,
        `item '${item.text}' must be checked:true after 'accept all constraints' — ` +
          "the command is equivalent to direct human gesture (one checkItem per " +
          "unchecked active item); checked:true proves human attribution because the " +
          "reducer rejects checkItem from any non-human actor",
      );
    }

    // INVARIANT: the command-input field must be present in the panel HTML.
    // The spec contract names 'input#command-input' as the command field element;
    // this cardinality check ensures it exists and the webview can wire it.
    const htmlA = sessionA.renderedHtml();
    assert.ok(
      /<input\b[^>]*\bid\s*=\s*["']command-input["']/i.test(htmlA),
      "renderedHtml() must contain <input id='command-input'> — " +
        "the command field must always be rendered in the thinking-space panel",
    );

    // A successful command must NOT render a command-error under the field.
    assert.ok(
      !htmlA.includes("command-error"),
      "renderedHtml() must NOT contain 'command-error' after a successful command — " +
        "'accept all constraints' produced valid checkItem actions and must not " +
        "show an error explanation",
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Scenario B: Scripted interpreter reply containing freeze action →
  // no model change + explanation under the field.
  // ═══════════════════════════════════════════════════════════════════════════
  {
    // WHY (INVARIANT): GATES.interpreter excludes 'freeze' from its vocabulary.
    // When the model round returns a freeze action, interpret() must catch it
    // via assertWithinGate and return { actions: [], message } — it must never
    // dispatch the freeze or throw to the session.  No model state changes.
    // The message is rendered as <div class="command-error"> under the field so
    // the author is told the command was rejected, not silently ignored.
    // This must hold forever: any path that lets freeze slip through the
    // interpreter gate would close the human's intent on their behalf, violating
    // the fundamental guarantee that freeze is a human-only signed act.

    const tmpDir = path.join(os.tmpdir(), "tandem-probe-sp21-3-ac12-b");
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    // Fake that yields a freeze action — caught by GATES.interpreter.
    const fakeLoadQueryB = (): QueryFn => {
      return async function* (_args: {
        prompt: string;
        options: {
          model: string;
          allowedTools: string[];
          disallowedTools: string[];
          mcpTools?: string[];
          corpusPaths?: string[];
        };
      }) {
        yield {
          type: "actions",
          actions: [{ type: "freeze" }],
        } as unknown as WorkerMessage;
      };
    };

    const depsB: SP3Deps = {
      sidecarRoot: tmpDir,
      namespace: "ns-ac12-b",
      space: "space-ac12-b",
      workerModel: "PROBEMODEL",
      loadQuery: fakeLoadQueryB,
    };

    const rawB = await api.scratchpad.openScratchpad(
      depsB as unknown as ScratchpadSessionDeps,
    );
    assert.ok(rawB, "openScratchpad must return a session for scenario B");
    const sessionB = rawB as unknown as SP3Session;

    // Seed the model with one unchecked item so there is visible state to assert
    // unchanged after the rejected command.
    const conSecB = (sessionB.model as unknown as SP3Model).sections.find(
      (s) => s.kind === "constraints",
    );
    assert.ok(conSecB, "constraints section must exist for scenario B");

    sessionB.dispatch({
      type: "proposeItem",
      actor: "gap-filler",
      sectionId: conSecB.id,
      item: { text: FREEZE_ITEM_TEXT, modality: "mandatory", evals: {} },
    } as unknown as Action);

    const itemBeforeB = (sessionB.model as unknown as SP3Model).sections.find(
      (s) => s.kind === "constraints",
    )!.items[0];
    assert.ok(
      itemBeforeB,
      "the seeded item must exist in constraints before the command",
    );
    assert.equal(
      itemBeforeB.checked,
      false,
      "precondition: item must be unchecked before the freeze-reply command",
    );

    // Post a command whose scripted interpreter reply contains a freeze action.
    await sessionB.postFromWebview({
      type: "command",
      utterance: FREEZE_CMD_UTTERANCE,
    });

    // INVARIANT: the model must be unchanged — the freeze action was caught by
    // the gate, so zero actions were dispatched.
    const constraintsAfterB = (
      sessionB.model as unknown as SP3Model
    ).sections.find((s) => s.kind === "constraints")!;

    assert.equal(
      constraintsAfterB.items.length,
      1,
      "item count must not change after a freeze-action interpreter reply — " +
        "zero actions were dispatched (the gate caught freeze before dispatch)",
    );
    assert.equal(
      constraintsAfterB.items[0].id,
      itemBeforeB.id,
      "item id must be unchanged — no new item was created or removed",
    );
    assert.equal(
      constraintsAfterB.items[0].checked,
      false,
      "item must remain unchecked — freeze was not dispatched as a checkItem; " +
        "GATES.interpreter caught it and returned an empty action list",
    );

    // INVARIANT: a command-error element must appear under the command field,
    // rendering a non-empty explanation of why the command was rejected.
    const htmlB = sessionB.renderedHtml();
    assert.ok(
      /class\s*=\s*["'][^"']*\bcommand-error\b[^"']*["']/.test(htmlB),
      "renderedHtml() must contain an element with class='command-error' after a " +
        "freeze-action interpreter reply — GATES.interpreter catches freeze and " +
        "surfaces an explanation under the command field",
    );

    // The explanation must be non-empty — a silent empty div is not acceptable.
    const errorDivMatchB = htmlB.match(
      /<div\b[^>]*\bcommand-error\b[^>]*>([\s\S]*?)<\/div>/,
    );
    assert.ok(
      errorDivMatchB,
      "<div class='command-error'> must exist in rendered HTML for scenario B",
    );
    assert.ok(
      errorDivMatchB[1].trim().length > 0,
      "command-error div must contain a non-empty explanation — " +
        "the author must be told WHY the command was rejected, not shown a blank div",
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Scenario C: Unrecognized utterance → no model change + explanation.
  // ═══════════════════════════════════════════════════════════════════════════
  {
    // WHY (INVARIANT): When the interpreter cannot map an utterance to any known
    // action (the model round returns zero actions), it must return
    // { actions: [], message } with a plain explanation — never silently do
    // nothing.  No model state changes.  The explanation is rendered as
    // <div class="command-error"> under the field so the author always receives
    // feedback.  This must hold forever: any implementation that swallows an
    // unrecognized utterance without rendering an explanation leaves the author
    // wondering whether the command was accepted or ignored.

    const tmpDir = path.join(os.tmpdir(), "tandem-probe-sp21-3-ac12-c");
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    // Fake that yields zero actions — the interpreter sees no recognized action
    // and must generate a fallback explanation message.
    const fakeLoadQueryC = (): QueryFn => {
      return async function* (_args: {
        prompt: string;
        options: {
          model: string;
          allowedTools: string[];
          disallowedTools: string[];
          mcpTools?: string[];
          corpusPaths?: string[];
        };
      }) {
        yield { type: "actions", actions: [] } as WorkerMessage;
      };
    };

    const depsC: SP3Deps = {
      sidecarRoot: tmpDir,
      namespace: "ns-ac12-c",
      space: "space-ac12-c",
      workerModel: "PROBEMODEL",
      loadQuery: fakeLoadQueryC,
    };

    const rawC = await api.scratchpad.openScratchpad(
      depsC as unknown as ScratchpadSessionDeps,
    );
    assert.ok(rawC, "openScratchpad must return a session for scenario C");
    const sessionC = rawC as unknown as SP3Session;

    // Seed the model with one unchecked item so there is visible state to assert
    // unchanged after the unrecognized command.
    const conSecC = (sessionC.model as unknown as SP3Model).sections.find(
      (s) => s.kind === "constraints",
    );
    assert.ok(conSecC, "constraints section must exist for scenario C");

    sessionC.dispatch({
      type: "proposeItem",
      actor: "gap-filler",
      sectionId: conSecC.id,
      item: { text: UNRECOGNIZED_ITEM_TEXT, modality: "mandatory", evals: {} },
    } as unknown as Action);

    const constraintsBeforeC = (
      sessionC.model as unknown as SP3Model
    ).sections.find((s) => s.kind === "constraints")!;
    const itemCountBeforeC = constraintsBeforeC.items.length;
    const itemCheckedBeforeC = constraintsBeforeC.items[0].checked;
    const itemIdBeforeC = constraintsBeforeC.items[0].id;

    // Post an utterance whose scripted round returns zero actions.
    await sessionC.postFromWebview({
      type: "command",
      utterance: UNRECOGNIZED_UTTERANCE,
    });

    // INVARIANT: the model must be unchanged — unrecognized utterances dispatch
    // zero actions.
    const constraintsAfterC = (
      sessionC.model as unknown as SP3Model
    ).sections.find((s) => s.kind === "constraints")!;

    assert.equal(
      constraintsAfterC.items.length,
      itemCountBeforeC,
      "item count must not change after an unrecognized utterance — " +
        "zero actions were dispatched",
    );
    assert.equal(
      constraintsAfterC.items[0].id,
      itemIdBeforeC,
      "item identity must not change — no item was added or removed",
    );
    assert.equal(
      constraintsAfterC.items[0].checked,
      itemCheckedBeforeC,
      "item checked state must not change after an unrecognized utterance — " +
        "no checkItem or uncheckItem was dispatched",
    );

    // INVARIANT: a command-error element must appear under the command field,
    // explaining why no action was taken.
    const htmlC = sessionC.renderedHtml();
    assert.ok(
      /class\s*=\s*["'][^"']*\bcommand-error\b[^"']*["']/.test(htmlC),
      "renderedHtml() must contain an element with class='command-error' for an " +
        "unrecognized utterance — the author must always receive an explanation, " +
        "never a silent nothing",
    );

    // The explanation must be non-empty.
    const errorDivMatchC = htmlC.match(
      /<div\b[^>]*\bcommand-error\b[^>]*>([\s\S]*?)<\/div>/,
    );
    assert.ok(
      errorDivMatchC,
      "<div class='command-error'> must exist in rendered HTML for scenario C",
    );
    assert.ok(
      errorDivMatchC[1].trim().length > 0,
      "command-error div must contain a non-empty explanation for an unrecognized " +
        "utterance — the author must be told the command was not understood, not " +
        "shown a blank div or nothing at all",
    );
  }
}
