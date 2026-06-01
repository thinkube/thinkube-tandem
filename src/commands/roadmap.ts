/**
 * Roadmap commands (thinkube.roadmap.*).
 *
 * Chunk-6 surface:
 *
 *   refresh   — drop the tree's child cache and re-fetch from GitHub.
 *   openCard  — opens the issue's GitHub URL in the user's browser. Chunk 8
 *               replaces this with a CardDetailPanel webview.
 *   newEpic / newStory / newSpec — placeholders pointing at chunk 8 wizards.
 *               We register them so the toolbar buttons aren't dead, but the
 *               actual flows land alongside the wizard webviews.
 *
 * Selection-driven context keys:
 *   thinkube.roadmap.selectedKind = 'epic' | 'story' | 'spec' | undefined
 * powers the when-clauses on the New Story / New Spec toolbar buttons.
 */
import * as vscode from "vscode";

import { GitHubService } from "../github/GitHubService";
import { ThinkubeStore } from "../store/ThinkubeStore";
import {
  CardDetailDeps,
  CardDetailPanel,
} from "../views/detail/CardDetailPanel";
import {
  RoadmapNode,
  RoadmapTreeProvider,
} from "../views/roadmap/RoadmapTreeProvider";
import {
  newEpicWizard,
  newSpecWizard,
  newStoryWizard,
  WizardDeps,
} from "./wizards";

interface RoadmapDeps {
  treeView: vscode.TreeView<RoadmapNode>;
  provider: RoadmapTreeProvider;
  output: vscode.OutputChannel;
  github: GitHubService;
  store: ThinkubeStore | undefined;
  cardDetail: CardDetailDeps;
}

export function registerRoadmapCommands(
  context: vscode.ExtensionContext,
  deps: RoadmapDeps,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube.roadmap.refresh", () => {
      deps.provider.refresh();
    }),
    vscode.commands.registerCommand(
      "thinkube.roadmap.openCard",
      async (node?: RoadmapNode) => {
        const target = node ?? singleSelection(deps.treeView);
        if (!target) {
          vscode.window.showInformationMessage("Select a roadmap node first.");
          return;
        }
        await CardDetailPanel.open(deps.cardDetail, {
          coords: target.coords,
          issue: target.issue,
          kind: target.kind,
        });
      },
    ),
    vscode.commands.registerCommand("thinkube.roadmap.newEpic", () =>
      newEpicWizard(wizardDeps(deps)),
    ),
    vscode.commands.registerCommand(
      "thinkube.roadmap.newStory",
      (node?: RoadmapNode) => {
        const parent = node ?? singleSelection(deps.treeView);
        if (!parent || parent.kind !== "epic") {
          vscode.window.showWarningMessage(
            "Select an Epic before creating a Story.",
          );
          return;
        }
        return newStoryWizard(wizardDeps(deps), {
          coords: parent.coords,
          issue: parent.issue,
        });
      },
    ),
    vscode.commands.registerCommand(
      "thinkube.roadmap.newSpec",
      (node?: RoadmapNode) => {
        const parent = node ?? singleSelection(deps.treeView);
        if (!parent || parent.kind !== "story") {
          vscode.window.showWarningMessage(
            "Select a Story before creating a Spec.",
          );
          return;
        }
        return newSpecWizard(wizardDeps(deps), {
          coords: parent.coords,
          issue: parent.issue,
        });
      },
    ),
  );

  // Selection → context key, used in package.json when-clauses.
  context.subscriptions.push(
    deps.treeView.onDidChangeSelection((e) => {
      const top = e.selection[0];
      vscode.commands.executeCommand(
        "setContext",
        "thinkube.roadmap.selectedKind",
        top?.kind,
      );
    }),
  );
}

function singleSelection(
  treeView: vscode.TreeView<RoadmapNode>,
): RoadmapNode | undefined {
  return treeView.selection[0];
}

function wizardDeps(deps: RoadmapDeps): WizardDeps {
  return {
    github: deps.github,
    store: deps.store,
    output: deps.output,
    roadmap: deps.provider,
    cardDetail: deps.cardDetail,
  };
}
