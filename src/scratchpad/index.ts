import * as fs from "node:fs";
import * as nodePath from "node:path";
import * as vscode from "vscode";
import {
  openScratchpad,
  getScratchpadSession,
  _bootstrapExtensionUri,
} from "./session";
import { emptyModel } from "./model";
import { serialize } from "./persistence";

// ===== Public re-exports from model =====

export { emptyModel, goalSection, reduce, freezeEnabled } from "./model";
export type {
  Tenant,
  Phase,
  SectionKind,
  SectionState,
  Coverage,
  ToolName,
  Note,
  Proposal,
  Objection,
  Section,
  ReadinessRecord,
  WorkingModel,
  Action,
  Delta,
  // SP-21/3 new types
  Modality,
  ItemState,
  ItemOrigin,
  Actor,
  Evidence,
  PendingEdit,
  Item,
} from "./model";

export { serialize, deserialize } from "./persistence";

export {
  createPhaseWorker,
  gapFiller,
  integrator,
  GATES,
  assertWithinGate,
} from "./workers/worker";
export type {
  WorkerMessage,
  QueryFn,
  QueryOptions,
  PhaseWorkerDeps,
  WorkerFactoryDeps,
  WorkerRun,
} from "./workers/worker";

export { createLoop, ScratchpadLoop } from "./loop";
export type { PhaseWorkerMap, ScratchpadLoopDeps } from "./loop";

export {
  buildScratchpadHtml,
  ScratchpadDocumentView,
  STATE_MARKERS,
} from "./views/document";

// ===== Session seams =====

export { openScratchpad, getScratchpadSession } from "./session";
export type {
  ScratchpadSessionDeps,
  ScratchpadSession,
  ScratchpadInboundMessage,
  DryRunResult,
  SigningTool,
  DossierStore,
} from "./session";

// ===== Command registration =====

/**
 * Resolve the configured board root (thinkube.thinkingSpace.root).
 * Returns undefined when not configured.
 */
function boardRoot(): string | undefined {
  return (
    vscode.workspace
      .getConfiguration("thinkube.thinkingSpace")
      .get<string>("root")
      ?.trim() || undefined
  );
}

/**
 * Open the chat view with @thinky pre-typed (2026-07-17 field request:
 * "open the chat wired to the thinking space when it is opened"). The wiring
 * itself is inherent — @thinky always talks to the active session singleton —
 * so this only surfaces the mouth. isPartialQuery keeps the mention in the
 * input without submitting. Fail-soft on hosts without the chat view.
 */
async function openThinkyChat(): Promise<void> {
  const enabled = vscode.workspace
    .getConfiguration("thinkube.thinky")
    .get<boolean>("openChatOnSpaceOpen", true);
  if (!enabled) return;
  try {
    await vscode.commands.executeCommand("workbench.action.chat.open", {
      query: "@thinky ",
      isPartialQuery: true,
    });
  } catch {
    // No chat surface in this host — the panel alone is fine.
  }
}

/**
 * Register the Scratchpad commands with VS Code.
 * Call this from extension.ts activate().
 */
export function registerScratchpadCommands(
  context: vscode.ExtensionContext,
): void {
  // Provide the extension URI to session.ts so it can create webview panels.
  _bootstrapExtensionUri(context.extensionUri);

  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube.scratchpad.open", async () => {
      await openScratchpad();
      await openThinkyChat();
    }),
  );

  // ── Thinking-space tree commands (SP-21/3 SL-6) ──

  /**
   * Open an existing named thinking-space document.
   * Called with (namespace: string, name: string) — the node's two fields.
   * Routes through openScratchpad with namespace, space, and the configured board root.
   * Opening a different (namespace, space) pair replaces the singleton session.
   */
  // Tree commands arrive two ways: the row's default click passes explicit
  // string arguments; an INLINE menu button passes the tree NODE OBJECT as
  // the first argument (field crash 2026-07-17: path.join received an
  // Object). Accept both shapes.
  const nodeString = (v: unknown, key: "namespace" | "name"): string | undefined => {
    if (typeof v === "string") return v;
    if (typeof v === "object" && v !== null) {
      const val = (v as Record<string, unknown>)[key];
      if (typeof val === "string") return val;
    }
    return undefined;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.thinkingSpace.openDoc",
      async (nsArg: unknown, nameArg: unknown) => {
        const namespace = nodeString(nsArg, "namespace");
        const name = nodeString(nameArg, "name") ?? nodeString(nsArg, "name");
        if (!namespace || !name) {
          vscode.window.showErrorMessage(
            "Open thinking space: could not resolve the namespace/name from the tree node.",
          );
          return;
        }
        const sidecarRoot = boardRoot();
        await openScratchpad({ namespace, space: name, sidecarRoot });
        await openThinkyChat();
      },
    ),
  );

  /**
   * Create a new thinking-space document in the given namespace, then open it.
   * Prompts for a name, seeds the part-1 fresh-space shape
   * (emptyModel with one empty-items section per kind), then opens it.
   */
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.thinkingSpace.newDoc",
      async (nsArg: unknown) => {
        const namespace = nodeString(nsArg, "namespace");
        if (!namespace) {
          vscode.window.showErrorMessage(
            "New thinking space: could not resolve the namespace from the tree node.",
          );
          return;
        }
        const sidecarRoot = boardRoot();

        // Prompt for a document name.
        const name = await vscode.window.showInputBox({
          prompt: "Name for the new thinking space",
          placeHolder: "e.g. my-feature",
          validateInput: (v) => {
            const t = v.trim();
            if (!t) return "Name cannot be empty";
            if (!/^[a-zA-Z0-9_-]+$/.test(t))
              return "Use only letters, digits, hyphens, or underscores";
            return undefined;
          },
        });
        if (!name) return; // user cancelled

        const docName = name.trim();

        // Seed the fresh-space document on disk (if sidecarRoot is set).
        if (sidecarRoot) {
          const thinkingDir = nodePath.join(sidecarRoot, namespace, "thinking");
          const docPath = nodePath.join(thinkingDir, `${docName}.json`);
          try {
            fs.mkdirSync(thinkingDir, { recursive: true });
            // Only seed if the file doesn't already exist.
            if (!fs.existsSync(docPath)) {
              const freshModel = emptyModel("tep");
              fs.writeFileSync(docPath, serialize(freshModel), "utf8");
            }
          } catch (err) {
            vscode.window.showErrorMessage(
              `Could not create thinking space: ${err instanceof Error ? err.message : String(err)}`,
            );
            return;
          }
        }

        // Open the (possibly just-seeded) document.
        await openScratchpad({ namespace, space: docName, sidecarRoot });
        await openThinkyChat();
      },
    ),
  );
}
