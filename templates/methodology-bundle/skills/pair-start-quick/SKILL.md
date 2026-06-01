---
description: Ceremony defuser for small bugfix-shape work. Collapses spec/tasks/materialise into one inline flow, drops straight into pair-programming on a single Task.
allowed-tools:
  [
    "Read",
    "Write",
    "Edit",
    "Grep",
    "Glob",
    "Bash",
    "Task",
    "mcp__thinkube-kanban__create_spec_under_story",
    "mcp__thinkube-kanban__create_tasks_from_spec",
    "mcp__thinkube-kanban__list_stories_in_epic",
    "mcp__thinkube-kanban__list_epics",
    "mcp__thinkube-kanban__move_task",
    "mcp__thinkube-kanban__get_issue",
  ]
argument-hint: "<one-line description of the fix>"
thinkube-bundle: 0.0.1
---

# /pair-start-quick

The four-tier hierarchy (epic → story → spec → task) is right for medium-and-larger work and overkill for solo bugfix-shape work. `/pair-start-quick "fix the login redirect bug"` collapses the ceremony: drafts a one-paragraph spec inline, creates a single Task (no sub-decomposition), materialises it in Ready, moves it to In Progress, and loads its context for pair-programming. **Same artefacts** as the full flow — the work stays first-class on the kanban — just without the Epic/Story/multi-task scaffolding.

## Mission

In one invocation, end with a single Task issue in `In Progress`, a minimal `.thinkube/specs/SP-{n}.md` sidecar, and the conversation context primed to start coding.

## Inputs

- `$ARGUMENTS`: a one-line description of the fix. Required.

## Procedure

1. **Validate the input shape.** This skill is for small, single-task work — typically 1–3 hours, one or two files. If the user's description sounds like a feature ("add OAuth support") rather than a fix ("fix the redirect when the token has just expired"), surface that and suggest `/epic-new` → `/story-new` → `/spec-prepare` instead. Don't refuse outright — confirm with the user, then proceed.
2. **Identify a host Story.** Use `mcp__thinkube-kanban__list_epics` then `list_stories_in_epic` to find an open "Day-to-day" / "Maintenance" / "Backlog" Story. If none exists, ask the user to point at any open Story that's a reasonable host for fix-shape work. Don't create an Epic/Story automatically — that's noisy.
3. **Draft a minimal spec.** Two paragraphs at most:
   - **Acceptance Criteria** — single bullet: what observable change verifies the fix.
   - **Design** — one-paragraph approach.
   - Skip the Constraints + File Structure Plan sections (or leave them empty headers — the chunk-11 Spec→Ready gate needs at least one AC, not the other sections).
4. **Create the Spec issue.** `mcp__thinkube-kanban__create_spec_under_story` with the chosen story and the drafted body. The tool writes the `.thinkube/specs/SP-{n}.md` sidecar.
5. **Write the one-row tasks file.** Use `Write` to author `.thinkube/specs/SP-{n}-tasks.md`:

```
---
kind: task-decomposition
issue: {n}
parent_issue: {n}
repo: <owner>/<name>
created: <YYYY-MM-DD>
---

# Tasks for SP-{n}

- [ ] <task title from the user's brief>
```

6. **Materialise.** `mcp__thinkube-kanban__create_tasks_from_spec` with `spec_number = {n}`. One Task created, added to project in Ready.
7. **Move to In Progress.** `mcp__thinkube-kanban__move_task` with the new Task number and `status = "In Progress"`.
8. **Brief the user.** Show what was created, the path to the Task issue, and the loaded context.

## Constraints

- This skill **does not** create Epics or Stories. The point is to skip ceremony, not to add more.
- Use this for work that genuinely is small. If the user keeps coming back with multi-task bugfixes for the "same" thing, suggest promoting it to a real Story.
- The Spec produced here is intentionally thin. That's OK — the chunk-11 Spec→Ready gate only requires one AC line. Don't pad the spec with placeholder constraints/design.

## Output

```
⚡ Quick-path session
   under ST-{m} <story title>

   SP-{n}: <title>      .thinkube/specs/SP-{n}.md
   Task #{k}: <title>   #{k}
   Status: In Progress

Loaded context:
   - SP-{n} spec body
   - Task #{k} body

Ready to fix. Tell me the failing case to reproduce first.
```

## Safety / fallback

- **No catch-all Story exists.** Don't create one. Surface that and ask the user to point at an existing Story, or to run the full ceremony if there's no reasonable host.
- **`create_tasks_from_spec` only created 0 tasks.** The tasks file row wasn't recognised — usually a frontmatter issue. Print the file path and offer to fix the frontmatter.
- **Move-to-In-Progress fails because the Spec→Ready gate refused.** The Spec was written without acceptance criteria, or the gate's checking the wrong file. Add an AC line and retry.
