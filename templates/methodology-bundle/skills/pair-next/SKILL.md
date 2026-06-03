---
description: Advance the pair-programming loop. Verifies the previous Task (via verifier subagent), moves cards forward, picks the next Ready Task, loads its context.
allowed-tools:
  [
    "Read",
    "Grep",
    "Glob",
    "Bash",
    "Task",
    "mcp__thinkube-kanban__list_board",
    "mcp__thinkube-kanban__get_issue",
    "mcp__thinkube-kanban__get_thinkube_file",
    "mcp__thinkube-kanban__move_task",
    "mcp__thinkube-kanban__add_comment",
    "mcp__thinkube-kanban__list_tasks_in_spec",
  ]
argument-hint: "(no args; uses the current session's active Story)"
thinkube-bundle: 0.0.1
---

# /pair-next

The work-loop pulse. After finishing a Task, run `/pair-next` to: (1) verify the work via the `verifier` subagent, (2) advance the finished Task across the board, (3) pick the next Ready Task and load its context. This is the skill the user invokes most often during a session.

## Mission

In one invocation:

1. Verify the previous Task — tests, lint, typecheck all green.
2. On green: move the Task forward (In Progress → Review, or directly to Verify if the chunk-11 gate accepts).
3. Comment on the issue with a one-paragraph summary of the change for traceability.
4. Sweep for stale siblings — Tasks whose parent Spec's *requirements* changed (SP-86) — and resolve them before starting new work.
5. Pick the next Ready Task under the same Story.
6. Move the new Task to In Progress.
7. Load the new Task's body + parent Spec section into the conversation.

## Procedure

1. **Identify the in-flight Task.** `mcp__thinkube-kanban__list_board` and find the Task currently in `In Progress` under the active Story. If multiple, prefer the one most recently moved (or ask the user). If none, treat this as a `/pair-start` situation and tell the user.
2. **Verify.** Delegate to the `verifier` subagent (via `Task` tool):
   - Prompt the verifier with the project's test/lint/typecheck commands (it knows where to look via `repo-conventions`).
   - Verifier returns `{ ok: true }` or `{ ok: false, reason, evidence }`.
   - On red: **stop**. Surface the failures to the user verbatim. Do not move the card. Suggest fixes; the user re-runs `/pair-next` after addressing them.
3. **Comment.** On green: leave a one-paragraph comment on the Task issue summarising what changed (key files, approach, anything reviewers should look at first). Use `mcp__thinkube-kanban__add_comment` — this also satisfies the chunk-11 In-Progress→Review gate.
4. **Move the finished Task forward.** Default target: `Review`. Use `mcp__thinkube-kanban__move_task` with `status = "Review"`. If the user has indicated this work skips review (e.g. trivial fix), they can ask Claude to move to `Verify` directly — but the chunk-11 Review→Verify gate needs the parent Spec's AC fully checked first, so this is the exception not the rule.
5. **Update the parent Spec's acceptance criteria.** If the completed Task satisfied a specific AC, mark that AC checked in `.thinkube/specs/SP-{n}.md` via `Edit`. The chunk-11 Review→Verify gate later in the workflow looks at these checkboxes.
6. **Stale-spec sweep (SP-86).** Before picking the next Task, check whether any sibling Task under the active Story went stale because its parent Spec's *requirements* changed. Call `mcp__thinkube-kanban__list_tasks_in_spec` for the active Story's Spec(s) (or read `list_board`) — each Task carries `specStale` (bool) and `specChange` (`none` | `metadata` | `requirements`):
   - **`specChange: "requirements"`** (substantively stale — the Spec's `## Acceptance Criteria` / `## Design` / `## Constraints` changed since this Task was verified): **resolve it before starting new work.** Re-run the `verifier` against the current Spec; if the Task is past `In Progress` (Review/Verify/Done) and no longer meets the new AC, move it back and re-open the affected `.thinkube/specs/SP-{n}.md` checkboxes. Tell the user what changed.
   - **`specChange: "metadata"`** (an issue-type/label/sub-issue/status/comment change, or an AC checkbox toggle): not a real change — no re-verification; the flag clears once the Task is next touched.
   - Handle stale siblings one at a time; finish the sweep before moving on.
7. **Pick the next Task.** Same priority rule as `/pair-start`: top of Ready under the same Story, satisfying dependencies. If no Ready tasks remain, surface that the Story is done-ish and suggest `/retro` or progressing other Stories.
8. **Advance and load context.** `move_task` for the picked Task → In Progress. Then `mcp__thinkube-kanban__get_issue` for it and `get_thinkube_file specs/SP-{n}.md` for the parent Spec section it implements.
9. **Brief the user.**

## Constraints

- **Verifier red is non-negotiable.** Don't move cards while tests are failing, ever. Suggest fixes; let the user fix; re-run.
- **One Task at a time.** Don't fan out into parallel In-Progress cards in a single `/pair-next` call. Parallel work is the user's choice, run separately.
- **Don't bypass the chunk-11 gates.** If the gate refuses a move, surface the gate's reason and stop. Don't try to work around with `update_issue` to fake the underlying condition.
- **Comment quality.** The comment exists for the future reader. One paragraph: what changed, why, what's risky. Not a diff dump.
- **Staleness baseline (SP-86).** Moving a Task to `Verify` (or `Done`) auto-records the Spec requirement-hash it was verified against — that baseline is exactly what the step-6 sweep compares against. You don't stamp it by hand; just move the card. A Task with no baseline yet (never verified) is never flagged stale.

## Output

```
🔬 Verify: Task #142
   tests:    ✅ 247 passed
   lint:     ✅ clean
   typecheck:✅ clean

✍ Comment posted on #142
🟢 #142 → Review

▶ Next pick: Task #143 — <title>
   spec: SP-50, satisfies AC #3
🟢 #143 → In Progress

Loaded:
   - Task #143 body (description above)
   - SP-50 Design section
   - Files in the file-plan touched by this task: src/auth/handler.ts, src/auth/handler.test.ts

Ready to pair on Task #143. Tell me what you want to do first.
```

## Safety / fallback

- **Verifier subagent missing.** If `.claude/agents/verifier.md` isn't installed, run the test/lint/typecheck commands directly via `Bash` instead. Suggest re-installing the bundle.
- **Test command not detected.** Tell the user. Don't guess — ask for the right command and add it to `repo-conventions`.
- **Move-card gate refuses.** Surface the reason verbatim. If it's the In-Progress→Review gate complaining about no comments, you didn't yet post one — check ordering. If Review→Verify is rejecting because parent Spec ACs aren't all checked, point the user at the unchecked items.
- **Token lacks `project` scope.** The card move fails. The work is verified and the comment is posted; only the kanban placement is missing. Tell the user to refresh their token.
