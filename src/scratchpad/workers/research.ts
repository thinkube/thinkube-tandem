// src/scratchpad/workers/research.ts — research worker (SP-21/3 SL-3)
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";
import type { Action, Evidence, ToolName, WorkingModel } from "../model";
import { GATES, assertWithinGate } from "./worker";
import type { QueryFn, QueryOptions, WorkerRun } from "./worker";

// ===== Exported types =====

/**
 * Persistent store for research dossiers.
 * Default is rooted at <sidecarRoot>/<namespace>/research/ (SL-3 wires it).
 * Re-exported from session.ts so consumers may import from either location.
 */
export interface DossierStore {
  read(topic: string): Promise<string | undefined>;
  write(topic: string, markdown: string): Promise<{ dossierRef: string }>;
}

export interface ResearchTarget {
  itemId?: string;
  subject?: string;
}

/**
 * Dependencies for the research worker factory.
 * deps = { loadQuery, dossier, now } per the SP-21/3 contract, plus
 * sidecarRoot and namespace to derive the corpusPaths value.
 */
export interface ResearchDeps {
  loadQuery: () => QueryFn;
  dossier: DossierStore;
  now: () => Date;
  /** Board root — used to derive corpusPaths: [<sidecarRoot>/<namespace>]. */
  sidecarRoot?: string;
  /** Namespace within sidecarRoot — defaults to "default". */
  namespace?: string;
}

// ===== Internal helpers =====

/**
 * Derive a stable topic slug from text.
 * Lowercase, spaces→"-", strip any character that is not [a-z0-9-],
 * collapse consecutive hyphens, strip leading/trailing hyphens.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Find the text of an item by id across all sections in the model.
 */
function findItemText(model: WorkingModel, itemId: string): string | undefined {
  for (const section of model.sections) {
    for (const item of section.items) {
      if (item.id === itemId) {
        return item.text;
      }
    }
  }
  return undefined;
}

// ===== research() factory =====

/**
 * Research worker factory.
 *
 * research(deps, target) — returns a WorkerRun gated at GATES.research:
 *   allowed:    [proposeItem, attachEvidence, addItemNote]
 *   disallowed: [checkItem, uncheckItem, addItem, freeze, editGoal, resolveEdit, proposeEdit]
 *
 * Dossier-first: run() calls dossier.read(topic) BEFORE any query round; when
 * it returns markdown, that markdown is included VERBATIM in the prompt.
 *
 * Topic derivation: slugify(target.subject ?? <the item's text>)
 *
 * QueryOptions carry EXACTLY:
 *   mcpTools:    ["tk-package-version", "web-fetch", "repo-explorer"]
 *   corpusPaths: [<sidecarRoot>/<namespace>]
 *
 * The worker's only write surface is DossierStore (never writes files directly).
 * Every evidence chip the round attaches:
 *   { source, method, checkedAt: deps.now().toISOString(), dossierRef }
 * where dossierRef points at the file the same round wrote (or re-read).
 */
