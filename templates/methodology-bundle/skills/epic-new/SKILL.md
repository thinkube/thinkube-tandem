---
description: Create a new Epic issue + .thinkube/epics/EP-{n}.md sidecar. Starts the top of the methodology hierarchy.
allowed-tools:
  [
    "Read",
    "Glob",
    "mcp__thinkube-kanban__create_epic",
    "mcp__thinkube-kanban__list_epics",
  ]
argument-hint: "<one-line description>"
thinkube-bundle: 0.0.1
---

# /epic-new

Create a new Epic at the top of the methodology hierarchy. An Epic is the largest unit of work tracked on the board — typically several weeks of effort split across multiple stories. Use this when starting a new major initiative.

## Mission

Produce a typed `Epic` issue on GitHub and a sibling `.thinkube/epics/EP-{n}.md` file, with a one-paragraph pitch the team will refine through subsequent `/story-new` and `/spec-prepare` cycles.

## Inputs

- `$ARGUMENTS`: a one-line description from the user. Optional; if absent, ask for it.

## Procedure

1. **Read methodology context.** Skip if already loaded in this session. Otherwise read `.claude/skills/methodology-context/SKILL.md` to refresh hierarchy vocabulary (epic → story → spec → task) and the six-column workflow.
2. **Check for duplicates.** Call `mcp__thinkube-kanban__list_epics`. If a current Epic title overlaps strongly with the user's intent, ask the user to confirm: extend the existing Epic, or create a sibling.
3. **Draft the pitch.** From the user's one-liner, propose a 2–4 sentence pitch in chat covering:
   - What this Epic delivers (outcome, not feature list).
   - Who benefits and why now.
   - One non-goal worth naming explicitly.
4. **Confirm with the user.** Show the proposed title + pitch. Wait for approval or refinement.
5. **Create the issue + sidecar.** Call `mcp__thinkube-kanban__create_epic` with the agreed title and pitch as body. The tool also writes `.thinkube/epics/EP-{n}.md` with frontmatter.
6. **Report.** Print the new Epic's issue URL, the `.thinkube/epics/` path, and the next step (`/story-new <epic-number>`).

## Constraints

- Do **not** create multiple Epics in a single invocation. One epic at a time.
- Do **not** attach labels beyond what `create_epic` sets automatically — labels are a methodology-classifier signal.
- Do **not** prefill acceptance criteria on the Epic itself — those live on Specs.

## Output

A short status block in the chat:

```
✅ EP-{n}: <title>
   issue: <url>
   sidecar: .thinkube/epics/EP-{n}.md
   next:    /story-new {n}
```

## Safety / fallback

- **`create_epic` fails (auth, rate limit).** Report the underlying error verbatim. Suggest `thinkube.kanban.refreshFromGitHub` or re-running `/configureProject` if the failure looks like permissions.
- **Duplicate-by-title risk.** When the user's pitch overlaps an open Epic, prefer extending the existing Epic over forking a new one — surface the choice rather than deciding silently.
- **Empty pitch.** Refuse rather than create an Epic with placeholder text. Ask the user to elaborate.
