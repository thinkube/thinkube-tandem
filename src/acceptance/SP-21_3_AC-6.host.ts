/**
 * SP-21/3 AC-6 — Research mechanics.
 *
 * WHY (INVARIANT): Triggering research on an item or on a free subject routes to
 * the research worker with the right target; all findings land only as unchecked
 * proposals; attached evidence chips carry method, date (from deps.now()), and a
 * dossier reference; the research gate rejects any checkItem action the worker
 * attempts; the round's QueryOptions carry the contract's exact mcpTools list and
 * corpus paths. Each property is a standing invariant of the research worker.
 */

import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as vscode from "vscode";
import type { TandemExtensionApi } from "../extension";
import type { ScratchpadSession } from "../scratchpad/session";
import type { QueryFn, QueryOptions } from "../scratchpad/workers/worker";
// DossierStore is new in SP-3; exported from the research worker module per the
// file plan.  The type resolves once the implementer builds to the contract.
import type { DossierStore } from "../scratchpad/workers/research";

// ── SP-3 extended message vocabulary (defined locally; resolves at implementation time) ──
// postFromWebview accepts all SP-1/SP-2 messages PLUS the new SP-3 ones.
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

// ── SP-3 Item shape (defined locally; resolves at implementation time) ────────
interface SP3Item {
  id: string;
  text: string;
  checked: boolean;
  modality: "mandatory" | "optional";
  evals: { complexity?: 1 | 2 | 3; risk?: 1 | 2 | 3 };
  origin: "human" | "gap-filler" | "integrator" | "research";
  state: "active" | "shipped" | "deferred" | "dropped";
  evidence: Array<{
    source: string;
    method: string;
    checkedAt: string;
    dossierRef?: string;
  }>;
  notes: Array<{ id: string; text: string }>;
}

interface SP3Section {
  id: string;
  kind: string;
  items: SP3Item[];
}

// ── SP-3 WorkerMessage shape includes new action types ────────────────────────
// The existing WorkerMessage type will gain these; we cast via `any` so the test
// compiles before the implementation ships.
type SP3WorkerMessage = {
  type: "actions";
  actions: Array<
    | {
        type: "proposeItem";
        actor: string;
        sectionId: string;
        item: { text: string; modality: string; evals: object };
      }
    | { type: "checkItem"; actor: string; itemId: string }
    | { type: "addItemNote"; actor: string; itemId: string; text: string }
  >;
};

// ── SP-3 Delta shape (kind:"applied" | "rejected") ────────────────────────────
interface SP3RejectedDelta {
  kind: "rejected";
  action: { type: string; [k: string]: unknown };
  reason: string;
}

// ── Fixed test clock ──────────────────────────────────────────────────────────
const FIXED_NOW = new Date("2026-01-15T10:00:00.000Z");
const FIXED_ISO = FIXED_NOW.toISOString();

// ── Topic slugifier (mirrors the contract's derivation) ───────────────────────
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

// ── In-memory fake DossierStore ───────────────────────────────────────────────
// read → undefined (no prior dossier); write → captures calls, returns dossierRef.
function makeFakeDossier(): DossierStore & {
  reads: string[];
  writes: Array<{ topic: string; markdown: string }>;
} {
  const reads: string[] = [];
  const writes: Array<{ topic: string; markdown: string }> = [];
  return {
    reads,
    writes,
    async read(topic: string): Promise<string | undefined> {
      reads.push(topic);
      return undefined;
    },
    async write(
      topic: string,
      markdown: string,
    ): Promise<{ dossierRef: string }> {
      writes.push({ topic, markdown });
      return { dossierRef: `research/${topic}.md` };
    },
  };
}

// ── Fake loadQuery factory ────────────────────────────────────────────────────
// Closes over mutable state filled after the session opens (so sectionId is
// known at call time, not at factory-creation time).
function makeFakeResearchLoadQuery(state: {
  observedOptions: QueryOptions | undefined;
  observedPrompts: string[];
  sectionIdForProposal: string;
}): () => QueryFn {
  return (): QueryFn =>
    async function* (args: { prompt: string; options: QueryOptions }) {
      state.observedOptions = args.options;
      state.observedPrompts.push(args.prompt);
      const msg: SP3WorkerMessage = {
        type: "actions",
        actions: [
          {
            type: "proposeItem",
            actor: "research",
            sectionId: state.sectionIdForProposal,
            item: {
              text: "RESEARCHPROPOSEDITEMTEXT",
              modality: "optional",
              evals: {},
            },
          },
        ],
      };
      yield msg as any;
    };
}

