/**
 * One column — vendored from the upstream, minus the column-level Draggable
 * (fixed workflow) and the rename/delete/colour affordances. The task stack is
 * a Droppable so cards drag between columns (status) and within (priority).
 * The upstream's "Add Task" is re-enabled as an inline new-card input that
 * creates a real GitHub issue via the host.
 */
import { useState } from "react";
import { Droppable } from "@hello-pangea/dnd";
import styles from "./column-list.module.scss";
import { ColumnHeader } from "./column-header";
import { Task } from "../task";
import { useGlobalState } from "../../utils/context";
import { postToHost } from "../../utils/vscode";
import { BoardColumn } from "../../types";

/** Per-status left/top accent (matches the methodology column order). */
const ACCENTS: Record<string, string> = {
  "column-inbox": "#d44e90",
  "column-spec": "#8a8a8a",
  "column-ready": "#3a8fd6",
  "column-in-progress": "#e0a020",
  "column-review": "#d4884e",
  "column-verify": "#a45fcf",
  "column-done": "#7cc440",
};

export function Column({ column }: { column: BoardColumn }): JSX.Element {
  const { state } = useGlobalState();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const accent = ACCENTS[column.id] ?? "var(--vscode-descriptionForeground)";
  const isInbox = column.id === "column-inbox";

  const submit = () => {
    const title = draft.trim();
    setAdding(false);
    setDraft("");
    if (title) postToHost({ kind: "create-task", columnId: column.id, title });
  };

  return (
    <div className={styles.columnContainer}>
      <Droppable droppableId={column.id} direction="vertical">
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={styles.columnDropzone}
          >
            <div
              className={styles.column}
              style={{ ["--accent" as string]: accent }}
            >
              <ColumnHeader
                title={column.title}
                count={column.tasksIds.length}
              />
              <ul className={styles.taskList}>
                {column.tasksIds.length === 0 &&
                  !snapshot.isDraggingOver &&
                  !adding && <li className={styles.empty}>Nothing here yet</li>}
                {column.tasksIds.map((taskId, index) => {
                  const task = state.tasks[taskId];
                  if (!task) return null;
                  return <Task key={taskId} task={task} index={index} />;
                })}
                {provided.placeholder}
              </ul>
              {!isInbox &&
                (adding ? (
                  <textarea
                    className={styles.textarea}
                    autoFocus
                    rows={2}
                    placeholder="New task title…"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={submit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        submit();
                      }
                      if (e.key === "Escape") {
                        setAdding(false);
                        setDraft("");
                      }
                    }}
                  />
                ) : (
                  <button
                    className={styles.addTask}
                    onClick={() => setAdding(true)}
                  >
                    + Add card
                  </button>
                ))}
            </div>
          </div>
        )}
      </Droppable>
    </div>
  );
}
