import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.scss";

const container = document.getElementById("root");
if (!container) {
  throw new Error("kanban: #root element missing");
}
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