// ── Gate-test loadQuery: yields a disallowed checkItem action ─────────────────
function makeGateTestLoadQuery(itemId: string): () => QueryFn {
  return (): QueryFn =>
    async function* (_args) {
      const msg: SP3WorkerMessage = {
        type: "actions",
        actions: [{ type: "checkItem", actor: "research", itemId }],
      };
      yield msg as any;
    };
}

export async function run(_phase: number): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension must be present");
  const api = (await ext.activate()) as TandemExtensionApi;

  const tmpDir = path.join(os.tmpdir(), "tandem-probe-sp21-3-ac6");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const NAMESPACE = "probe-ns";
  const SPACE = "probe-space";
  const ITEM_TEXT = "RESEARCHITEMTEXTALPHANUMERIC";
  const FREE_SUBJECT = "probe free subject query";

  // ── Mutable observation state ────────────────────────────────────────────────
  const queryState = {
    observedOptions: undefined as QueryOptions | undefined,
    observedPrompts: [] as string[],
    sectionIdForProposal: "",
  };
  const fakeDossier = makeFakeDossier();

  // ── Open session with SP-3 deps ──────────────────────────────────────────────
  const rawSession = await api.scratchpad.openScratchpad({
    sidecarRoot: tmpDir,
    namespace: NAMESPACE,
    space: SPACE,
    dossier: fakeDossier,
    now: () => FIXED_NOW,
    loadQuery: makeFakeResearchLoadQuery(queryState),
  } as any);
  assert.ok(rawSession, "openScratchpad must return a live session");

  const session = rawSession as unknown as WithPostFromWebview;
  assert.equal(
    typeof session.postFromWebview,
    "function",
    "session must expose postFromWebview for the SP-3 research messages",
  );

  // ── Fresh space seeds all six section kinds ───────────────────────────────────
  // INVARIANT: a fresh thinking space document contains every section kind.
  const model = rawSession.model as unknown as { sections: SP3Section[] };
  const constraintsSection = model.sections.find(
    (s) => s.kind === "constraints",
  );
  assert.ok(
    constraintsSection,
    "a fresh space must have a constraints section — the six kinds are seeded on creation",
  );
  queryState.sectionIdForProposal = constraintsSection.id;

  // Seed intent and add a human item to constraints
  await session.postFromWebview({ type: "seedGoal", text: "GOALTEXT" });
  await session.postFromWebview({
    type: "addItem",
    sectionId: constraintsSection.id,
    text: ITEM_TEXT,
  });

  const constraintsAfter = (
    rawSession.model as unknown as { sections: SP3Section[] }
  ).sections.find((s) => s.kind === "constraints");
  const targetItem = constraintsAfter?.items.find((i) => i.text === ITEM_TEXT);
  assert.ok(
    targetItem,
    "the human-added item must appear in the constraints section",
  );

  // ── Trigger research on an item ──────────────────────────────────────────────
  fakeDossier.reads.length = 0;
  queryState.observedOptions = undefined;
  queryState.observedPrompts = [];

  await session.postFromWebview({ type: "research", itemId: targetItem.id });

  // INVARIANT: dossier-first — read is called with slugify(item.text) before any round
  assert.ok(
    fakeDossier.reads.includes(slugify(ITEM_TEXT)),
    `dossier.read must be called with topic '${slugify(ITEM_TEXT)}' (slugified item text) — ` +
      "the research worker is dossier-first: consult the dossier before any model round",
  );

  // INVARIANT: query options carry the exact mcpTools from the contract
  assert.ok(
    queryState.observedOptions,
    "loadQuery must have been invoked for the research round — " +
      "a research trigger must reach the research worker",
  );
  assert.deepStrictEqual(
    (queryState.observedOptions as any).mcpTools,
    ["tk-package-version", "web-fetch", "repo-explorer"],
    "the research round's QueryOptions.mcpTools must be exactly " +
      '["tk-package-version", "web-fetch", "repo-explorer"] per the contract — ' +
      "this is the observable wiring of the live tool groups",
  );

  // INVARIANT: corpusPaths carries [<sidecarRoot>/<namespace>] — the board corpus
  assert.deepStrictEqual(
    (queryState.observedOptions as any).corpusPaths,
    [path.join(tmpDir, NAMESPACE)],
    "the research round's QueryOptions.corpusPaths must be [<sidecarRoot>/<namespace>] — " +
      "the board corpus path so the worker is grounded in the repo and board artifacts",
  );

  // INVARIANT: the round's prompt contains the item text (right target reached)
  assert.ok(
    queryState.observedPrompts.some((p) => p.includes(ITEM_TEXT)),
    `the research round's prompt must contain the item text '${ITEM_TEXT}' — ` +
      "the worker receives the right target when triggered on an item",
  );

  // INVARIANT: findings land only as unchecked proposals (checked: false)
  const constraintsWithProposals = (
    rawSession.model as unknown as { sections: SP3Section[] }
  ).sections.find((s) => s.kind === "constraints");
  const proposed =
    constraintsWithProposals?.items.filter(
      (i) => i.text === "RESEARCHPROPOSEDITEMTEXT",
    ) ?? [];
  assert.ok(
    proposed.length > 0,
    "the research round must propose at least one item into the section — " +
      "findings must land as proposals, not silently discard",
  );
  for (const item of proposed) {
    assert.equal(
      item.checked,
      false,
      `proposed item '${item.text}' must be unchecked (checked: false) — ` +
        "the research gate never checks items; only the human settles",
    );
    assert.equal(
      item.origin,
      "research",
      "items proposed by the research worker must carry origin='research'",
    );
  }

  // INVARIANT: evidence chips carry method, date from deps.now(), and dossierRef
  const html = rawSession.renderedHtml();
  assert.ok(
    /class\s*=\s*["'][^"']*\bevidence-chip\b[^"']*["']/.test(html),
    "renderedHtml() must contain at least one element with class 'evidence-chip' " +
      "after a research round — every finding must carry its provenance",
  );
  assert.ok(
    html.includes(`data-checked-at="${FIXED_ISO}"`),
    `evidence chip must carry data-checked-at="${FIXED_ISO}" (from deps.now()) — ` +
      "the timestamp is stamped by the session using the injected clock, not system time",
  );
  assert.ok(
    /data-dossier-ref\s*=\s*["'][^"']+["']/.test(html),
    "evidence chip must carry a data-dossier-ref attribute — " +
      "every chip references the dossier file the round wrote or re-read",
  );
  assert.ok(
    html.includes(`data-dossier-ref="research/${slugify(ITEM_TEXT)}.md"`),
    `evidence chip must carry data-dossier-ref="research/${slugify(ITEM_TEXT)}.md" — ` +
      "the dossierRef is derived from the topic (slugified item text) and matches what the round wrote",
  );
  assert.ok(
    /data-method\s*=\s*["'][^"']+["']/.test(html),
    "evidence chip must carry a non-empty data-method attribute — " +
      "the method field documents how the evidence was gathered",
  );

  // ── Trigger research on a free subject ──────────────────────────────────────
  fakeDossier.reads.length = 0;
  queryState.observedOptions = undefined;
  queryState.observedPrompts = [];
  queryState.sectionIdForProposal =
    (rawSession.model as unknown as { sections: SP3Section[] }).sections.find(
      (s) => s.kind === "elements",
    )?.id ?? constraintsSection.id;

  await session.postFromWebview({ type: "research", subject: FREE_SUBJECT });

  // INVARIANT: dossier.read called with slugify(subject) for subject-based research
  assert.ok(
    fakeDossier.reads.includes(slugify(FREE_SUBJECT)),
    `dossier.read must be called with topic '${slugify(FREE_SUBJECT)}' (slugified subject) — ` +
      "the research worker derives the topic from the subject when triggered by #research-input",
  );

  // INVARIANT: round's prompt contains the subject text (right target reached)
  assert.ok(
    queryState.observedOptions,
    "loadQuery must be invoked for the free-subject research round",
  );
  assert.ok(
    queryState.observedPrompts.some((p) => p.includes(FREE_SUBJECT)),
    `the research round's prompt must contain the free subject '${FREE_SUBJECT}' — ` +
      "the worker receives the right target when triggered via the free-subject field",
  );

  // ── Gate rejection: research worker checkItem attempt is rejected ────────────
  // Open a separate session with a loadQuery that yields a disallowed checkItem.
  const gateDir = path.join(tmpDir, "gate-test");
  fs.mkdirSync(gateDir, { recursive: true });

  const gateDossier = makeFakeDossier();
  let gateItemId = "";
  const gateLoadQueryState = {
    observedOptions: undefined as QueryOptions | undefined,
    observedPrompts: [] as string[],
    sectionIdForProposal: "",
  };

  // We need the gate session's item ID to yield checkItem targeting that item.
  // We use a two-stage fake: stage-1 proposes an item; stage-2 tries to checkItem.
  // Since loadQuery is called fresh per round, we use separate sessions for clarity.

  // Gate session: open with the gate-test checkItem-yielding loadQuery.
  const gateItemText = "GATEITEMHUMAN";
  let gateLoadQueryCallCount = 0;

  const gateRawSession = await api.scratchpad.openScratchpad({
    sidecarRoot: gateDir,
    namespace: "gate-ns",
    space: "gate-space",
    dossier: gateDossier,
    now: () => FIXED_NOW,
    loadQuery: (): QueryFn =>
      async function* (_args) {
        // Use the first item found in the constraints section as the target
        const gateModel = gateRawSession.model as unknown as {
          sections: SP3Section[];
        };
        const constraintsItems =
          gateModel.sections.find((s) => s.kind === "constraints")?.items ?? [];
        const firstItem = constraintsItems[0];
        gateLoadQueryCallCount++;
        if (firstItem) {
          yield {
            type: "actions",
            actions: [
              { type: "checkItem", actor: "research", itemId: firstItem.id },
            ],
          } as any;
        }
      },
  } as any);

  const gateSession = gateRawSession as unknown as WithPostFromWebview;

  // Add a human item to the gate session's constraints section
  await gateSession.postFromWebview({ type: "seedGoal", text: "GATEGLOAL" });
  const gateConstraints = (
    gateRawSession.model as unknown as { sections: SP3Section[] }
  ).sections.find((s) => s.kind === "constraints");
  assert.ok(gateConstraints, "gate session must have a constraints section");

  await gateSession.postFromWebview({
    type: "addItem",
    sectionId: gateConstraints.id,
    text: gateItemText,
  });

  // Human-added items are born checked per the contract (addItem actor:human)
  const gateModelBeforeRound = gateRawSession.model as unknown as {
    sections: SP3Section[];
  };
  const gateItemBefore = gateModelBeforeRound.sections
    .find((s) => s.kind === "constraints")
    ?.items.find((i) => i.text === gateItemText);
  assert.ok(gateItemBefore, "the gate item must exist after addItem");
  assert.equal(
    gateItemBefore.checked,
    true,
    "a human-added item (actor:human addItem) must be born checked:true",
  );

  // Trigger research — the loadQuery yields a disallowed checkItem action
  await gateSession.postFromWebview({
    type: "research",
    subject: "gate subject",
  });

  // INVARIANT: the checkItem action from the research worker is rejected —
  // the item's checked state must not change and the model reference is unmodified for
  // that action (same model reference returned by the reducer on rejection).
  const gateConstraintsAfter = (
    gateRawSession.model as unknown as { sections: SP3Section[] }
  ).sections.find((s) => s.kind === "constraints");
  const gateItemAfter = gateConstraintsAfter?.items.find(
    (i) => i.text === gateItemText,
  );
  assert.ok(
    gateItemAfter,
    "the gate item must still exist after the research round",
  );
  assert.equal(
    gateItemAfter.checked,
    true,
    "GATE INVARIANT: the research worker's checkItem action must be rejected — " +
      "the item's checked state (true, set by the human) must be unchanged; " +
      "only the human can uncheck; the worker cannot override the human's settlement",
  );

  // INVARIANT: a rejected delta must appear in the session's delta log for the
  // checkItem action — the gate enforcement is visible and auditable, not silent.
  const allDeltas = (gateRawSession as any).deltas as Array<{
    kind?: string;
    action?: { type: string };
  }>;
  const rejectedCheckItemDelta = allDeltas.find(
    (d) => d.kind === "rejected" && d.action?.type === "checkItem",
  );
  assert.ok(
    rejectedCheckItemDelta,
    "GATE INVARIANT: a { kind:'rejected', action:{type:'checkItem'} } delta must appear " +
      "in the session's delta log — the gate rejection is a first-class observable event, " +
      "not a silent drop",
  );
}
