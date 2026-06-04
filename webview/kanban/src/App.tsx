/**
 * Webview root. Sources the board from the host on mount, provides it through
 * the (vendored-shape) GlobalContext, and persists local mutations back to the
 * host.
 */
import { useEffect, useState } from "react";
import { Board as BoardComponent } from "./components/board";
import { GlobalContext } from "./utils/context";
import { onHostMessage, postToHost } from "./utils/vscode";
import { Board, ModeFlag } from "./types";

const EMPTY_BOARD: Board = { columns: [], tasks: {}, scope: "" };

export function App(): JSX.Element {
  const [board, setBoard] = useState<Board>(EMPTY_BOARD);
  const [mode, setMode] = useState<ModeFlag>("both");

  useEffect(() => {
    const unsubscribe = onHostMessage((msg) => {
      if (msg.kind === "state" || msg.kind === "external-change") {
        setBoard(msg.board);
        setMode(msg.mode);
      }
    });
    postToHost({ kind: "load" });
    return unsubscribe;
  }, []);

  const setState = (next: Board) => {
    setBoard(next);
    postToHost({ kind: "save", board: next });
  };

  return (
    <GlobalContext.Provider value={{ state: board, setState }}>
      <BoardComponent mode={mode} />
    </GlobalContext.Provider>
  );
}