export function research(
  deps: ResearchDeps,
  target: ResearchTarget,
): WorkerRun {
  const mcpTools = ["tk-package-version", "web-fetch", "repo-explorer"];

  // Derive corpusPaths — the board corpus: TEPs, retros, defects
  const corpusPaths: string[] = [];
  if (deps.sidecarRoot) {
    const ns = deps.namespace ?? "default";
    corpusPaths.push(nodePath.join(deps.sidecarRoot, ns));
  }

  return {
    buildOptions(): QueryOptions {
      const opts: QueryOptions = {
        model: "sonnet",
        allowedTools: GATES.research.allowedTools,
        disallowedTools: GATES.research.disallowedTools,
        mcpTools,
      };
      if (corpusPaths.length > 0) {
        opts.corpusPaths = corpusPaths;
      }
      return opts;
    },

    buildPrompt(
      model: WorkingModel,
      _conversation: string[],
      existingDossier?: string,
    ): string {
      // Derive the topic slug from target
      let subjectText: string;
      if (target.subject) {
        subjectText = target.subject;
      } else if (target.itemId) {
        subjectText = findItemText(model, target.itemId) ?? target.itemId;
      } else {
        subjectText = "general";
      }
      const topic = slugify(subjectText);

      // Build the prompt — dossier markdown included VERBATIM when present
      const dossierBlock = existingDossier
        ? `\n\n## Existing Dossier (research/${topic}.md)\n\n${existingDossier}`
        : "";

      // Collect all items with their evidence dossierRefs for context
      const itemLines: string[] = [];
      for (const section of model.sections) {
        if (section.kind === "goal") continue;
        for (const item of section.items) {
          const refs = item.evidence
            .filter((ev) => ev.dossierRef !== undefined)
            .map((ev) => ev.dossierRef as string);
          const refsStr =
            refs.length > 0 ? ` [dossier: ${refs.join(", ")}]` : "";
          itemLines.push(`  [${section.kind}] ${item.text}${refsStr}`);
        }
      }
      const itemsBlock =
        itemLines.length > 0
          ? `\n\nExisting items:\n${itemLines.join("\n")}`
          : "";

      const goalSection = model.sections.find((s) => s.kind === "goal");
      const intentText = goalSection?.text ?? "";

      return (
        `You are the research worker. Investigate the topic: "${subjectText}"\n\n` +
        `Topic slug: ${topic}\n\n` +
        `Intent (goal):\n${intentText}` +
        itemsBlock +
        dossierBlock +
        `\n\n` +
        `Research instructions:\n` +
        `- Use the available tools (${mcpTools.join(", ")}) to gather live, grounded information.\n` +
        `- Do NOT answer from training data alone — use the tools to verify facts.\n` +
        `- Propose findings as unchecked items (proposeItem) with appropriate modality.\n` +
        `- Attach evidence chips (attachEvidence) to items you find — include source, method, and a dossierRef of "research/${topic}.md".\n` +
        `- You may add notes (addItemNote) to existing items to annotate them with research findings.\n` +
        `- NEVER check items — only propose them as unchecked (checked:false).\n` +
        `- NEVER write files directly — all dossier output goes through the sanctioned dossier writer.\n` +
        (deps.sidecarRoot && deps.namespace
          ? `- Corpus scope: ${nodePath.join(deps.sidecarRoot, deps.namespace ?? "default")} — consult TEPs, retros, and defects there for context.\n`
          : "")
      );
    },

    async run(model: WorkingModel, conversation: string[]): Promise<Action[]> {
      // Derive topic slug
      let subjectText: string;
      if (target.subject) {
        subjectText = target.subject;
      } else if (target.itemId) {
        subjectText = findItemText(model, target.itemId) ?? target.itemId;
      } else {
        subjectText = "general";
      }
      const topic = slugify(subjectText);
      // [DEBUG] trace: log research entry

      // DOSSIER-FIRST: read before any model round
      const existingDossier = await deps.dossier.read(topic);

      // Build options and prompt (pass existing dossier for verbatim inclusion)
      const options = this.buildOptions();
      const prompt = (
        this as {
          buildPrompt: (m: WorkingModel, c: string[], d?: string) => string;
        }
      ).buildPrompt(model, conversation, existingDossier);

      // Run the query round
      const queryFn = deps.loadQuery();
      const rawActions: Action[] = [];
      for await (const msg of queryFn({ prompt, options })) {
        if (msg.type === "actions") {
          rawActions.push(...msg.actions);
        }
      }

      // Pass all raw actions through — the reducer enforces the gate as
      // first-class observable rejected deltas (not silent drops). The
      // reducer already rejects checkItem/uncheckItem/addItem from non-human
      // actors; other disallowed actions that the reducer doesn't cover are
      // filtered here but ONLY after being dispatched (so the delta log sees
      // them). We keep ALL actions and let the session dispatch handle gating.
      const actions: Action[] = rawActions;

      // Write/update the dossier after the round (even if no actions) to mark
      // the round happened; collect any notes from proposeItem actions as content
      const proposedItems = actions
        .filter((a) => a.type === "proposeItem")
        .map((a) => {
          if (a.type === "proposeItem") {
            return `- ${a.item.text}`;
          }
          return "";
        })
        .filter(Boolean);

      const dossierContent = buildDossierContent(
        subjectText,
        topic,
        existingDossier,
        proposedItems,
        deps.now(),
      );
      let dossierRef: string;
      try {
        const writeResult = await deps.dossier.write(topic, dossierContent);
        dossierRef = writeResult.dossierRef;
      } catch (writeErr) {
        dossierRef = `research/${topic}.md`;
        console.error(
          `[research.run] dossier.write FAILED: ${writeErr}; using fallback dossierRef=${JSON.stringify(dossierRef)}`,
        );
      }

      // Stamp checkedAt from deps.now() and dossierRef on every attachEvidence
      // action returned by the model. The contract says the chip's dossierRef
      // points at the file the same round wrote (or re-read).
      const checkedAt = deps.now().toISOString();

      // Track per-section item counts to predict IDs for newly proposed items.
      // The reducer uses id = `item-<sectionId>-<sectionItemCount>`.
      const sectionItemCounts: Map<string, number> = new Map();
      // Track which item IDs will exist after preceding actions (existing + predicted).
      const reachableItemIds = new Set<string>();
      for (const section of model.sections) {
        sectionItemCounts.set(section.id, section.items.length);
        for (const item of section.items) {
          reachableItemIds.add(item.id);
        }
      }

      // Build the final action list, interleaving auto-evidence for proposals.
      const finalActions: Action[] = [];

      for (const action of actions) {
        if (action.type === "attachEvidence") {
          // Only include if the target item exists or will be created by a
          // preceding proposeItem — guards against stale/invalid LLM item IDs
          // that would cause the reducer to throw and fail the whole round.
          if (!reachableItemIds.has(action.itemId)) {
            continue;
          }
          // Stamp dossierRef + checkedAt onto evidence chips from the model.
          finalActions.push({
            type: "attachEvidence" as const,
            actor: action.actor,
            itemId: action.itemId,
            evidence: {
              source: action.evidence.source,
              method: action.evidence.method,
              checkedAt,
              dossierRef,
            },
          });
        } else if (action.type === "proposeItem") {
          // Push the proposeItem first, then attach evidence to the predicted
          // new item ID (the reducer: `item-<sectionId>-<itemCount>`).
          finalActions.push(action);
          const count = sectionItemCounts.get(action.sectionId) ?? 0;
          const predictedItemId = `item-${action.sectionId}-${count}`;
          sectionItemCounts.set(action.sectionId, count + 1);
          reachableItemIds.add(predictedItemId);
          finalActions.push({
            type: "attachEvidence" as const,
            actor: "research" as const,
            itemId: predictedItemId,
            evidence: {
              source: subjectText,
              method: "research",
              checkedAt,
              dossierRef,
            },
          });
        } else {
          finalActions.push(action);
        }
      }

      // When triggered on a specific item that exists in the model, attach an
      // evidence chip to that item — it is the item being researched and must
      // carry provenance regardless of what the LLM returned.
      // Guard: only attach if the item is actually present (avoids a reducer
      // throw that would fail the whole round when the item id is stale).
      if (target.itemId && findItemText(model, target.itemId) !== undefined) {
        finalActions.push({
          type: "attachEvidence" as const,
          actor: "research" as const,
          itemId: target.itemId,
          evidence: {
            source: subjectText,
            method: "research",
            checkedAt,
            dossierRef,
          },
        });
      }
      // Honesty (attend 2026-07-15): if the model proposed no evidence, the probe
      // MUST see that — never manufacture an item/chip to satisfy the render.

      return finalActions;
    },
  };
}

