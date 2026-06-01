/**
 * Roadmap creation wizards: new Epic / Story / Spec.
 *
 * Each wizard:
 *   1. Prompts for a title (required, non-empty).
 *   2. Prompts for a body / pitch (optional one-paragraph; the user can
 *      flesh it out later via the CardDetailPanel or the editor).
 *   3. Creates the GitHub issue via `GitHubService.createIssue({type, …})`.
 *   4. For Story/Spec, links it under its parent via `addSubIssue`. Failures
 *      here are surfaced but non-fatal — the issue exists on GitHub even if
 *      the link couldn't be installed (older repos / missing schema).
 *   5. Writes the paired `.thinkube/<kind>s/<prefix>-<n>.md` with proper
 *      frontmatter. Failures here are surfaced but again non-fatal — the
 *      issue is the source of truth; the markdown file is a sidecar.
 *   6. Refreshes the Roadmap tree (drops cached children at the new node's
 *      parent or root) and opens the CardDetailPanel for the new issue.
 *
 * Input convention: we use multi-step InputBoxes rather than a custom
 * webview to keep the install path zero-config. Multiline bodies aren't
 * supported by InputBox; the user gets the chance to expand the body in
 * the .thinkube file immediately after creation.
 */
import * as vscode from "vscode";

import {
  GitHubService,
  IssueSummary,
  Kind,
  RepoCoords,
} from "../github/GitHubService";
import { Frontmatter, ThinkubeStore } from "../store/ThinkubeStore";
import {
  CardDetailPanel,
  CardDetailDeps,
  CardDetailTarget,
} from "../views/detail/CardDetailPanel";
import { RoadmapTreeProvider } from "../views/roadmap/RoadmapTreeProvider";

export interface WizardDeps {
  github: GitHubService;
  store: ThinkubeStore | undefined;
  output: vscode.OutputChannel;
  roadmap: RoadmapTreeProvider;
  cardDetail: CardDetailDeps;
}

/**
 * Top-level entry: create a new Epic. No parent.
 */
export async function newEpicWizard(deps: WizardDeps): Promise<void> {
  const coords = readRepoCoords();
  if (!coords) {
    await missingRepoToast();
    return;
  }
  const draft = await collectTitleAndBody({
    kind: "Epic",
    prompt: "One-paragraph pitch — what is this epic about?",
  });
  if (!draft) return;

  await runWizard(deps, {
    coords,
    kind: "epic",
    parent: undefined,
    title: draft.title,
    body: draft.body,
  });
}

export async function newStoryWizard(
  deps: WizardDeps,
  parent: { coords: RepoCoords; issue: IssueSummary },
): Promise<void> {
  const draft = await collectTitleAndBody({
    kind: "Story",
    prompt: `Story body — what does this story deliver under epic #${parent.issue.number}?`,
  });
  if (!draft) return;

  await runWizard(deps, {
    coords: parent.coords,
    kind: "story",
    parent: parent.issue,
    title: draft.title,
    body: draft.body,
  });
}

export async function newSpecWizard(
  deps: WizardDeps,
  parent: { coords: RepoCoords; issue: IssueSummary },
): Promise<void> {
  const draft = await collectTitleAndBody({
    kind: "Spec",
    prompt: `Spec body — what does this spec cover under story #${parent.issue.number}?`,
  });
  if (!draft) return;

  await runWizard(deps, {
    coords: parent.coords,
    kind: "spec",
    parent: parent.issue,
    title: draft.title,
    body: draft.body,
  });
}

// ─── Internals ──────────────────────────────────────────────────────────────

interface RunInput {
  coords: RepoCoords;
  kind: Kind & ("epic" | "story" | "spec");
  parent: IssueSummary | undefined;
  title: string;
  body: string;
}

