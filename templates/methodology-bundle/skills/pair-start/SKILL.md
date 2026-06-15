---
description: Begin a pair-programming session on a Spec — loads the Spec body and Ready slices, checks out the spec branch, surfaces the next slice. MUST BE USED when the user says "start pairing", "pair-start", "begin the spec", or "let's work on SP-X". Do not hand-roll session setup yourself.
allowed-tools:
  [
    "Read",
    "Glob",
    "Grep",
    "Bash",
    "mcp__thinkube-kanban__list_board",
    "mcp__thinkube-kanban__get_slice",
    "mcp__thinkube-kanban__get_thinkube_file",
    "Task",
  ]
argument-hint: "<spec-number>"
thinkube-bundle: 0.0.1
---

# /pair-start

Start a pair-programming session on a specific **Spec**. Loads everything Claude needs to work effectively: the Spec body with its acceptance criteria, and all Ready slices under it. Ensures the Spec's one branch (`spec/SP-{n}`) is checked out, surfaces the next slice, and hands to the autonomous loop. Surfaces the navigator/driver mode.

This skill is **setup**, not a gate. Per TEP-0010 a Spec runs on **one branch with its slices executing consecutively and autonomously** — the human defines the goal up front (the Spec + its acceptance criteria) and the single human gate is **acceptance**, at the end. So `/pair-start` does **not** stop for a mid-spec "confirm the pick" bless; it loads context and lets the loop pull the first slice.

## Mission

After `/pair-start <spec-number>`, the conversation context should contain:

- The Spec title + body + acceptance criteria, already parsed, for situational awareness.
- The Spec's branch `spec/SP-{n}` checked out (created if missing) — one branch per Spec (TEP-0010).
- A clear pick of the next Ready slice with rationale (top of column, dependencies satisfied).
- Any **substantively-stale** done slices flagged up front (parent Spec's requirements changed since they were verified), so they're re-verified before new work.
- An explicit acknowledgment of the current mode (`navigator` / `driver` / `both`) and what that means for Claude's write authority this session.

## Inputs

- `$ARGUMENTS`: the Spec number `{n}`. If absent, list Specs that have Ready slices (from `list_board`) and ask the user to pick.

## Procedure

1. **Read methodology context** + `repo-conventions` (load both into session if not already).
2. **Check out the Spec's branch.** One branch per Spec (TEP-0010): `spec/SP-{n}`. In the **code repo** (not the board sidecar), `git switch spec/SP-{n}` if it exists, else `git switch -c spec/SP-{n}` off the default branch. For a Spec running in a worktree (parallel specs, TEP-0008) the branch already exists on the worktree — just confirm you're on it. Slices land as commits here; there is no per-slice branch.
3. **Load the Spec.** `get_thinkube_file specs/SP-{n}/spec.md` — surface its acceptance criteria.
4. **Load the board.** `mcp__thinkube-kanban__list_board` returns cards grouped Ready / Doing / Done; each card carries its handle (`id`, e.g. `SP-{n}_SL-3`), title, `specStale`, and `specChange`. Filter to cards whose `parent` is `SP-{n}`. Read individual slice bodies with `get_slice { slice: "SP-{n}_SL-{m}" }` as needed.
5. **Pick the next slice.** Apply this priority:
   1. A slice already in **Doing** under this Spec (resume in-flight work first — keep one slice in flight per Spec).
   2. Top of **Ready** with its `depends_on` already Done.
6. **Surface the picked slice.** Show: handle, title, the AC line(s) it satisfies, dependencies satisfied or pending.
7. **Flag stale slices.** If any **done** slice under this Spec has `specChange: "requirements"` — its parent Spec's `## Acceptance Criteria` / `## Design` / `## Constraints` changed since it was verified — surface it prominently: it needs re-verification (handled by `/pair-next`'s stale-spec sweep) before new work proceeds. Ignore `metadata`-only staleness (status/priority/checkbox-toggle — not a real change).
8. **State the mode.** Echo the current `thinkube.kanban.mode` value and what it means:
   - `navigator`: Claude reads + proposes; cannot write the board.
   - `driver`: Claude is leading; will move cards, edit files, push.
   - `both`: either side can write.
9. **Tell the user** to open the board from the Activity Bar (**Thinkube** → **Boards** → click this repo), or via the command palette (**Thinkube Kanban: Open Kanban**), so they can see drag-and-drop reflect the work.
10. **Hand to the loop — no bless point.** Present the pick and the plan; do **not** stop for a "confirm the pick" decision (TEP-0010 removed the mid-spec bless). The human already set the goal by authoring the Spec + ACs; the single human gate is **acceptance**, at the end. State that the loop will run the Spec's Ready slices to completion and stop for the human only at acceptance (or on a gate refusal / failed precondition). The human intervenes by exception. `/pair-next` then drives the slices; on the same turn you may proceed directly into the first slice.

## Constraints

- This skill is **setup** — it loads context and checks out the branch. The actual code-writing happens as the loop pulls each slice into Doing (`/pair-next`); don't fan out work here.
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

On branch spec/SP-{n} (one branch / one PR for the whole Spec).
The loop runs the Ready slices to completion; I'll stop for you at acceptance.
Intervene any time by exception.
```

## Safety / fallback

- **Spec has no Ready slices.** Surface this. Suggest `/slice {n}` if the Spec hasn't been sliced yet.
- **Acceptance criteria not all parseable.** Carry on but note in the briefing that the Spec's AC section looks malformed; the → Ready gate will surface the actual blocker when a slice tries to advance.
- **Navigator mode + user expects driving.** If `mode === "navigator"`, remind the user that moves on the board must come from them — Claude can propose moves but the MCP server will refuse them.
