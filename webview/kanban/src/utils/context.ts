/**
 * Global board state, mirroring the upstream's GlobalContext shape so the
 * vendored components work unchanged — but `setState` pushes to the host
 * (GitHub-backed adapter) instead of the upstream's Memento.
 */
import { createContext, useContext } from "react";
import { Board } from "../types";

export interface ContextType {
  state: Board;
  /** Apply a new board locally and persist it through the host. */
  setState: (state: Board) => void;
}

export const GlobalContext = createContext<ContextType>({} as ContextType);

export const useGlobalState = (): ContextType => useContext(GlobalContext);
