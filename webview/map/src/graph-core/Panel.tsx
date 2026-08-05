/**
 * The node-anchored panel: the one overlay primitive for a selected node's
 * detail surface. Rendered in HTML beside the canvas, anchored to the right,
 * so text stays crisp at any zoom.
 */
import { ReactNode } from "react";

export function Panel(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <div
      data-graph-panel
      style={{
        position: "absolute",
        top: 10,
        right: 10,
        width: 340,
        maxHeight: "calc(100% - 20px)",
        overflowY: "auto",
        background: "var(--vscode-editorWidget-background, #222)",
        border: "1px solid var(--vscode-panel-border, #444)",
        borderRadius: 8,
        padding: "10px 12px",
        fontSize: 12,
        color: "var(--vscode-foreground, #ddd)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <strong style={{ flex: 1 }}>{props.title}</strong>
        <button
          onClick={props.onClose}
          title="Close"
          style={{
            border: "none",
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          ×
        </button>
      </div>
      {props.children}
    </div>
  );
}
