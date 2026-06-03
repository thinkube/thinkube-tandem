---
kind: decision
id: ADR-0003
title: Lean process shape — Spec→Task with file-backed task cards, three columns, two gates
status: accepted
created: 2026-06-03
repo: thinkube/thinkube-ai-integration
---

# ADR-0003 — Lean process shape: Spec→Task, file-backed cards, three columns, two gates

## Status

Accepted — 2026-06-03. Builds on ADR-0001 (files-first) and ADR-0002 (no RAG).
Supersedes an earlier draft of this ADR that proposed checkbox tasks (see
"Alternatives considered"). Revisitable.

## Context

The methodology was built on an agile/scrum skeleton — team-shaped by origin —
but the user is a solo developer (human + Claude). ADR-0001 already moved the
source of truth to committed files. This ADR addresses the remaining weight: the
_process shape_ (tiers, columns, gates, ceremony, skill surface).

The deciding insight on tiers: **"optional" tiers are themselves complexity.**
Keeping Epic/Story as optional adds a decision point ("is this big enough for a
Story?"), forces two code paths in every hierarchy-walking skill, and keeps extra
vocabulary you must understand in order to skip. So Epic and Story are removed
outright, not made optional.

A second, separate decision — **how tasks are represented** — was initially
conflated with "stop minting a GitHub issue per task." Those are independent:
dropping the _issue_ does not require dropping the _card_. The board's card-per-task
experience is valued and is fully compatible with files-first; a task can be a
discrete **file** with a `status:` field — a structured record, not text scraped
from prose. This ADR keeps task cards, backed by files.

## Decision

**Two concrete tiers — Spec → Task — with tasks as file-backed cards, three
columns, and two file-checked gates. Grouping above the Spec is metadata, not a
tier.**

### Hierarchy: Spec → Task (Epic/Story removed)

- The **Spec** is the documented work unit — acceptance criteria, design, file
  plan. It is the _parent/document_, not a board card.
- The **Task** is a 1–3h unit of work, a discrete **file** under its Spec, and the
  thing that **flows the board**.
- **Epic and Story are removed entirely.** Grouping above the Spec is a `theme:`
  frontmatter tag (e.g. `auth`, `billing`) plus an optional one-paragraph
  `roadmap.md`. Both Spec and Task tiers are concrete and non-optional, so they do
  not reintroduce the optionality complexity Epic/Story did.

### Tasks: file-backed cards (card = Task)

- Each task is a file, e.g. `.thinkube/tasks/T-{n}.md`, with structured frontmatter:
  `status:` (Ready/Doing/Done), `parent:` (the Spec id), and optional
  `depends_on:` / `parallel:`. The body holds the task description.
- **Task state lives in frontmatter, parsed as data** — not scraped from body
  prose. This is the robustness reason for files-over-checkboxes (see Alternatives).
- `tasks-decompose` writes these task files directly. **The issue-minting
  `tasks-materialize` step is removed** — decomposition produces the cards as files,
  with no GitHub API, no Projects v2, no token scope.

### Columns: three

- `Ready → Doing → Done`. Tasks flow these columns. A Spec still being authored (no
  AC yet) is pre-board; its tasks don't exist until it's decomposed.

### Gates: two (file checks)

- **Ready entry:** a task's parent Spec has a non-empty `## Acceptance Criteria`.
- **Done:** verifier green for the task's change, and the AC it satisfies is checked
  on the Spec (reviewer + verifier both run inside this single gate; no Review/Verify
  handoff columns).
- The `≥1 comment` gate is dropped.

### Skill surface: six

Keep: `spec-prepare`, `tasks-decompose`, `pair-start`, `pair-next`, `board`,
`retro`. Plus `methodology-context`, `repo-conventions`, and the
`explorer`/`reviewer`/`verifier` agents.

Removed/folded: **`epic-new`**, **`story-new`** (no tiers to create),
**`tasks-materialize`** (no issue minting — `tasks-decompose` writes task files),
**`pair-start-quick`** (folded into an adaptive `pair-start`).

## Consequences

**Positive**

- The card-per-task board the user values is **preserved** — tasks are discrete,
  movable cards.
- Task state is a **structured frontmatter field**, so reading/updating it is data
  access, not prose parsing — robust by construction.
- Epic/Story and all hierarchy-walking logic (load Story → ancestry → Epic) are
  gone; skill surface drops from 12 to 6.
- No GitHub API, Projects v2, sub-issues, or token scope in the task path.

**Negative / costs**

- One file per task means more files than a single spec-with-checkboxes — accepted;
  Done tasks can be archived if the tree gets noisy.
- `spec-prepare` must derive acceptance criteria directly from the user, not from a
  parent Story's user-level AC (a content rewrite, not just a deletion).
- No group-level AC above the Spec — mitigated by `theme:` + `roadmap.md`; revisit
  only if a genuine multi-spec-AC need appears.

## Alternatives considered

- **Tasks as checkboxes inside the Spec (card = Spec).** Rejected: it conflated
  "stop minting issues" with "stop having discrete tasks," discarded the
  card-per-task board UX the user values, and pushed task _state_ into parsed body
  prose (a silent-misread risk). File-backed cards keep the board and make state
  structured.
- **Epic/Story optional-lazy, or one grouping tier (Story).** Rejected: optionality
  is complexity, and a `theme:` tag covers grouping; group-level AC is rare enough
  solo to not justify a tier.
