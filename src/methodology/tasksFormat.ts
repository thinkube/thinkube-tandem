/**
 * Thinkube tasks-list format — parser + idempotent serialiser.
 *
 * Format (lives at `.thinkube/specs/SP-{n}-tasks.md`):
 *
 *   ---
 *   kind: task-decomposition
 *   issue: 50
 *   parent_issue: 50
 *   repo: owner/name
 *   ---
 *
 *   # Tasks for SP-50
 *
 *   - [ ] Wire OAuth callback handler — accept code+state, exchange for tokens
 *   - [ ] (P) Add Redis session store
 *   - [ ] (P) Add token refresh job
 *   - [ ] Persist session id in cookie → depends-on: 1
 *   - [x] End-to-end happy-path test
 *
 * Lines:
 *   - Plain GitHub-flavored markdown checkboxes, one task per line.
 *   - Checkbox state doubles as "materialised" marker: `[ ]` = pending,
 *     `[x]` = already materialised (or completed). The materialiser flips
 *     `[ ]` → `[x]` after creating each task, which makes re-runs of
 *     `materializeTasks` idempotent — the parser skips already-checked rows.
 *   - Optional `(P)` prefix after the checkbox marks the task as
 *     parallel-eligible with its siblings. We propagate that as a
 *     `parallel-eligible` label on the GitHub Task issue.
 *   - Optional `→ depends-on: <index>` annotation at end of line references
 *     another task's 1-based position in the file. Useful documentation;
 *     for chunk 9 we record it in the issue body but don't enforce
 *     ordering at create time.
 *   - Inline description separator is the em-dash + space (` — `). Anything
 *     after the em-dash up to the depends-on annotation is the description.
 *
 * The parser is line-based and prose-tolerant — non-checkbox lines (headings,
 * blank lines, comments) are preserved verbatim by the serialiser.
 */

export interface ParsedTask {
  /** 1-based index of this task within the file. Stable across re-runs. */
  index: number;
  title: string;
  description: string | undefined;
  /** `(P)` flag — parallel-eligible with siblings. */
  parallel: boolean;
  /** Indexes referenced via `→ depends-on: N` (possibly multiple). */
  dependsOn: number[];
  /** True if the checkbox is `[x]` / `[X]` — treated as "already done". */
  checked: boolean;
  /** 0-based line number in the source file (for editor "go to" links). */
  lineNumber: number;
}

export interface ParsedTasksFile {
  tasks: ParsedTask[];
}

const TASK_RE = /^(\s*[-*]\s*)\[([ xX])\]\s+(.*)$/;
const DEPENDS_RE = /→\s*depends-on:\s*([0-9, ]+)/i;
const PARALLEL_RE = /^\(P\)\s+/i;

export function parseTasksFile(text: string): ParsedTasksFile {
  const lines = text.split(/\r?\n/);
  const tasks: ParsedTask[] = [];
  let index = 0;
  for (let i = 0; i < lines.length; i++) {
    const match = TASK_RE.exec(lines[i]);
    if (!match) continue;
    index += 1;
    const [, , box, rest] = match;
    let body = rest.trim();

    const dependsMatch = DEPENDS_RE.exec(body);
    let dependsOn: number[] = [];
    if (dependsMatch) {
      dependsOn = dependsMatch[1]
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
      body = body.replace(DEPENDS_RE, "").trim();
    }

    const parallel = PARALLEL_RE.test(body);
    if (parallel) body = body.replace(PARALLEL_RE, "");

    let title = body;
    let description: string | undefined;
    // Inline description separator: em-dash + space, or `--` as ascii fallback.
    const sepIdx = body.search(/\s—\s|\s--\s/);
    if (sepIdx >= 0) {
      title = body.slice(0, sepIdx).trim();
      description = body
        .slice(sepIdx)
        .replace(/^\s—\s|\s--\s/, "")
        .trim();
      if (!description) description = undefined;
    }

    tasks.push({
      index,
      title,
      description,
      parallel,
      dependsOn,
      checked: box.toLowerCase() === "x",
      lineNumber: i,
    });
  }
  return { tasks };
}

/**
 * Flip `[ ]` to `[x]` on the given 1-based task indexes. Lines that don't
 * match the task pattern (or that are already checked) are left untouched.
 * Used after `TasksMaterializer.materialize` to record that those rows have
 * been turned into GitHub issues — a subsequent `materializeTasks` run on
 * the same file is then a no-op for already-handled rows.
 */
export function markMaterialized(text: string, indexes: number[]): string {
  const set = new Set(indexes);
  const { tasks } = parseTasksFile(text);
  const lines = text.split(/\r?\n/);
  for (const task of tasks) {
    if (!set.has(task.index)) continue;
    if (task.checked) continue;
    // Targeted replacement on this single line so we don't touch
    // anything else (whitespace, prose, frontmatter).
    const line = lines[task.lineNumber];
    lines[task.lineNumber] = line.replace(/\[\s\]/, "[x]");
  }
  return lines.join("\n");
}
