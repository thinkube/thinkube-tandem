/**
 * TasksMaterializer — turns a `.thinkube/specs/SP-{n}-tasks.md` decomposition
 * into real GitHub Task issues linked under the parent Spec and seated in
 * the kanban's `Ready` column.
 *
 * Per-task pipeline:
 *   1. createIssue({type: 'task', title, body}) — body includes the inline
 *      description, the parent-spec reference, and any `(P)` / depends-on
 *      annotations so the source-of-truth issue carries the context.
 *   2. addSubIssue(spec.nodeId, task.nodeId) — link the child. Failures here
 *      are non-fatal: the issue exists and can be linked manually if the
 *      schema/permissions block this.
 *   3. addItemToProject(projectId, task.nodeId) → setStatus(Ready). Skipped
 *      when no project is configured (`thinkube.kanban.projectNumber` = 0);
 *      the user gets the issues but no kanban placement.
 *   4. After all tasks are processed, `[ ]` → `[x]` is flipped on each
 *      materialised row in the source file via `markMaterialized`. The
 *      checkbox state IS the materialised marker — re-running the
 *      materialiser on the same file is a no-op for already-checked rows.
 *
 * Failure model: per-task failures are collected and reported (not raised)
 * so a partially-bad file still materialises the tasks that succeed. The
 * file rewrite only marks the successful ones.
 *
 * Idempotency: a second `materialize(specIssue)` call on the same file
 * processes only unchecked rows. The materialiser doesn't dedupe by title
 * — if the user wants to re-create a task, they uncheck the box themselves.
 */
import * as vscode from "vscode";

import {
  GitHubService,
  IssueSummary,
  RepoCoords,
} from "../github/GitHubService";
import { ThinkubeStore } from "../store/ThinkubeStore";
import { markMaterialized, ParsedTask, parseTasksFile } from "./tasksFormat";

export interface MaterializerOptions {
  /** Spec issue number whose decomposition file to read (frontmatter `parent_issue`). */
  specIssueNumber: number;
}

export interface MaterializeResult {
  relativePath: string;
  created: Array<{ index: number; task: IssueSummary }>;
  skipped: Array<{ index: number; reason: string }>;
  failed: Array<{ index: number; title: string; error: string }>;
}

export interface MaterializerDeps {
  github: GitHubService;
  store: ThinkubeStore;
  output: vscode.OutputChannel;
}

const READY_STATUS = "Ready";

export class TasksMaterializer {
  constructor(private readonly deps: MaterializerDeps) {}