async function runWizard(deps: WizardDeps, input: RunInput): Promise<void> {
  const { github, store, output, roadmap, cardDetail } = deps;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Creating ${capitalize(input.kind)} on GitHub…`,
    },
    async (progress) => {
      let created: IssueSummary;
      try {
        created = await github.createIssue(input.coords, {
          type: input.kind,
          title: input.title,
          body: input.body,
        });
        output.appendLine(
          `[wizard] created ${input.kind} #${created.number} ${created.url}`,
        );
      } catch (err) {
        const e = err as Error;
        output.appendLine(`[wizard] createIssue failed: ${e.message}`);
        vscode.window.showErrorMessage(
          `Failed to create ${input.kind}: ${e.message}`,
        );
        return;
      }

      if (input.parent) {
        progress.report({ message: "linking sub-issue…" });
        try {
          await github.addSubIssue(input.parent.nodeId, created.nodeId);
        } catch (err) {
          // Non-fatal — the issue exists; the link can be added by hand.
          const e = err as Error;
          output.appendLine(
            `[wizard] addSubIssue failed (non-fatal): ${e.message}`,
          );
          vscode.window.showWarningMessage(
            `Created ${input.kind} #${created.number}, but couldn't link to #${input.parent.number}: ${e.message}`,
          );
        }
      }

      if (store) {
        progress.report({ message: "writing .thinkube file…" });
        const relPath = store.pathFor(input.kind, created.number);
        const fm: Frontmatter = {
          kind: input.kind,
          issue: created.number,
          repo: `${input.coords.owner}/${input.coords.name}`,
          created: new Date().toISOString().slice(0, 10),
        };
        if (input.parent) fm.parent_issue = input.parent.number;
        const fileBody = `# ${input.title}\n\n${input.body}\n`;
        try {
          await store.writeFile(relPath, fm, fileBody);
          output.appendLine(`[wizard] wrote ${relPath}`);
        } catch (err) {
          const e = err as Error;
          output.appendLine(`[wizard] writeFile failed: ${e.message}`);
          vscode.window.showWarningMessage(
            `${input.kind} created, but .thinkube file write failed: ${e.message}`,
          );
        }
      }

      // Refresh the roadmap so the new node appears. We do a full refresh
      // rather than targeted invalidate because finding the parent
      // RoadmapNode from the IssueSummary requires extra bookkeeping.
      roadmap.refresh();

      await CardDetailPanel.open(cardDetail, {
        coords: input.coords,
        issue: created,
        kind: input.kind,
        parentIssueNumber: input.parent?.number,
      });
    },
  );
}

interface DraftPrompt {
  kind: "Epic" | "Story" | "Spec";
  prompt: string;
}

async function collectTitleAndBody(
  prompt: DraftPrompt,
): Promise<{ title: string; body: string } | undefined> {
  const title = await vscode.window.showInputBox({
    title: `New ${prompt.kind} — title`,
    prompt: "Short, imperative phrasing recommended",
    validateInput: (v) =>
      v.trim().length > 0 ? undefined : "Title can't be empty",
    ignoreFocusOut: true,
  });
  if (title === undefined) return undefined;

  const body = await vscode.window.showInputBox({
    title: `New ${prompt.kind} — body`,
    prompt: prompt.prompt,
    placeHolder: "(optional — leave empty to fill in via the .thinkube file)",
    ignoreFocusOut: true,
  });
  if (body === undefined) return undefined;

  return { title: title.trim(), body: body.trim() };
}

function readRepoCoords(): RepoCoords | undefined {
  const raw = vscode.workspace
    .getConfiguration("thinkube.kanban")
    .get<string>("repo", "")
    .trim();
  if (!raw.includes("/")) return undefined;
  const [owner, name] = raw.split("/", 2);
  if (!owner || !name) return undefined;
  return { owner, name };
}

async function missingRepoToast(): Promise<void> {
  const action = await vscode.window.showErrorMessage(
    "Set `thinkube.kanban.repo` to `owner/repo` before creating epics.",
    "Configure",
  );
  if (action === "Configure") {
    await vscode.commands.executeCommand("thinkube.kanban.configureProject");
  }
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
