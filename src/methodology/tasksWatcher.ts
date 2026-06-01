/**
 * Tasks-file watcher — surfaces the "Materialise N tasks for SP-{n}?" toast
 * whenever a `.thinkube/specs/SP-*-tasks.md` file appears or changes with
 * unchecked rows.
 *
 * The watcher subscribes to `ThinkubeStore.watch('spec', …)`, which the
 * store already routes for the task-decomposition siblings (per chunk 4).
 * On a `created` / `changed` event we peek into the file, count unchecked
 * rows, and pop a single notification per file per debounce window. The
 * debounce avoids retriggering on the burst of write events VS Code emits
 * when an editor saves.
 *
 * On accept, we call into `TasksMaterializer.materialize(...)` directly —
 * we don't go through the command palette so the same flow works whether
 * the file was written by the bundle's `/tasks-decompose` skill or by the
 * user hand-editing it.
 */
import * as vscode from "vscode";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { TasksMaterializer } from "./TasksMaterializer";
import { parseTasksFile } from "./tasksFormat";

const DEBOUNCE_MS = 4000;

export interface TasksWatcherDeps {
  store: ThinkubeStore;
  materializer: TasksMaterializer;
  output: vscode.OutputChannel;
}

export function installTasksWatcher(deps: TasksWatcherDeps): vscode.Disposable {
  const lastFiredAt = new Map<string, number>();

  return deps.store.watch("spec", async (change) => {
    // Store.watch('spec') also surfaces task-decomposition sibling events.
    if (change.kind !== "task-decomposition") return;
    if (change.type === "deleted") {
      lastFiredAt.delete(change.relativePath);
      return;
    }

    const now = Date.now();
    const last = lastFiredAt.get(change.relativePath) ?? 0;
    if (now - last < DEBOUNCE_MS) return;
    lastFiredAt.set(change.relativePath, now);

    let unchecked = 0;
    let specIssueNumber: number | undefined;
    try {
      const parsed = await deps.store.getFile(change.relativePath);
      if (!parsed) return;
      const { tasks } = parseTasksFile(parsed.raw);
      unchecked = tasks.filter((t) => !t.checked).length;
      const fm = parsed.frontmatter ?? {};
      const issue = fm.parent_issue ?? fm.issue;
      if (typeof issue === "number" && Number.isFinite(issue)) {
        specIssueNumber = issue;
      }
    } catch (err) {
      deps.output.appendLine(
        `[tasks-watcher] failed to inspect ${change.relativePath}: ${(err as Error).message}`,
      );
      return;
    }

    if (unchecked === 0 || specIssueNumber === undefined) return;

    const label = unchecked === 1 ? "1 task" : `${unchecked} tasks`;
    const choice = await vscode.window.showInformationMessage(
      `Materialise ${label} for SP-${specIssueNumber}?`,
      "Materialise",
      "Dismiss",
    );
    if (choice !== "Materialise") return;

    try {
      const result = await deps.materializer.materialize({
        specIssueNumber,
      });
      if (result.created.length > 0) {
        vscode.window.showInformationMessage(
          `Created ${result.created.length} Task issue${result.created.length === 1 ? "" : "s"} for SP-${specIssueNumber}.`,
        );
      }
      if (result.failed.length > 0) {
        vscode.window.showWarningMessage(
          `${result.failed.length} of ${result.failed.length + result.created.length} rows failed — see Thinkube Kanban output.`,
        );
      }
    } catch (err) {
      deps.output.appendLine(
        `[tasks-watcher] materialise failed: ${(err as Error).message}`,
      );
      vscode.window.showErrorMessage(
        `Materialise failed: ${(err as Error).message}`,
      );
    }
  });
}
