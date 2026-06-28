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
import {
  Pencil,
  ExternalLink,
  Check,
  X,
  GitCommit,
  GitPullRequest,
} from "lucide-react";
import styles from "./task.module.scss";
import { lookupPalette } from "../../utils/palette";
import { postToHost } from "../../utils/vscode";
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
  // Optimistic accept: the accept action is a multi-second async (PR merge +
  // worktree retire + fast-forward) before the host reloads and the card flips
  // to "Approved & closed". Flip the button to a disabled "Approving…" the
  // instant it's pressed so it can't be fired twice in that window.
  const [accepting, setAccepting] = useState(false);
  const canEdit = task.id !== undefined;
  // The card id IS the handle SP-{n}_SL-{m}; surface the slice number as its own
  // chip (the spec is already shown by the SP- chip).
  const sliceNo = /_SL-(\d+)$/.exec(task.id)?.[1];
  // Priority is a mandatory slice attribute — always render a chip; P2 (normal)
  // stands in for any slice that predates the default.
  const priority = task.priority ?? "P2";

  const startEdit = () => {
    setTitle(task.description);
    setBody(task.body ?? "");
    setDue(task.dueDate ?? "");
    setEditing(true);
  };
  const changeDue = (value: string) => {
    setDue(value);
    if (task.id) {
      postToHost({
        kind: "set-due",
        id: task.id,
        date: value || null,
      });
    }
  };
  const save = () => {
    setEditing(false);
    if (!task.id) return;
    const t = title.trim();
    const titleChanged = t && t !== task.description;
    const bodyChanged = body !== (task.body ?? "");
    if (!titleChanged && !bodyChanged) return;
    postToHost({
      kind: "update-task",
      id: task.id,
      ...(titleChanged ? { title: t } : {}),
      ...(bodyChanged ? { body } : {}),
    });
  };

  // Spec-level close card (TEP-0010): not a slice — it summarises the whole
  // Spec. It shows the acceptance-criteria checklist (with each box's mark) and
  // slice progress so the human sees exactly what they're signing off, then
  // "Approve & close" — confirm the finished work, merge the Spec's one PR, and
  // close the Spec. Not hand-dragged (the gate, not a drag, moves it to Done);
  // an accepted Spec's card rests in Done as a record.
  if (task.isAcceptance) {
    const accepted = task.accepted ?? task.columnId === "column-done";
    const criteria = task.acceptanceCriteria ?? [];
    const checked = criteria.filter((c) => c.checked).length;
    const slicesDone = task.slicesDone ?? 0;
    const slicesTotal = task.slicesTotal ?? 0;
    return (
      <Draggable draggableId={task.id} index={index} isDragDisabled>
        {(provided) => (
          <li
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            className={`${styles.task} ${styles.accept}`}
            style={{
              ...provided.draggableProps.style,
              ["--accent" as string]: palette.accent,
            }}
          >
            <header className={styles.header}>
              {task.parentId !== undefined && (
                <span
                  className={styles.epic}
                  title={`Spec SP-${task.parentId}`}
                >
                  SP-{task.parentId}
                </span>
              )}
              <span className="grow" />
              <span className={styles.acceptTag}>
                {accepted ? "closed" : "sign-off"}
              </span>
            </header>
            <div className={styles.title}>Spec {task.description}</div>

            <div className={styles.acceptProgress}>
              <span title="Slices done / total">
                ◧ {slicesDone}/{slicesTotal} slices done
              </span>
              <span title="Acceptance criteria checked / total">
                ☑ {checked}/{criteria.length} criteria
              </span>
            </div>

            {criteria.length > 0 && (
              <ul className={styles.acceptChecklist}>
                {criteria.map((c, i) => (
                  <li
                    key={i}
                    className={c.checked ? styles.acDone : styles.acOpen}
                  >
                    <span className={styles.acBox}>
                      {c.checked ? "☑" : "☐"}
                    </span>
                    <span className={styles.acLabel}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {c.label}
                      </ReactMarkdown>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {accepted ? (
              <div className={styles.acceptDone}>
                <Check /> Approved &amp; closed
              </div>
            ) : (
              <div className={styles.acceptRow}>
                <button
                  type="button"
                  className={styles.acceptBtn}
                  disabled={!task.acceptReady || accepting}
                  title={
                    accepting
                      ? "Approving… (merging the PR and closing the Spec)"
                      : task.acceptReady
                        ? "Approve the finished implementation: merge the Spec's PR and close the Spec"
                        : "Enabled once every slice is Done and every acceptance criterion is checked"
                  }
                  onClick={() => {
                    if (task.parentId === undefined || accepting) return;
                    setAccepting(true);
                    postToHost({
                      kind: "accept-spec",
                      spec: task.parentId,
                    });
                  }}
                >
                  {accepting ? "Approving…" : "Approve & close"}
                </button>
                {!task.acceptReady && !accepting && (
                  <span className={styles.acceptHint}>
                    all slices Done + all criteria checked
                  </span>
                )}
              </div>
            )}
          </li>
        )}
      </Draggable>
    );
  }

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
            {task.parentId !== undefined && (
              <span
                className={styles.epic}
                title={`Parent spec SP-${task.parentId}`}
              >
                SP-{task.parentId}
              </span>
            )}
            {sliceNo && (
              <span className={styles.slice} title={`Slice ${task.id}`}>
                SL-{sliceNo}
              </span>
            )}
            <span
              className={styles.priority}
              data-level={priority}
              title={`Priority ${priority}`}
            >
              {priority}
            </span>
            <span className="grow" />
            {canEdit && !editing && (
              <>
                <button title="Edit title & body" onClick={startEdit}>
                  <Pencil />
                </button>
                <button
                  title="Open issue on GitHub"
                  onClick={() =>
                    postToHost({
                      kind: "open-detail",
                      id: task.id,
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
              {(task.commitUrl || task.commit || task.pr) && (
                <div className={styles.provenance}>
                  {(task.commitUrl || task.commit) && (
                    <button
                      type="button"
                      className={styles.provChip}
                      disabled={!task.commitUrl}
                      title={
                        task.commitUrl
                          ? `Open commit ${task.commit} on the remote`
                          : `Commit ${task.commit}`
                      }
                      onClick={() =>
                        task.commitUrl &&
                        postToHost({
                          kind: "open-external",
                          url: task.commitUrl,
                        })
                      }
                    >
                      <GitCommit /> {shortSha(task.commit)}
                    </button>
                  )}
                  {task.pr && (
                    <button
                      type="button"
                      className={styles.provChip}
                      title={`Open ${task.pr}`}
                      onClick={() =>
                        postToHost({ kind: "open-external", url: task.pr! })
                      }
                    >
                      <GitPullRequest /> {prLabel(task.pr)}
                    </button>
                  )}
                </div>
              )}
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

/** First 7 chars of a commit SHA for the chip label; falls back to "commit". */
function shortSha(sha: string | undefined): string {
  return sha ? sha.slice(0, 7) : "commit";
}

/** "PR #13" parsed from a pull-request URL, or a bare "PR" if no number. */
function prLabel(url: string): string {
  const m = /\/pull\/(\d+)/.exec(url);
  return m ? `PR #${m[1]}` : "PR";
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
