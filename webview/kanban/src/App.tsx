/**
 * Webview root. Sources the board from the host on mount, provides it through
 * the (vendored-shape) GlobalContext, and persists local mutations back to the
 * host. Also owns Inbox multi-select state + the grouping toolbar.
 */
import { useEffect, useState } from "react";
import { Board as BoardComponent } from "./components/board";
import { GlobalContext } from "./utils/context";
import { SelectionContext, useSelection } from "./utils/selection";
import { onHostMessage, postToHost } from "./utils/vscode";
import { Board, ModeFlag } from "./types";

const EMPTY_BOARD: Board = { columns: [], tasks: {}, scope: "" };

export function App(): JSX.Element {
  const [board, setBoard] = useState<Board>(EMPTY_BOARD);
  const [mode, setMode] = useState<ModeFlag>("both");
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    const unsubscribe = onHostMessage((msg) => {
      if (msg.kind === "state" || msg.kind === "external-change") {
        setBoard(msg.board);
        setMode(msg.mode);
        setSelected([]); // board changed — drop any stale selection
      }
    });
    postToHost({ kind: "load" });
    return unsubscribe;
  }, []);

  const setState = (next: Board) => {
    setBoard(next);
    postToHost({ kind: "save", board: next });
  };

  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  const clear = () => setSelected([]);

  return (
    <GlobalContext.Provider value={{ state: board, setState }}>
      <SelectionContext.Provider value={{ selected, toggle, clear }}>
        <BoardComponent mode={mode} />
        <SelectionBar />
      </SelectionContext.Provider>
    </GlobalContext.Provider>
  );
}

/** Floating bar shown when Inbox cards are selected — promote them to a parent. */
function SelectionBar(): JSX.Element | null {
  const { selected, clear } = useSelection();
  const inboxIds = selected.filter((id) => id.startsWith("inbox-"));
  if (inboxIds.length === 0) return null;
  const childNumbers = inboxIds.map((id) => Number(id.slice("inbox-".length)));
  const group = () => {
    postToHost({ kind: "group", childNumbers });
    clear();
  };
  return (
    <div className="selection-bar">
      <span>{inboxIds.length} selected</span>
      <button onClick={group}>Group into Epic ▸ Story ▸ Spec</button>
      <button className="ghost" onClick={clear}>
        Clear
      </button>
    </div>
  );
}
