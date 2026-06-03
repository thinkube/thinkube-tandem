/**
 * Task card — vendored chrome from the upstream (hover-reveal header buttons,
 * markdown body, inline edit), adapted to our GitHub-backed model: shows the
 * issue # + title + body, and edits write the issue (title+body) via the host
 * `update-task` message rather than the upstream's Memento `setState`.
 */
import { useState } from "react";
import { Draggable } from "@hello-pangea/dnd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Pencil, ExternalLink, Check, X, Link2 } from "lucide-react";
import styles from "./task.module.scss";
import { lookupPalette } from "../../utils/palette";
import { postToHost } from "../../utils/vscode";
import { useSelection } from "../../utils/selection";
import { TaskCard } from "../../types";

export function Task({
  task,
  index,
}: {
  task: TaskCard;
  index: number;
}): JSX.Element {
  const palette = lookupPalette(task.colorSlug);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.description);
  const [body, setBody] = useState(task.body ?? "");
  const [due, setDue] = useState(task.dueDate ?? "");
  const canEdit = task.issueNumber !== undefined;
  const isInboxCard = task.columnId === "column-inbox";
  const { selected, toggle } = useSelection();

  const startEdit = () => {
    setTitle(task.description);
    setBody(task.body ?? "");
    setDue(task.dueDate ?? "");
    setEditing(true);
  };
  const changeDue = (value: string) => {
    setDue(value);
    if (task.issueNumber !== undefined) {
      postToHost({
        kind: "set-due",
        number: task.issueNumber,
        date: value || null,
      });
    }
  };
  const save = () => {
    setEditing(false);
    if (task.issueNumber === undefined) return;
    const t = title.trim();
    const titleChanged = t && t !== task.description;
    const bodyChanged = body !== (task.body ?? "");
    if (!titleChanged && !bodyChanged) return;
    postToHost({
      kind: "update-task",
      number: task.issueNumber,
      ...(titleChanged ? { title: t } : {}),
      ...(bodyChanged ? { body } : {}),
    });
  };

  return (
    <Draggable draggableId={task.id} index={index} isDragDisabled={editing}>
      {(provided) => (
        <li
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`${styles.task}${editing ? " " + styles.active : ""}`}
          style={{
            ...provided.draggableProps.style,
            ["--accent" as string]: palette.accent,
          }}
        >
          <header className={styles.header}>
            {isInboxCard && (
              <input
                type="checkbox"
                className={styles.selectBox}
                checked={selected.includes(task.id)}
                title="Select to group into a Spec/Story/Epic"
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggle(task.id)}
              />
            )}
            {task.parentNumber !== undefined && (
              <span
                className={styles.epic}
                title={`Parent spec #${task.parentNumber}`}
              >
                SP-{task.parentNumber}
              </span>
            )}
            {task.issueNumber !== undefined && (
              <span className={styles.issue}>#{task.issueNumber}</span>
            )}
            {task.priority && (
              <span
                className={styles.priority}
                data-level={task.priority}
                title={`Priority ${task.priority}`}
              >
                {task.priority}
              </span>
            )}
            <span className="grow" />
            {canEdit && !editing && (
              <>
                <button title="Edit title & body" onClick={startEdit}>
                  <Pencil />
                </button>
                <button
                  title={
                    task.parentNumber
                      ? "Re-attach under a Spec"
                      : "Attach under a Spec (place in hierarchy)"
                  }
                  onClick={() =>
                    postToHost({
                      kind: "set-parent",
                      number: task.issueNumber!,
                    })
                  }
                >
                  <Link2 />
                </button>
                <button
                  title="Open issue on GitHub"
                  onClick={() =>
                    postToHost({
                      kind: "open-detail",
                      number: task.issueNumber!,
                    })
                  }
                >
                  <ExternalLink />
                </button>
              </>
            )}
            {editing && (
              <>
                <button title="Save" onClick={save}>
                  <Check />
                </button>
                <button title="Cancel" onClick={() => setEditing(false)}>
                  <X />
                </button>
              </>
            )}
          </header>

          {editing ? (
            <div>
              <input
                className={styles.titleInput}
                value={title}
                autoFocus
                placeholder="Title"
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditing(false);
                }}
              />
              <textarea
                className={styles.textarea}
                value={body}
                rows={5}
                placeholder="Body (markdown)…"
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
                  if (e.key === "Escape") setEditing(false);
                }}
              />
              <div className={styles.dateRow}>
                <label>Due</label>
                <input
                  type="date"
                  className={styles.dateInput}
                  value={due}
                  onChange={(e) => changeDue(e.target.value)}
                />
                {due && (
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => changeDue("")}
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className={styles.editRow}>
                <button onClick={save}>Save</button>
                <button
                  className={styles.secondary}
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>
                <span className={styles.hint}>⌘/Ctrl+Enter</span>
              </div>
            </div>
          ) : (
            <div onDoubleClick={canEdit ? startEdit : undefined}>
              <div className={styles.title}>
                {task.description || "(untitled)"}
              </div>
              {task.specStale &&
                (() => {
                  const note = staleNote(task.columnId);
                  return (
                    <div
                      className={`${styles.stale}${note.muted ? " " + styles.staleMuted : ""}`}
                      title="The parent spec changed after this task"
                    >
                      {note.text}
                    </div>
                  );
                })()}
              {dependsOn(task.body).length > 0 && (
                <div className={styles.deps} title="Blocked by these issues">
                  ⛔ blocked by{" "}
                  {dependsOn(task.body)
                    .map((n) => `#${n}`)
                    .join(", ")}
                </div>
              )}
              {bodyWithoutDeps(task.body).trim() && (
                <div className={styles.body}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {bodyWithoutDeps(task.body)}
                  </ReactMarkdown>
                </div>
              )}
              {task.dueDate && (
                <div
                  className={`${styles.due}${isOverdue(task.dueDate) ? " " + styles.overdue : ""}`}
                  title={isOverdue(task.dueDate) ? "Overdue" : "Due date"}
                >
                  📅 due {task.dueDate}
                </div>
              )}
            </div>
          )}

          {task.updatedAt && !editing && (
            <div className={styles.time} title={task.updatedAt}>
              updated {relativeTime(task.updatedAt)}
            </div>
          )}
        </li>
      )}
    </Draggable>
  );
}

