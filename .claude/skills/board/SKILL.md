---
description: Surface the current board state in chat (read-only snapshot). Tells the user how to open the interactive panel.
allowed-tools: ["mcp__thinkube-kanban__list_board"]
argument-hint: "(no args)"
thinkube-bundle: 0.0.1
---

# /board

Show a text snapshot of the current board: slices grouped by column, read straight from slice frontmatter. Use this for a quick read on what's in flight without leaving the chat. For the interactive board (drag-and-drop, card detail), tell the user to open the VS Code panel.

## Mission

A compact chat-readable view of the project's current state, plus a pointer to the interactive panel.

## Procedure

1. **Snapshot.** Call `mcp__thinkube-kanban__list_board`. It returns cards grouped into **Ready / Doing / Done** (read from each slice's `status:` frontmatter); each card carries its handle (`id`, e.g. `SP-3_SL-42`), `title`, `specStale`, and `specChange`.
2. **Format.** Render as a table with one column per status (**Ready, Doing, Done** — three columns, in that order). Each cell lists `SP-{n}_SL-{m} <title>` rows. Truncate titles past ~50 chars.
3. **Highlight staleness.** Flag any **done** card with `specChange: "requirements"` — its parent Spec's requirement sections changed since it was verified, so it needs re-verification (a `/pair-next` sweep). Ignore `metadata`-only staleness.
4. **Point at the interactive panel.** Tell the user: Activity Bar → **Thinkube** → **Boards** → click this repo to open its board (or Command Palette → **Thinkube Kanban: Open Kanban** for the configured root).

## Constraints

- Read-only. Don't move cards here — that's `/pair-next` and direct UI manipulation.
- Don't dump the full JSON. Format for human eyes.

## Output

```
📋 Board: <owner/repo>

   Ready              Doing             Done
   SP-3_SL-4 Wire     SP-3_SL-3 Stripe  SP-3_SL-1 Old
   SP-3_SL-5 Cache    …                 SP-3_SL-2 Diff ⚠ stale
   (4)                (1)               (12)

▶ Open the interactive board: Activity Bar → Thinkube → Boards → click this repo.
```

## Safety / fallback

- **No board for this Thinking Space.** A Space is methodology-enabled only if its namespace dir exists in the sidecar board repo (via `thinkube.boards.root`). If `list_board` returns nothing, tell the user this Space isn't methodology-enabled yet (author a Spec via `/spec-prepare`, then `/slice`).
- **MCP error.** Surface the underlying error verbatim.
