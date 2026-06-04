---
description: Walk the user through filling a Spec's body. Writes .thinkube/specs/SP-{n}/spec.md with the standard Tandem spec sections (acceptance criteria, constraints, design, file plan).
allowed-tools:
  [
    "Read",
    "Write",
    "Edit",
    "Grep",
    "Glob",
    "mcp__thinkube-kanban__get_thinkube_file",
    "Task",
  ]
argument-hint: "<spec-number>"
thinkube-bundle: 0.0.1
---

# /spec-prepare

Fill in a Spec's body to the standard Tandem shape. The Spec lives as a committed file at `.thinkube/specs/SP-{n}/spec.md` — the single source of truth. After this skill runs, the → Ready gate passes (the Spec has a non-empty `## Acceptance Criteria`) and the Spec is ready for `/slice`.

## Mission

Produce a fully-shaped `.thinkube/specs/SP-{n}/spec.md` containing the four canonical sections, with:

- **Acceptance criteria** that the → Ready gate will accept (non-empty checklist) and that are **user-observable / verifiable**.
- **Constraints** that bound the design (perf, compat, security, deadlines).
- **Design** at the depth needed to start slicing, not a full implementation guide.
- **File plan** naming the files the spec will touch.

## Inputs

- `$ARGUMENTS`: the Spec number `{n}` (integer).

## Procedure

1. **Read methodology context** if not in session.
2. **Fetch context.** Use `get_thinkube_file specs/SP-{n}/spec.md`; if the file is non-empty, treat it as a draft to refine rather than rewriting from scratch.
3. **Explore the codebase** _only as needed_ to ground the design. Delegate to the `explorer` subagent (`Task` tool) when the question is "what's currently in this codebase" — it keeps the main context lean. Otherwise use Grep/Glob directly.
4. **Interview the user, section by section.** For each missing section, propose a draft in chat, capture the user's correction, move on. Don't write to disk until the user confirms the whole spec.
   - **Acceptance criteria**: elicited **from the user** — there is no parent Story to inherit them from. They must be **user-observable outcomes**, framed so they can be verified, not implementation steps. Good: "A new user receives an email within 30s of submitting the form." / "Endpoint returns 401 when the token is expired and the body matches `{error: 'expired_token'}`." Bad: "Add a Redis session store" (that's work, it belongs in a slice).
   - **Constraints**: list. Performance budgets, browser support, dependency rules, deadlines.
   - **Design**: 1–3 paragraphs. Approach + key data structures + integration seams. Not pseudocode. This is also where **spikes / investigations** ("confirm X behaves like Y") land — they are not slices.
   - **File structure plan**: bullet list of files we expect to create / modify, one line of why each.
5. **Write the spec.** Use `Write` to overwrite `.thinkube/specs/SP-{n}/spec.md` with this exact shape:

```
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

6. **Report.** Print the path, AC count, and the suggested next step (`/slice {n}`).

## Constraints

- The four section headers (`## Acceptance Criteria`, `## Constraints`, `## Design`, `## File Structure Plan`) are **load-bearing** — the quality gates and the staleness hash look for these exact strings. Don't rename them.
- **Acceptance criteria are outcome-level, not implementation steps.** Each `- [ ]` line is something the user can observe or a verifier can check. Implementation work lives in slices, not here.
- Don't invent acceptance criteria the user didn't agree to. Each `- [ ]` line should trace to something the user explicitly said or confirmed.

## Output

```
✅ SP-{n}: <title>
   spec:    .thinkube/specs/SP-{n}/spec.md
   ac:      <count> acceptance criteria
   files:   <count> in file plan
   next:    /slice {n}
```

## Safety / fallback

- **No acceptance criteria the user will commit to.** Refuse to write — at least one user-observable criterion is required, or the → Ready gate will block the Spec's slices from advancing.
- **Existing spec with user edits.** Read the existing file first; preserve sections the user has filled out. Only overwrite sections the user has agreed to update during this run.
