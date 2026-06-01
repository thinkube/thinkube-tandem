/**
 * Multi-select state for Inbox cards, used to promote a set of loose issues
 * into a new parent (Epic/Story/Spec). Kept in context so cards can toggle
 * their own checkbox without prop-drilling through the column tree.
 */
import { createContext, useContext } from "react";

export interface SelectionCtx {
  selected: string[];
  toggle: (id: string) => void;
  clear: () => void;
}

export const SelectionContext = createContext<SelectionCtx>({
  selected: [],
  toggle: () => {},
  clear: () => {},
});

export const useSelection = (): SelectionCtx => useContext(SelectionContext);
