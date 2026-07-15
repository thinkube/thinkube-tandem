// TANDEM_PHASES=2
/**
 * SP-21/3 AC-7 — Research persists at the space level and is reused.
 *
 * WHY (INVARIANT): A research run writes a dossier file (research/{topic}.md)
 * under the thinking space's namespace. Evidence chips reference it. Disposing
 * the session (extension host restart), reopening the SAME named space fresh, and
 * re-triggering the SAME topic delivers the dossier's markdown VERBATIM inside
 * the observed prompt of the new research round — so the research worker is always
 * dossier-first: consult what is already known before running live research again.
 * This must hold forever and across any session boundary.
 *
 * Two fresh extension hosts, same fixed sidecarRoot and namespace:
 *   Phase 0 — open the named space, trigger a research round, verify the dossier
 *              file is written to disk, save its content as a reference.
 *   Phase 1 — reopen the same named space, trigger research on the same topic,
 *              observe the dossier content appearing VERBATIM in the round's prompt.
 */

import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as vscode from "vscode";
import type { TandemExtensionApi } from "../extension";
import type { ScratchpadSession } from "../scratchpad/session";
import type { QueryFn, QueryOptions } from "../scratchpad/workers/worker";
import type { DossierStore } from "../scratchpad/workers/research";

// ── SP-3 types (local until implementation ships) ─────────────────────────────

type SP3ResearchMessage =
  { type: "research"; itemId: string } | { type: "research"; subject: string };

type SP3AddItemMessage = {
  type: "addItem";
  sectionId: string;
  text: string;
  modality?: "mandatory" | "optional";
};

type SP3InboundMessage =
  SP3ResearchMessage | SP3AddItemMessage | { type: "seedGoal"; text: string };

type WithPostFromWebview = ScratchpadSession & {
  postFromWebview(message: SP3InboundMessage): Promise<void>;
};

interface SP3Item {
  id: string;
  text: string;
  checked: boolean;
  origin: string;
  evidence: Array<{
    source: string;
    method: string;
    checkedAt: string;
    dossierRef?: string;
  }>;
}

interface SP3Section {
  id: string;
  kind: string;
  items: SP3Item[];
}

// ── Topic slugifier (mirrors the contract's derivation) ───────────────────────
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

