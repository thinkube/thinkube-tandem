/**
 * Board shell — vendored from the upstream (DragDropContext + header + column
 * list), minus the drawer / theme switcher / fork-me / toasts. Columns are the
 * fixed methodology workflow, so only tasks drag.
 */
import { DragDropContext, DropResult } from "@hello-pangea/dnd";
import styles from "./board.module.scss";
import { ColumnList } from "./column-list";
import { useGlobalState } from "../utils/context";
import { handleDragEnd } from "../utils/drag";
import { ModeFlag } from "../types";

export function Board({ mode }: { mode: ModeFlag }): JSX.Element {
  const { state, setState } = useGlobalState();
  const onDragEnd = (result: DropResult) =>
    handleDragEnd(result, state, setState);
  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className={styles.board}>
        <header className={styles.header}>
          <h1>{state.scope || "Thinkube Kanban"}</h1>
          <span className="grow" />
          <ModeBadge mode={mode} />
        </header>
        <main className={styles.main}>
          <ColumnList columns={state.columns} />
        </main>
      </div>
    </DragDropContext>
  );
}

function ModeBadge({ mode }: { mode: ModeFlag }): JSX.Element {
  const tip =
    mode === "navigator"
      ? "Navigator — AI reads & proposes, can't write the board."
      : mode === "driver"
        ? "Driver — AI is driving; both can write."
        : "Both — either party can write (default).";
  return (
    <span className={`mode-badge mode-${mode}`} title={tip}>
      {mode.toUpperCase()}
    </span>
  );
}
