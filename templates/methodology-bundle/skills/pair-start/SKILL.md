---
description: Begin a pair-programming session on a Spec. Loads context (Spec body, Ready slices), surfaces the next slice to work, flags stale slices.
allowed-tools:
  [
    "Read",
    "Glob",
    "Grep",
    "mcp__thinkube-kanban__list_board",
    "mcp__thinkube-kanban__get_slice",
    "mcp__thinkube-kanban__get_thinkube_file",
    "Task",
  ]
argument-hint: "<spec-number>"
thinkube-bundle: 0.0.1
---

# /pair-start

Start a pair-programming session on a specific **Spec**. Loads everything Claude needs to work effectively: the Spec body with its acceptance criteria, and all Ready slices under it. Recommends the next slice to pull. Surfaces the navigator/driver mode.

## Mission

After `/pair-start <spec-number>`, the conversation context should contain:

- The Spec title + body + acceptance criteria, already parsed, for situational awareness.
- A clear pick of the next Ready slice with rationale (top of column, dependencies satisfied).
- Any **substantively-stale** done slices flagged up front (parent Spec's requirements changed since they were verified), so they're re-verified before new work.
- An explicit acknowledgment of the current mode (`navigator` / `driver` / `both`) and what that means for Claude's write authority this session.

## Inputs

- `$ARGUMENTS`: the Spec number `{n}`. If absent, list Specs that have Ready slices (from `list_board`) and ask the user to pick.

## Procedure

1. **Read methodology context** + `repo-conventions` (load both into session if not already).
2. **Load the Spec.** `get_thinkube_file specs/SP-{n}/spec.md` — surface its acceptance criteria.
3. **Load the board.** `mcp__thinkube-kanban__list_board` returns cards grouped Ready / Doing / Done; each card carries its handle (`id`, e.g. `SP-{n}_SL-3`), title, `specStale`, and `specChange`. Filter to cards whose `parent` is `SP-{n}`. Read individual slice bodies with `get_slice { slice: "SP-{n}_SL-{m}" }` as needed.
4. **Pick the next slice.** Apply this priority:
   1. A slice already in **Doing** under this Spec (resume in-flight work first — keep one slice in flight per Spec).
   2. Top of **Ready** with its `depends_on` already Done.
5. **Surface the picked slice.** Show: handle, title, the AC line(s) it satisfies, dependencies satisfied or pending.
6. **Flag stale slices.** If any **done** slice under this Spec has `specChange: "requirements"` — its parent Spec's `## Acceptance Criteria` / `## Design` / `## Constraints` changed since it was verified — surface it prominently: it needs re-verification (handled by `/pair-next`'s stale-spec sweep) before new work proceeds. Ignore `metadata`-only staleness (status/priority/checkbox-toggle — not a real change).
7. **State the mode.** Echo the current `thinkube.kanban.mode` value and what it means:
   - `navigator`: Claude reads + proposes; cannot write the board.
   - `driver`: Claude is leading; will move cards, edit files, push.
   - `both`: either side can write.
8. **Tell the user** to open the board from the Activity Bar (**Thinkube** → **Boards** → click this repo), or via the command palette (**Thinkube Kanban: Open Kanban**), so they can see drag-and-drop reflect the work.
9. **Wait.** Don't auto-move the picked slice to Doing. That's `/pair-next`'s job, and the user may want to revise the pick first.

## Constraints

- Don't write code yet. This skill is **setup** — code-writing starts after the user confirms the pick and we transition into the pair-programming loop via `/pair-next`.
- Don't create new slices here — if the user wants more work surfaced, route through `/slice` for this Spec.
- If the Spec has no slices at all, **stop** and tell the user to run `/slice {n}` first. If the Spec itself has no acceptance criteria, route to `/spec-prepare {n}`.

## Output

A briefing in chat:

```
🎯 Session: SP-{n} <spec title>

🗒 Acceptance Criteria: 2/4 checked

📋 Board for SP-{n}:
   Ready: 5    Doing: 1    Done: 4

▶ Next pick: SP-{n}_SL-3 — <title>
   satisfies: AC #2 ("Endpoint returns 401 when token expired")
   blocked by: none

⚠ Stale (re-verify before new work): SP-{n}_SL-1 — Spec requirements changed since it was verified

Mode: DRIVER — Claude can move cards and edit files.

Run /pair-next to take this slice; reply with a different slice handle to pick another.
```

## Safety / fallback

- **Spec has no Ready slices.** Surface this. Suggest `/slice {n}` if the Spec hasn't been sliced yet.
- **Acceptance criteria not all parseable.** Carry on but note in the briefing that the Spec's AC section looks malformed; the → Ready gate will surface the actual blocker when a slice tries to advance.
- **Navigator mode + user expects driving.** If `mode === "navigator"`, remind the user that moves on the board must come from them — Claude can propose moves but the MCP server will refuse them.
