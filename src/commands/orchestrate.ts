/**
 * `/orchestrate` command (SP-tgs8nz_SL-1): dispatch the next Ready slice of a chosen Spec
 * via `OrchestratorService`. Thin vscode glue — resolves the active board repo, the spec,
 * and the worktree/board config, then calls `dispatchNext` and streams the worker's
 * JSON-log to an output channel. The dispatch logic + parsing are the unit-tested core;
 * the live worker outcome is the human's verdict.
 */
import * as vscode from "vscode";
import { ThinkubeStore } from "../store/ThinkubeStore";
import { WorktreeService } from "../services/WorktreeService";
import { OrchestratorService } from "../services/OrchestratorService";
import type { OwnershipArbiter } from "../services/OwnershipArbiter";
import type { SpecsProvider } from "../views/boards/SpecsProvider";

export interface OrchestrateDeps {
  specsProvider: SpecsProvider;
  /** The arbiter is built async at activation — a getter so we read it when invoked. */
  getArbiter: () => OwnershipArbiter | undefined;
  /** Injectable for tests; defaults to real instances. */
  worktrees?: WorktreeService;
  output?: vscode.OutputChannel;
}

export function registerOrchestrateCommands(
  context: vscode.ExtensionContext,
  deps: OrchestrateDeps,
): void {
  const worktrees = deps.worktrees ?? new WorktreeService();
  const output =
    deps.output ?? vscode.window.createOutputChannel("Thinkube Orchestrator");
  context.subscriptions.push(
    output,
    vscode.commands.registerCommand("thinkube.orchestrate", async () => {
      const repo = deps.specsProvider.repoEntry;
      if (!repo || !repo.enabled) {
        vscode.window.showInformationMessage(
          "Select an enabled thinking space to orchestrate.",
        );
        return;
      }
      const arbiter = deps.getArbiter();
      if (!arbiter) {
        vscode.window.showWarningMessage(
          "Orchestrator not ready — the ownership arbiter is still activating. Try again in a moment.",
        );
        return;
      }
      try {
        const store = new ThinkubeStore(repo.path, repo.boardDir);
        const specs = (await store.listSpecDirs())
          .map((d) => /SP-([^/]+)/.exec(d)?.[1])
          .filter((id): id is string => !!id);
        if (specs.length === 0) {
          vscode.window.showInformationMessage("No Specs on this board yet.");
          return;
        }
        const specId =
          specs.length === 1
            ? specs[0]
            : await vscode.window.showQuickPick(
                specs.map((id) => `SP-${id}`),
                { placeHolder: "Orchestrate which Spec's next Ready slice?" },
              );
        if (!specId) return;
        const spec = specId.replace(/^SP-/, "");

        const canonical =
          (await worktrees.canonicalRepo(repo.path)) ?? repo.path;
        const baseDir =
          vscode.workspace
            .getConfiguration("thinkube")
            .get<string>("worktree.baseDir")
            ?.trim() || undefined;
        const boardRoot =
          vscode.workspace
            .getConfiguration("thinkube.boards")
            .get<string>("root")
            ?.trim() || undefined;

        const orchestrator = new OrchestratorService({
          worktrees,
          arbiter,
          store,
          output,
          canonicalRepo: canonical,
          boardRoot,
          baseDir,
        });
        output.show(true);
        const r = await orchestrator.dispatchNext(spec);
        if (!r.dispatched) {
          vscode.window.showInformationMessage(
            `SP-${spec}: nothing dispatched — ${r.reason ?? "no Ready slice"}.`,
          );
        } else {
          vscode.window.showInformationMessage(
            `Dispatched ${r.handle} — worker ${r.success ? "succeeded" : "did not succeed"}. Verify + advance via the gate.`,
          );
        }
      } catch (err) {
        vscode.window.showErrorMessage(
          `Orchestrate failed: ${(err as Error).message}`,
        );
      }
    }),
  );
}
