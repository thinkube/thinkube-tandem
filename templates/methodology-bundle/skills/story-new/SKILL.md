---
description: Create a Story issue under an existing Epic + .thinkube/stories/ST-{n}.md sidecar. Links as a sub-issue.
allowed-tools:
  [
    "Read",
    "Glob",
    "mcp__thinkube-kanban__list_epics",
    "mcp__thinkube-kanban__get_issue",
    "mcp__thinkube-kanban__list_stories_in_epic",
    "mcp__thinkube-kanban__create_story_under_epic",
  ]
argument-hint: "<epic-number> <one-line story summary>"
thinkube-bundle: 0.0.1
---

# /story-new

Create a Story under a specified Epic. A Story is a single deliverable slice — usually decomposed later into 1–3 Specs and ~5–15 Tasks. The Story carries acceptance criteria at the user-outcome level; technical details belong on the Spec.

## Mission

Produce a typed `Story` issue linked as a sub-issue of an Epic, plus a sibling `.thinkube/stories/ST-{n}.md` file, with acceptance criteria framed as user-observable outcomes.

## Inputs

- `$ARGUMENTS`: `<epic-number> <one-line story summary>`. If `<epic-number>` is missing, list open Epics and ask the user to pick.

## Procedure

1. **Read methodology context** if not already in session.
2. **Resolve the Epic.** Call `mcp__thinkube-kanban__get_issue` with the epic number to confirm it exists, is open, and is actually an Epic (check `kind` field). Refuse with a clear message if not.
3. **Check siblings.** `mcp__thinkube-kanban__list_stories_in_epic` for existing children. If the user's intent overlaps a current story, ask whether to extend that story instead.
4. **Draft.** Propose:
   - **Title** — short, user-outcome flavoured (e.g. "Users can sign in with email magic link" not "Implement magic-link auth").
   - **Body** — 2–3 sentence summary + a `## Acceptance Criteria` checklist with 3–6 items at the user-observable level (e.g. `- [ ] A new user receives an email within 30s of submitting the form.`).
   - One non-goal under `## Out of scope`.
5. **Confirm with the user.** Show title + body. Wait for approval or refinement.
6. **Create.** Call `mcp__thinkube-kanban__create_story_under_epic` with the agreed content. The tool creates the issue, links the sub-issue, and writes the `.thinkube/stories/ST-{n}.md` sidecar.
7. **Report.** Print the URL, sidecar path, and the next step (`/spec-prepare <new-story-number>` after the user defines the first spec).

## Constraints

- One Story per invocation. Don't batch.
- Acceptance criteria here are **outcome-level**, not implementation steps. Implementation lives in Spec.
- If the user supplies an Epic that doesn't exist or is closed, refuse with a clear error — don't silently fall back to creating a free-standing Story.

## Output

```
✅ ST-{n}: <title>   (under EP-{epic-number})
   issue:   <url>
   sidecar: .thinkube/stories/ST-{n}.md
   ac:      <count> acceptance criteria
   next:    create Spec issues by hand or use /spec-prepare <spec-number>
```

## Safety / fallback

- **`addSubIssue` failure.** The MCP tool tries the sub-issue link as a non-fatal step. If the link couldn't be installed, the Story still exists on GitHub; surface the warning verbatim and tell the user how to link it by hand (`gh sub-issue add` or the GitHub UI).
- **Closed or wrong-kind parent.** Refuse cleanly. Don't pivot to creating a free-standing Story.
- **Empty acceptance criteria.** Refuse — at least one criterion is required, or the chunk-11 Spec→Ready gate will block downstream specs from advancing.
