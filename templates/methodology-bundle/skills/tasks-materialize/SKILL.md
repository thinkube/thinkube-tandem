---
description: Materialise the unchecked rows in .thinkube/specs/SP-{n}-tasks.md as GitHub Task issues + Projects v2 items in Ready. Idempotent.
allowed-tools:
  [
    "Read",
    "mcp__thinkube-kanban__create_tasks_from_spec",
    "mcp__thinkube-kanban__get_thinkube_file",
  ]
argument-hint: "<spec-number>"
thinkube-bundle: 0.0.1
---

# /tasks-materialize

Take the decomposition that `/tasks-decompose` produced (or that a human wrote by hand) and turn each unchecked row into a real GitHub Task issue, linked as a sub-issue of the Spec, placed in the `Ready` column of the configured Projects v2 board.

## Mission

For each `- [ ] …` row in `.thinkube/specs/SP-{n}-tasks.md`:

1. Create a Task issue on GitHub with the row's title + an enriched body.
2. Link it as a sub-issue of the parent Spec.
3. Add it to the project with `Status = Ready`.
4. Flip the row's checkbox to `- [x]` in the source file so re-runs skip it.

`/tasks-materialize` is the explicit-action form of the toast the chunk-9 watcher fires automatically on file changes. Use the skill when the toast was dismissed, when materialising for the first time after a manual edit, or when scripting the flow.

## Inputs

- `$ARGUMENTS`: the Spec issue number.

## Procedure

1. **Verify the file exists.** Use `mcp__thinkube-kanban__get_thinkube_file specs/SP-{n}-tasks.md`. If absent, stop — the user needs `/tasks-decompose {n}` first.
2. **Inspect.** Count unchecked rows. If zero, report idempotency cleanly: "no unchecked tasks — nothing to materialise" and stop.
3. **Materialise.** Call `mcp__thinkube-kanban__create_tasks_from_spec` with `spec_number = {n}`. The tool runs the full pipeline (create issue → link sub-issue → add to project → set status → mark row checked).
4. **Report.** Print the created task numbers + URLs grouped by row index; surface any per-row failures with their reasons. Suggest `/pair-start <story-number>` as the next step.

## Constraints

- **Don't** create Task issues by hand via `create_issue` to bypass the materialiser — that skips the row-marking step and breaks idempotency.
- **Don't** modify the tasks file directly during this skill — the materialiser owns the `[ ] → [x]` flip.
- **Don't** run this against a file that's still being authored — wait until the user has confirmed the decomposition.

## Output

```
✅ Materialised <count> tasks for SP-{n}
   #<task-1> ← row 1: <title>     <url>
   #<task-2> ← row 2: <title>     <url>
   …
   <failed> row(s) failed: see Thinkube Kanban output channel
   next: /pair-start <story-number>
```

## Safety / fallback

- **Partial failure** (some rows succeeded, others failed). The materialiser marks only the successful rows as checked. Re-run the skill to retry the failed rows after fixing the underlying issue (token scope, network, etc.). Idempotent by design.
- **No Projects v2 configured** (`thinkube.kanban.projectNumber = 0`). The tool creates issues + sub-issue links but skips kanban placement; warn the user. The user can run `/configureProject` to add project tracking.
- **Token lacks `project` scope.** Issues are created, kanban placement fails. Direct the user to refresh their token with the `project` scope.
