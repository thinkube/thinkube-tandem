# Upstream provenance

This subtree is the React-app side of the Thinkube methodology kanban.

The design — `BoardType`/`ColumnType`/`TaskType` data model, the `MessageType`
protocol over `webview.postMessage`, the column/task component breakdown, and
the `handleDragEnd` shape — is informed by:

- Repo: <https://github.com/mayank1513/vscode-extension-trello-kanban-board>
- SHA reference: `e126e50127ca406836996a009a3496de467b710f`
- License: MIT (Copyright (c) 2023 Mayank Kumar Chaudhari)

We **reuse the upstream's visual design** (card/column styling, markdown card
rendering, drag-and-drop feel) but **not its app or data model**. The files here are
authored fresh, because our model differs fundamentally: **fixed 6 methodology
columns** (not user-editable), **cards are GitHub-issue-backed**, and the board is a
**two-way PM editor** (move/edit/create/reorder/triage) synced to GitHub via the
`StorageAdapter` — see `docs/VISION.md`.

Reused: card/column visual language, **markdown rendering** (`react-markdown` +
`remark-gfm`, not the upstream's `@m2d/react-markdown`), `@hello-pangea/dnd` (the
maintained fork of `react-beautiful-dnd`), the discrete per-epic palette.

Intentionally **excluded** (gimmicks / wrong fit for a methodology board): the
free-HSL color picker, `nextjs-themes` theme switcher (we inherit VS Code's CSS
variables), `react-toastify` (the host shows VS Code notifications), and the
particle / webgl-trail effects. See `NOTICE.md` at the repo root for the full MIT
attribution.

When refreshing this vendoring (rare — the upstream is feature-stable), bump
the SHA reference above and note the deltas you carried over.
