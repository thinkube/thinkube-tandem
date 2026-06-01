---
description: Walk the user through filling a Spec's body. Writes .thinkube/specs/SP-{n}.md with the standard Thinkube spec sections (acceptance criteria, constraints, design, file plan).
allowed-tools:
  [
    "Read",
    "Write",
    "Edit",
    "Grep",
    "Glob",
    "mcp__thinkube-kanban__get_issue",
    "mcp__thinkube-kanban__update_issue",
    "mcp__thinkube-kanban__get_thinkube_file",
    "Task",
  ]
argument-hint: "<spec-number>"
thinkube-bundle: 0.0.1
---

# /spec-prepare

Fill in a Spec's body to the standard Thinkube shape. The Spec lives as one GitHub issue (the source of truth) + one `.thinkube/specs/SP-{n}.md` sidecar (the long-form). After this skill runs, the chunk-11 Spec→Ready gate will pass and the Spec is ready for `/tasks-decompose`.

## Mission

Produce a fully-shaped `.thinkube/specs/SP-{n}.md` containing the four canonical sections, with:

- **Acceptance criteria** that the chunk-11 gates will accept (non-empty checklist).
- **Constraints** that bound the design (perf, compat, security, deadlines).
- **Design** at the depth needed to start tasks, not a full implementation guide.
- **File plan** naming the files the spec will touch.

## Inputs

- `$ARGUMENTS`: the Spec issue number (integer).

## Procedure

1. **Read methodology context** if not in session.
2. **Fetch context.** Use `mcp__thinkube-kanban__get_issue` for the spec; if the issue body or linked file is non-empty, treat it as a draft to refine rather than rewriting from scratch. Walk up to the parent Story (`mcp__thinkube-kanban__get_issue` again) to capture the user-observable acceptance criteria — those become the technical AC of this spec.
3. **Explore the codebase** _only as needed_ to ground the design. Delegate to the `explorer` subagent (`Task` tool) when the question is "what's currently in this codebase" — it keeps the main context lean. Otherwise use Grep/Glob directly.
4. **Interview the user, section by section.** For each missing section, propose a draft in chat, capture the user's correction, move on. Don't write to disk until the user confirms the whole spec.
   - **Acceptance criteria**: derived from the parent Story's user-level AC; sharpened to verifiable technical criteria (e.g. "Endpoint returns 401 when the token is expired and the body matches `{error: 'expired_token'}`.").
   - **Constraints**: list. Performance budgets, browser support, dependency rules, deadlines.
   - **Design**: 1–3 paragraphs. Approach + key data structures + integration seams. Not pseudocode.
   - **File structure plan**: bullet list of files we expect to create / modify, one line of why each.
5. **Write the sidecar.** Use `Write` to overwrite `.thinkube/specs/SP-{n}.md` with this exact shape:

```
---
kind: spec
issue: {n}
parent_issue: <story-number>
repo: <owner>/<name>
created: <today YYYY-MM-DD>
---

# {title}

{one-paragraph summary}

## Acceptance Criteria

- [ ] <criterion 1>
- [ ] <criterion 2>
- [ ] …

## Constraints

- <constraint 1>
- <constraint 2>

## Design

<approach + structures + seams>

## File Structure Plan

- `path/to/file.ts` — <reason>
- `other/file.tsx` — <reason>
```

6. **Optionally update the issue body.** If the original issue body was empty or placeholder, mirror the new spec body to the GitHub issue via `mcp__thinkube-kanban__update_issue` so the issue isn't a stub. Leave the issue alone if it already has substantive content.
7. **Report.** Print the path, AC count, and the suggested next step (`/tasks-decompose {n}`).

## Constraints

- The four section headers (`## Acceptance Criteria`, `## Constraints`, `## Design`, `## File Structure Plan`) are **load-bearing** — the chunk-11 quality gates and the MCP tools look for these exact strings. Don't rename them.
- Don't invent acceptance criteria the user didn't agree to. Each `- [ ]` line should trace to something the user explicitly said or confirmed.
- If the Story has no acceptance criteria, **stop and tell the user to fill the Story first** — don't fabricate at the spec level.

## Output

```
✅ SP-{n}: <title>
   sidecar: .thinkube/specs/SP-{n}.md
   ac:      <count> acceptance criteria
   files:   <count> in file plan
   next:    /tasks-decompose {n}
```

## Safety / fallback

- **Spec issue closed or wrong kind.** Refuse with a clear message and the actual `kind` we found.
- **Parent Story unreachable.** Continue but warn — the user is authoring a Spec without an upstream outcome to trace to.
- **Existing sidecar with user edits.** Read the existing file first; preserve sections the user has filled out. Only overwrite sections the user has agreed to update during this run.
- **`update_issue` fails.** The sidecar is the source of truth for the body; surface the failure but proceed.
