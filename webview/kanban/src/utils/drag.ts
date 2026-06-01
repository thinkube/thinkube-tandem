/**
 * Drag handling — task moves only (the methodology columns are fixed, so no
 * column reordering). Moving a card between columns changes its Status; moving
 * within a column reorders it. Either way we hand the new board to `setState`,
 * which the host persists (status sync today; priority order later).
 */
import type { DropResult } from "@hello-pangea/dnd";
import type { Board } from "../types";

export function handleDragEnd(
  result: DropResult,
  state: Board,
  setState: (state: Board) => void,
): void {
  const { source, destination } = result;
  if (!destination) return;
  if (
    destination.droppableId === source.droppableId &&
    destination.index === source.index
  ) {
    return;
  }

  const columns = state.columns.map((c) => ({
    ...c,
    tasksIds: [...c.tasksIds],
  }));
  const sourceCol = columns.find((c) => c.id === source.droppableId);
  const destCol = columns.find((c) => c.id === destination.droppableId);
  if (!sourceCol || !destCol) return;

  const [taskId] = sourceCol.tasksIds.splice(source.index, 1);
  if (!taskId) return;
  destCol.tasksIds.splice(destination.index, 0, taskId);

  const tasks = {
    ...state.tasks,
    [taskId]: { ...state.tasks[taskId], columnId: destCol.id },
  };
  setState({ ...state, columns, tasks });
}
