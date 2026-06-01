---
description: Decompose a Spec into atomic tasks (~1–3h each), write .thinkube/specs/SP-{n}-tasks.md in the Thinkube tasks-list format. Detects parallel-eligible tasks.
allowed-tools:
  [
    "Read",
    "Write",
    "Grep",
    "Glob",
    "mcp__thinkube-kanban__get_issue",
    "mcp__thinkube-kanban__get_thinkube_file",
    "Task",
  ]
argument-hint: "<spec-number>"
thinkube-bundle: 0.0.1
---

# /tasks-decompose

Read a fully-shaped Spec and produce a flat list of atomic tasks in Thinkube's tasks-list format. The output file (`SP-{n}-tasks.md`) is what the chunk-9 materialiser turns into GitHub Task issues and Projects v2 items in `Ready`.

## Mission

Produce a `.thinkube/specs/SP-{n}-tasks.md` file containing:

- 4–12 task rows, each sized at roughly 1–3 hours of focused work.
- Each row reads as imperative work ("Wire OAuth callback handler", "Add Redis session store"), not as an outcome ("Auth works").
- `(P)` markers on tasks that can be done in parallel with their siblings.
- `→ depends-on: <index>` annotations where order matters.
- Complete coverage of the Spec's `## Acceptance Criteria` — every AC must map to at least one task.

## Inputs

- `$ARGUMENTS`: the Spec issue number (integer).

## Procedure

0. **Detect re-decomposition (the spec changed under existing tasks).** If `.thinkube/specs/SP-{n}-tasks.md` already exists, this is a **change-review**, not a fresh decomposition — the kanban flags this with a `⚠ spec changed — review` badge on tasks whose parent spec was edited after them. Do NOT overwrite blindly:
   - Read the existing tasks file AND the current Task issues (`mcp__thinkube-kanban__list_tasks_in_spec {n}`) with their board status.
   - Re-derive tasks from the spec's **current** Acceptance Criteria, then diff against what exists, classifying each as **keep** (still maps to an AC), **add** (an AC has no covering task), or **obsolete** (no longer maps to any AC).
   - **The action depends on the task's board status — never react uniformly:**
     | Status | Action on change |
     | --- | --- |
     | Spec / Ready (not started) | revise / add / drop freely |
     | In Progress | do **not** edit or drop — flag it; ask the user whether to keep, rescope, or move back to Ready |
     | Review | re-review the diff against the new AC (the prior review may no longer hold) |
     | Verify | re-verify against the new AC (delegate to the `verifier`) |
     | Done | leave it closed; if the change implies more work, propose a **new** task, don't reopen |
   - Present the keep/add/obsolete diff **annotated with each task's status and the recommended action**; get the user's blessing before writing. Then continue from step 6, preserving materialised / in-progress / done rows (see fallback).
1. **Read methodology context** + `repo-conventions` for branch/PR/commit rules that may influence task ordering.
2. **Load the Spec.** Use `mcp__thinkube-kanban__get_thinkube_file specs/SP-{n}.md` for the full body. Walk up to parent Story too via `mcp__thinkube-kanban__get_issue` for user-context. If the spec body is missing the four canonical sections (Acceptance Criteria / Constraints / Design / File Structure Plan), **stop** and direct the user to `/spec-prepare {n}` first.
3. **Brainstorm tasks privately.** Working through the Design + File Structure Plan, draft an initial list of candidate tasks. For each, mentally check:
   - Is this 1–3 hours? If larger, split. If smaller, merge into a sibling.
   - Does it produce _visible progress_ (a passing test, a working endpoint, a deployable artifact)? Tasks that "set up scaffolding without testing it" are usually a sign of bad granularity.
   - Can it run in parallel with siblings (no shared file edits, no required ordering)? If yes, mark `(P)`.
   - Does it depend on a sibling? Note `→ depends-on: <idx>`.
4. **Map back to acceptance criteria.** For each AC line in the spec, identify which task(s) satisfy it. If an AC is unmatched, add a task. If a task isn't traceable to any AC, drop it (or add an AC if the work is legitimate but unspecified — surface that gap to the user).
5. **Propose in chat.** Show the proposed task list with rationale. Wait for user feedback.
6. **Write the tasks file.** Use `Write` to overwrite `.thinkube/specs/SP-{n}-tasks.md` with this shape:

```
---
kind: task-decomposition
issue: {n}
parent_issue: {n}
repo: <owner>/<name>
created: <YYYY-MM-DD>
---

# Tasks for SP-{n}

<one-line context: which AC this set covers>

- [ ] <task 1 title> — <one-line description>
- [ ] (P) <task 2 title> — <description>
- [ ] (P) <task 3 title>
- [ ] <task 4 title> → depends-on: 1
- [ ] <task 5 title>
```

7. **Report.** Print the path, task count, parallel-eligible count, and the next step: a toast will appear from the chunk-9 watcher offering to materialise; the user can accept or run `/tasks-materialize {n}` explicitly.

## Constraints

- Tasks are **work items**, not outcomes. Title imperatively.
- `(P)` is _parallel-eligible_, not _must-run-in-parallel_. Use it when the task doesn't touch files / state that a sibling needs.
- `→ depends-on: N` references the **row index in this file** (1-based), not an issue number — the file is the canonical source until materialisation flips them to issues.
- Don't create the GitHub Task issues here. That's the chunk-9 materialiser's job. The watcher fires automatically when this file lands.

## Output

```
✅ SP-{n} decomposed
   sidecar: .thinkube/specs/SP-{n}-tasks.md
   tasks:   <count> total, <pcount> parallel-eligible
   ac-coverage: <covered>/<total> ✔
   next:    accept the materialise toast or run /tasks-materialize {n}
```

## Safety / fallback

- **Spec sections missing.** Refuse cleanly. Direct user to `/spec-prepare {n}`.
- **AC unmatched by any task.** Don't silently invent a task. Either surface the gap (asking the user if the AC is still valid) or merge an AC into an existing task with the user's blessing.
- **Existing tasks file present and any row already checked.** Preserve the checked rows — they've already been materialised. Append new tasks below; don't reshuffle indexes of materialised rows.
- **Spec is huge (>12 candidate tasks).** That's usually a sign the Spec should be split. Surface this to the user before authoring the file.