const DEPS_LINE = /depends on|blocked by/i;

/** Status-aware staleness message: the right reaction depends on the column. */
function staleNote(columnId: string): { text: string; muted?: boolean } {
  switch (columnId) {
    case "column-in-progress":
      return { text: "⚠ spec changed mid-work" };
    case "column-review":
    case "column-verify":
      return { text: "⚠ spec changed — re-verify" };
    case "column-done":
      return { text: "spec changed since done — follow-up?", muted: true };
    default: // spec / ready — not started
      return { text: "⚠ spec changed — review" };
  }
}

/** True if an ISO due date (yyyy-mm-dd) is before today. */
function isOverdue(due: string): boolean {
  const d = Date.parse(due);
  if (Number.isNaN(d)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today.getTime();
}

/** Extract issue numbers from a "Depends on: #6, #7" / "blocked by #6" line. */
function dependsOn(body: string | undefined): number[] {
  if (!body) return [];
  const line = body.split(/\r?\n/).find((l) => DEPS_LINE.test(l));
  if (!line) return [];
  return Array.from(line.matchAll(/#(\d+)/g)).map((m) => Number(m[1]));
}

/** Body with the dependency line removed (it's shown as the ⛔ badge instead). */
function bodyWithoutDeps(body: string | undefined): string {
  if (!body) return "";
  return body
    .split(/\r?\n/)
    .filter((l) => !DEPS_LINE.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  const units: Array<[string, number]> = [
    ["y", 31536000],
    ["mo", 2592000],
    ["d", 86400],
    ["h", 3600],
    ["m", 60],
  ];
  for (const [label, size] of units) {
    if (secs >= size) return `${Math.floor(secs / size)}${label} ago`;
  }
  return "just now";
}
