---
description: Surface the current kanban state in chat (read-only snapshot). Tells the user how to open the interactive panel.
allowed-tools: ["mcp__thinkube-kanban__list_board"]
argument-hint: "(no args)"
thinkube-bundle: 0.0.1
---

# /board

Show a text snapshot of the current kanban: items grouped by Status column. Use this to get a quick read on what's in flight without leaving the chat. For the interactive board (drag-and-drop, card detail), tell the user to open the VS Code panel.

## Mission

A compact chat-readable view of the project's current state, plus a pointer to the interactive panel.

## Procedure

1. **Snapshot.** Call `mcp__thinkube-kanban__list_board`. The tool returns items grouped by Status.
2. **Format.** Render as a table with one column per Status (in methodology order: Spec, Ready, In Progress, Review, Verify, Done). Each cell lists `#<num> <title>` rows. Truncate titles past ~50 chars.
3. **Highlight.** If any Task in Review has no comments, flag it (it would block the chunk-11 In-Progress→Review gate when re-checked).
4. **Point at the interactive panel.** Tell the user: "Activity Bar → Thinkube Board → toolbar **Open Kanban**", or Command Palette → **Thinkube Kanban: Open Kanban**.

## Constraints

- Read-only. Don't move cards here — that's `/pair-next` and direct UI manipulation.
- Don't dump the full JSON. Format for human eyes.

## Output

```
📋 Board: <owner/repo> · project #<n>

   Spec        Ready       In Progress   Review      Verify      Done
   #141 Auth   #142 Wire   #143 Stripe   #144 PR     #145 QA     #146 Old
   …           #150 Cache  …              #148 Diff   …           …
   (2)         (4)         (1)           (2)         (1)         (12)

▶ Open the interactive board: Activity Bar → Thinkube Board → "Open Kanban".
```

## Safety / fallback

- **No project configured** (`thinkube.kanban.projectNumber = 0`). Tell the user to run **Thinkube Kanban: Configure Project** so the board has columns to read.
- **Token lacks `project` scope.** Surface the underlying API error verbatim.