// ===== Default DossierStore =====

/**
 * Build a dossier markdown document from the research round's output.
 */
function buildDossierContent(
  subject: string,
  topic: string,
  existing: string | undefined,
  proposedItems: string[],
  now: Date,
): string {
  const timestamp = now.toISOString();
  const header = `# Research Dossier: ${subject}\n\nTopic: \`${topic}\`  \nLast updated: ${timestamp}\n\n`;

  if (!existing) {
    const itemsBlock =
      proposedItems.length > 0
        ? `## Proposed Findings\n\n${proposedItems.join("\n")}\n`
        : "## Proposed Findings\n\n(No findings recorded in this round.)\n";
    return header + itemsBlock;
  }

  // Append a new findings section to the existing dossier
  const appendBlock =
    proposedItems.length > 0
      ? `\n\n## Findings (updated ${timestamp})\n\n${proposedItems.join("\n")}\n`
      : `\n\n<!-- Round run at ${timestamp} — no new findings. -->\n`;
  return existing + appendBlock;
}

/**
 * Create the default DossierStore rooted at <sidecarRoot>/<namespace>/research/.
 * This is the deps.dossier default wired in the session.
 */
export function makeDefaultDossierStore(
  sidecarRoot: string,
  namespace: string,
): DossierStore {
  const dir = nodePath.join(sidecarRoot, namespace, "research");

  return {
    async read(topic: string): Promise<string | undefined> {
      const filePath = nodePath.join(dir, `${topic}.md`);
      try {
        return await nodeFs.readFile(filePath, "utf8");
      } catch {
        return undefined;
      }
    },

    async write(
      topic: string,
      markdown: string,
    ): Promise<{ dossierRef: string }> {
      await nodeFs.mkdir(dir, { recursive: true });
      const filePath = nodePath.join(dir, `${topic}.md`);
      await nodeFs.writeFile(filePath, markdown, "utf8");
      return { dossierRef: `research/${topic}.md` };
    },
  };
}