  /**
   * Walks the spec's tasks file and materialises every unchecked row.
   * Returns a structured result; throws only for setup failures (settings
   * missing, parent spec unfetchable) where there's nothing to do.
   */
  async materialize(opts: MaterializerOptions): Promise<MaterializeResult> {
    const { github, store, output } = this.deps;
    const coords = readRepoCoords();
    if (!coords) {
      throw new Error("Materialise tasks: `thinkube.kanban.repo` is not set.");
    }
    const projectNumber = vscode.workspace
      .getConfiguration("thinkube.kanban")
      .get<number>("projectNumber", 0);

    const relativePath = store.pathForTasks(opts.specIssueNumber);
    const parsed = await store.getFile(relativePath);
    if (!parsed) {
      throw new Error(
        `Materialise tasks: file not found at .thinkube/${relativePath}`,
      );
    }
    const sourceText = parsed.raw;
    const { tasks } = parseTasksFile(sourceText);
    const pending = tasks.filter((t) => !t.checked);
    if (pending.length === 0) {
      output.appendLine(
        `[materialize] ${relativePath}: no unchecked tasks; nothing to do`,
      );
      return { relativePath, created: [], skipped: [], failed: [] };
    }

    const spec = await github.getIssue(coords, opts.specIssueNumber);

    // Optional project-side state — only resolved when projectNumber > 0.
    let project:
      | {
          id: string;
          fieldId: string;
          readyOptionId: string;
        }
      | undefined;
    if (projectNumber > 0) {
      try {
        const info = await github.getProject(coords.owner, projectNumber);
        const ready = info.statusField?.options.find(
          (o) => o.name === READY_STATUS,
        );
        if (info.statusField && ready) {
          project = {
            id: info.id,
            fieldId: info.statusField.id,
            readyOptionId: ready.id,
          };
        } else {
          output.appendLine(
            `[materialize] project ${projectNumber} has no Status field with a Ready option — items will be created without kanban placement`,
          );
        }
      } catch (err) {
        output.appendLine(
          `[materialize] project lookup failed (${(err as Error).message}); items will be created without kanban placement`,
        );
      }
    }

    const result: MaterializeResult = {
      relativePath,
      created: [],
      skipped: [],
      failed: [],
    };

    for (const task of pending) {
      try {
        const issue = await this.createOne(coords, spec, task);
        if (project) {
          try {
            const { itemId } = await github.addItemToProject(
              project.id,
              issue.nodeId,
            );
            await github.setStatus(
              project.id,
              itemId,
              project.fieldId,
              project.readyOptionId,
            );
          } catch (projectErr) {
            // Issue was created — only the kanban placement failed.
            // Report as a partial success rather than a hard fail.
            output.appendLine(
              `[materialize]   #${issue.number}: created but kanban placement failed: ${(projectErr as Error).message}`,
            );
          }
        }
        result.created.push({ index: task.index, task: issue });
        output.appendLine(
          `[materialize]   #${issue.number} ← row ${task.index}: ${task.title}`,
        );
      } catch (err) {
        const message = (err as Error).message;
        result.failed.push({
          index: task.index,
          title: task.title,
          error: message,
        });
        output.appendLine(
          `[materialize]   ✖ row ${task.index} (${task.title}): ${message}`,
        );
      }
    }

    // Second pass: now that every row has a created issue number, write each
    // task's dependencies as issue refs (#N) instead of source-file row
    // indices (which are meaningless once the rows are issues).
    const rowToIssue = new Map<number, number>();
    for (const c of result.created) rowToIssue.set(c.index, c.task.number);
    for (const task of pending) {
      if (task.dependsOn.length === 0) continue;
      const issueNumber = rowToIssue.get(task.index);
      if (!issueNumber) continue;
      const depRefs = task.dependsOn
        .map((row) => rowToIssue.get(row))
        .filter((n): n is number => typeof n === "number");
      if (depRefs.length === 0) continue;
      try {
        await github.updateIssue(coords, issueNumber, {
          body: buildTaskBody(spec, task, depRefs),
        });
      } catch (err) {
        output.appendLine(
          `[materialize]   #${issueNumber}: failed to write dependency refs: ${(err as Error).message}`,
        );
      }
    }

    if (result.created.length > 0) {
      const updated = markMaterialized(
        sourceText,
        result.created.map((c) => c.index),
      );
      try {
        await store.writeFile(
          relativePath,
          parsed.frontmatter,
          stripFrontmatter(updated),
        );
      } catch (writeErr) {
        output.appendLine(
          `[materialize] WARN: failed to mark rows checked in ${relativePath}: ${(writeErr as Error).message}`,
        );
      }
    }

    output.appendLine(
      `[materialize] ${relativePath}: created=${result.created.length} failed=${result.failed.length}`,
    );
    return result;
  }

  private async createOne(
    coords: RepoCoords,
    spec: IssueSummary,
    task: ParsedTask,
  ): Promise<IssueSummary> {
    const { github } = this.deps;
    const issue = await github.createIssue(coords, {
      type: "task",
      title: task.title,
      body: buildTaskBody(spec, task),
      labels: task.parallel ? ["parallel-eligible"] : undefined,
    });
    try {
      await github.addSubIssue(spec.nodeId, issue.nodeId);
    } catch (linkErr) {
      // Non-fatal — the issue exists; the link can be installed by hand
      // or by the materialiser re-run after the user fixes whatever
      // blocked the addSubIssue mutation.
      this.deps.output.appendLine(
        `[materialize]   #${issue.number}: created but addSubIssue failed (${(linkErr as Error).message}); user can link manually`,
      );
    }
    return issue;
  }
}

/**
 * Build a Task issue body. Dependencies are written as **issue references**
 * (`#6`) when `depIssueRefs` is supplied — that mapping (decomposition row →
 * created issue number) only exists after all sibling issues are created, so
 * the materialiser writes the body without deps first and patches it in a
 * second pass via `updateIssue`. Row indices are an internal detail of the
 * tasks file and never leak into the issue body.
 */
function buildTaskBody(
  spec: IssueSummary,
  task: ParsedTask,
  depIssueRefs?: number[],
): string {
  const lines: string[] = [];
  if (task.description) {
    lines.push(task.description);
    lines.push("");
  }
  lines.push(`Parent spec: #${spec.number} ${spec.title}`);
  if (task.parallel) {
    lines.push("");
    lines.push(
      "Parallel-eligible: this task can run concurrently with siblings.",
    );
  }
  if (depIssueRefs && depIssueRefs.length > 0) {
    lines.push("");
    lines.push(`Depends on: ${depIssueRefs.map((n) => `#${n}`).join(", ")}`);
  }
  return lines.join("\n");
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

/**
 * `ThinkubeStore.writeFile` re-serialises frontmatter from the second arg
 * and concatenates the body. The `markMaterialized` output still has the
 * original frontmatter block in it; strip that so we don't double-write it.
 */
function stripFrontmatter(text: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  if (!match) return text;
  return text.slice(match[0].length);
}
