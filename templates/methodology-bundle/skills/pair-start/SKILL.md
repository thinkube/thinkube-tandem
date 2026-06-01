---
description: Begin a pair-programming session on a Story. Loads context (Story, Specs, Ready tasks), surfaces the next task to work, opens the Kanban panel.
allowed-tools:
  [
    "Read",
    "Glob",
    "Grep",
    "mcp__thinkube-kanban__list_stories_in_epic",
    "mcp__thinkube-kanban__list_specs_in_story",
    "mcp__thinkube-kanban__list_tasks_in_spec",
    "mcp__thinkube-kanban__list_board",
    "mcp__thinkube-kanban__get_issue",
    "mcp__thinkube-kanban__get_thinkube_file",
    "Task",
  ]
argument-hint: "<story-number>"
thinkube-bundle: 0.0.1
---

# /pair-start

Start a pair-programming session on a specific Story. Loads everything Claude needs to work effectively: the Story body, all of its Specs with their acceptance criteria, all Ready Tasks under those Specs. Recommends the next Task to pull. Surfaces the navigator/driver mode.

## Mission

After `/pair-start <story-number>`, the conversation context should contain:

- The Story title + body + parent Epic for situational awareness.
- Every Spec under the Story with its acceptance criteria already parsed.
- A clear pick of the next Ready Task with rationale (top of column, dependencies satisfied, parallel-eligible vs. blocking).
- An explicit acknowledgment of the current mode (`navigator` / `driver` / `both`) and what that means for Claude's write authority in this session.

## Inputs

- `$ARGUMENTS`: the Story issue number. If absent, list open Stories and ask the user to pick.

## Procedure

1. **Read methodology context** + `repo-conventions` (load both into session if not already).
2. **Load Story + ancestry.** `mcp__thinkube-kanban__get_issue <story-number>`. Then `get_issue` on the parent Epic for the higher-level context.
3. **Load Specs.** `mcp__thinkube-kanban__list_specs_in_story <story-number>`. For each Spec, `mcp__thinkube-kanban__get_thinkube_file specs/SP-{n}.md` to surface acceptance criteria.
4. **Load board.** `mcp__thinkube-kanban__list_board` to see what's in Ready / In Progress / Review for this Story's tasks. Cross-reference with `list_tasks_in_spec` per spec.
5. **Pick next task.** Apply this priority:
   1. Tasks already In Progress under this Story (resume in-flight work first).
   2. Top of Ready under the Spec with the most unblocked dependencies.
   3. Parallel-eligible Tasks if multiple humans are available — surface that, don't pick for them.
6. **Surface the picked Task.** Show: title, parent Spec, the AC line(s) it satisfies, the dependencies satisfied or pending.
7. **State the mode.** Echo the current `thinkube.kanban.mode` value and what it means:
   - `navigator`: Claude reads + proposes; cannot write the board.
   - `driver`: Claude is leading; will move cards, edit files, push.
   - `both`: either side can write.
8. **Tell the user** to open the Kanban panel from the Activity Bar (`Thinkube Board` → `Roadmap`, toolbar button **Open Kanban**) or via the command palette so they can see drag-and-drop reflect the work.
9. **Wait.** Don't auto-move the picked Task to In Progress. That's `/pair-next`'s job, and the user may want to revise the pick first.

## Constraints

- Don't write code yet. This skill is **setup** — code-writing starts after the user confirms the pick and we transition into the pair-programming loop via `/pair-next`.
- Don't create new Tasks here — if the user wants more work surfaced, route through `/tasks-decompose` / `/tasks-materialize` for the underlying Spec.
- If the Story has no Specs at all, **stop** and tell the user to author at least one Spec first (`/spec-prepare`).

## Output

A briefing in chat:

```
🎯 Session: ST-{n} <story title>
   under EP-{m} <epic title>

🗒 Specs:
   - SP-50 <title>   (AC: 3/4 satisfied)
   - SP-51 <title>   (AC: 0/3 satisfied)

📋 Board for this Story:
   Ready: 5    In Progress: 1    Review: 2    Done: 4

▶ Next pick: Task #142 — <title>
   spec: SP-50
   satisfies: AC #2 ("Endpoint returns 401 when token expired")
   blocked by: none
   parallel-eligible: yes (sibling tasks 143, 144)

Mode: DRIVER — Claude can move cards and edit files.

Run /pair-next to take this task; reply with a different task # to pick another.
```

## Safety / fallback

- **Story has no Ready tasks.** Surface this. Suggest `/tasks-decompose` for a Spec that has none, or `/tasks-materialize` if a `SP-{n}-tasks.md` file already exists with unchecked rows.
- **Acceptance criteria not all parseable.** Carry on but note in the briefing which Specs have missing/malformed AC sections; the chunk-11 gates will surface the actual blockers when moves happen.
- **Navigator mode + user expects driving.** If `mode === "navigator"`, remind the user that moves on the board must come from them — Claude can propose moves but the MCP server will refuse them.
