/**
 * Board shell — vendored from the upstream (DragDropContext + header + column
 * list), minus the drawer / theme switcher / fork-me / toasts. Columns are the
 * fixed methodology workflow, so only tasks drag.
 */
import { useState } from "react";
import { DragDropContext, DropResult } from "@hello-pangea/dnd";
import styles from "./board.module.scss";
import { ColumnList } from "./column-list";
import { GraphView } from "./graph";
import { useGlobalState } from "../utils/context";
import { handleDragEnd } from "../utils/drag";
import { ModeFlag } from "../types";

export function Board({ mode }: { mode: ModeFlag }): JSX.Element {
  const { state, setState } = useGlobalState();
  const [view, setView] = useState<"board" | "graph">("board");
  const onDragEnd = (result: DropResult) =>
    handleDragEnd(result, state, setState);
  const inner = (
    <div className={styles.board}>
      <header className={styles.header}>
        <div>
          <h1 style={{ margin: 0 }}>
            {state.title || state.scope || "Thinkube Kanban"}
          </h1>
          {state.subtitle && (
            <div
              style={{
                fontSize: "0.7em",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                opacity: 0.65,
              }}
            >
              {state.subtitle}
            </div>
          )}
        </div>
        <span className="grow" />
        <button
          type="button"
          onClick={() => setView(view === "board" ? "graph" : "board")}
          style={{ marginRight: 12, cursor: "pointer" }}
          title="Toggle the board / control-center graph"
        >
          {view === "board" ? "Graph" : "Board"}
        </button>
        <ModeBadge mode={mode} />
      </header>
      <main className={styles.main}>
        {view === "graph" ? (
          <GraphView />
        ) : (
          <ColumnList columns={state.columns} />
        )}
      </main>
    </div>
  );
  // The graph is static; only the board's columns need the drag context.
  return view === "graph" ? (
    inner
  ) : (
    <DragDropContext onDragEnd={onDragEnd}>{inner}</DragDropContext>
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