// ── File-backed DossierStore ──────────────────────────────────────────────────
// Reads from and writes to <dir>/<topic>.md — matches the default store's layout
// under <sidecarRoot>/<namespace>/research/.  Exposes `lastWrite` so the probe
// can save the written content to a reference file for Phase 1 to load.
function makeFileDossier(dir: string): DossierStore & {
  lastWrite: { topic: string; markdown: string } | undefined;
} {
  let lastWrite: { topic: string; markdown: string } | undefined;
  return {
    get lastWrite() {
      return lastWrite;
    },
    async read(topic: string): Promise<string | undefined> {
      const filePath = path.join(dir, `${topic}.md`);
      try {
        return fs.readFileSync(filePath, "utf8");
      } catch {
        return undefined;
      }
    },
    async write(
      topic: string,
      markdown: string,
    ): Promise<{ dossierRef: string }> {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${topic}.md`), markdown, "utf8");
      lastWrite = { topic, markdown };
      return { dossierRef: `research/${topic}.md` };
    },
  };
}

// ── Fixed paths — no Date.now() / Math.random() (breaks resume) ──────────────
const SIDECAR_ROOT = path.join(os.tmpdir(), "tandem-probe-sp21-3-ac7");
const NAMESPACE = "ac7-ns";
const SPACE = "ac7-space";
const RESEARCH_DIR = path.join(SIDECAR_ROOT, NAMESPACE, "research");
// Reference file: phase 0 writes the observed dossier content here so phase 1
// can assert on a known string without knowing what the implementation writes.
const DOSSIER_REF_FILE = path.join(SIDECAR_ROOT, "dossier-ref.json");
const FIXED_NOW = new Date("2026-02-10T08:00:00.000Z");

// Item text used in both phases: must be the same so the topic is the same.
const RESEARCH_ITEM_TEXT = "DOSSIERRESEARCHITEMTEXT";

export async function run(phase: number): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension must be present");
  const api = (await ext.activate()) as TandemExtensionApi;

  if (phase === 0) {
    // ── Phase 0: first research run — verify dossier file is written ───────────
    fs.rmSync(SIDECAR_ROOT, { recursive: true, force: true });
    fs.mkdirSync(SIDECAR_ROOT, { recursive: true });
    fs.mkdirSync(RESEARCH_DIR, { recursive: true });

    // File-backed dossier rooted at RESEARCH_DIR.
    const dossier = makeFileDossier(RESEARCH_DIR);

    // Mutable loadQuery state — sectionId filled after session opens.
    const queryState = {
      sectionIdForProposal: "",
    };

    const rawSession = await api.scratchpad.openScratchpad({
      sidecarRoot: SIDECAR_ROOT,
      namespace: NAMESPACE,
      space: SPACE,
      dossier,
      now: () => FIXED_NOW,
      loadQuery: (): QueryFn =>
        async function* (_args) {
          // Yield a simple note so the research factory has a non-empty round
          // to incorporate into the dossier write.
          yield {
            type: "actions",
            actions: [
              {
                type: "addItemNote",
                actor: "research",
                // itemId will reference the item added below; the factory may
                // attach notes to the first proposed item or a target item.
                // Yielding a note ensures the factory has content to write.
                itemId: "PLACEHOLDER",
                text: "RESEARCHROUNDFINDINGTEXT",
              },
            ],
          } as any;
        },
    } as any);

    assert.ok(
      rawSession,
      "openScratchpad must return a live session in phase 0",
    );
    const session = rawSession as unknown as WithPostFromWebview;

    // Seed intent and add the item we will research in both phases.
    await session.postFromWebview({ type: "seedGoal", text: "PHASE0GOALTEXT" });

    const model0 = rawSession.model as unknown as { sections: SP3Section[] };
    const constraintsSection = model0.sections.find(
      (s) => s.kind === "constraints",
    );
    assert.ok(
      constraintsSection,
      "fresh space must have a constraints section in phase 0",
    );

    await session.postFromWebview({
      type: "addItem",
      sectionId: constraintsSection.id,
      text: RESEARCH_ITEM_TEXT,
    });

    const targetItem = (
      rawSession.model as unknown as { sections: SP3Section[] }
    ).sections
      .find((s) => s.kind === "constraints")
      ?.items.find((i) => i.text === RESEARCH_ITEM_TEXT);
    assert.ok(
      targetItem,
      "the research item must exist before triggering research",
    );

    // ── Trigger research on the item ────────────────────────────────────────
    await session.postFromWebview({ type: "research", itemId: targetItem.id });

    // INVARIANT (phase 0): a research run writes research/{topic}.md under the space.
    const expectedTopic = slugify(RESEARCH_ITEM_TEXT);
    const expectedFile = path.join(RESEARCH_DIR, `${expectedTopic}.md`);

    assert.ok(
      fs.existsSync(expectedFile),
      `research/{topic}.md must exist at '${expectedFile}' after a research run — ` +
        "the research worker must persist its findings to the dossier store, " +
        "not only return them in-memory",
    );

    // INVARIANT (phase 0): evidence chips on the rendered panel reference the dossier.
    const html0 = rawSession.renderedHtml();
    assert.ok(
      html0.includes(`data-dossier-ref="research/${expectedTopic}.md"`),
      `renderedHtml() must carry an evidence chip with data-dossier-ref="research/${expectedTopic}.md" — ` +
        "the chip's dossierRef must point at the file the same research round wrote",
    );

    // Read the dossier content from disk so phase 1 can assert on it verbatim.
    const dossierContent = fs.readFileSync(expectedFile, "utf8");
    assert.ok(
      dossierContent.length > 0,
      "the dossier file must contain non-empty content — " +
        "a research round that writes an empty file provides no reuse value",
    );

    // Persist the reference JSON: { topic, content } for phase 1.
    fs.writeFileSync(
      DOSSIER_REF_FILE,
      JSON.stringify({ topic: expectedTopic, content: dossierContent }),
      "utf8",
    );

    // Force debounced persistence before the host exits.
    await rawSession.flush();

    assert.ok(
      fs.existsSync(DOSSIER_REF_FILE),
      "dossier-ref.json must exist at end of phase 0 — phase 1 depends on it",
    );
  } else {
    // ── Phase 1: reopen the same space — dossier content arrives in the prompt ──

    assert.ok(
      fs.existsSync(DOSSIER_REF_FILE),
      `dossier-ref.json must exist at '${DOSSIER_REF_FILE}' — was phase 0 skipped?`,
    );

    const ref = JSON.parse(fs.readFileSync(DOSSIER_REF_FILE, "utf8")) as {
      topic: string;
      content: string;
    };

    assert.ok(
      ref.content && ref.content.length > 0,
      "the saved dossier content must be non-empty for phase 1 to assert on it",
    );

    // File-backed dossier on the SAME research dir — read returns the phase-0 content.
    const dossier1 = makeFileDossier(RESEARCH_DIR);

    // Capturing loadQuery: records the prompt to assert on dossier inclusion.
    let observedPrompt: string | undefined;
    let observedOptions: QueryOptions | undefined;
    const queryState1 = { sectionIdForProposal: "" };

    const rawSession1 = await api.scratchpad.openScratchpad({
      sidecarRoot: SIDECAR_ROOT,
      namespace: NAMESPACE,
      space: SPACE,
      dossier: dossier1,
      now: () => FIXED_NOW,
      loadQuery: (): QueryFn =>
        async function* (args: { prompt: string; options: QueryOptions }) {
          observedPrompt = args.prompt;
          observedOptions = args.options;
          // Yield nothing — we only care about what arrived in the prompt.
          return;
        },
    } as any);

    assert.ok(
      rawSession1,
      "openScratchpad must return a live session in phase 1",
    );
    const session1 = rawSession1 as unknown as WithPostFromWebview;

    // The space was persisted in phase 0 and must be resumed from disk.
    const model1 = rawSession1.model as unknown as { sections: SP3Section[] };
    const constraintsSection1 = model1.sections.find(
      (s) => s.kind === "constraints",
    );
    assert.ok(
      constraintsSection1,
      "the constraints section must be present in the resumed phase-1 model",
    );

    // The item added in phase 0 must survive in the resumed model.
    const resumedItem = constraintsSection1.items.find(
      (i) => i.text === RESEARCH_ITEM_TEXT,
    );
    assert.ok(
      resumedItem,
      `the item '${RESEARCH_ITEM_TEXT}' must be present in the resumed space — ` +
        "the thinking space document persisted in phase 0 must be loaded on reopen",
    );

    // ── Trigger research on the SAME topic ─────────────────────────────────────
    await session1.postFromWebview({
      type: "research",
      itemId: resumedItem.id,
    });

    // INVARIANT: the dossier-first read was called before the research round.
    assert.ok(
      observedPrompt !== undefined,
      "loadQuery must have been called for the phase-1 research round — " +
        "a fresh session re-triggering the same topic must still run a round " +
        "(the dossier grounds it, but does not skip it)",
    );

    // INVARIANT: the dossier's markdown from phase 0 appears VERBATIM in the prompt.
    // This is the core proof that the research worker consults the dossier before
    // running — the prior findings travel into every subsequent round on the same topic.
    assert.ok(
      observedPrompt!.includes(ref.content),
      "DOSSIER-FIRST INVARIANT: the phase-1 research round's prompt must contain the " +
        "dossier content from phase 0 VERBATIM — the research worker must read the " +
        "dossier before running a new live round, so prior findings always ground the next; " +
        `expected the prompt to include:\n  '${ref.content.slice(0, 120)}…'`,
    );

    // Sanity: the observed options still carry the contract's tool list.
    // (No new assertion — just guards that the round truly went through the
    //  research worker and not a different code path.)
    assert.ok(
      observedOptions,
      "QueryOptions must be observed in the phase-1 round — " +
        "the research worker's options must be wired the same way in a resumed session",
    );
    assert.deepStrictEqual(
      (observedOptions as any).mcpTools,
      ["tk-package-version", "web-fetch", "repo-explorer"],
      "the phase-1 research round's mcpTools must still be the contract's exact list — " +
        "a resumed session must not lose the research worker's tool wiring",
    );
  }
}
