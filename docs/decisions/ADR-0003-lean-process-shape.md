---
kind: decision
id: ADR-0003
title: Lean process shape — Spec→Slice with file-backed cards, three columns, two gates
status: accepted
created: 2026-06-03
repo: thinkube/thinkube-ai-integration
---

# ADR-0003 — Lean process shape: Spec→Slice, file-backed cards, three columns, two gates

## Status

Accepted — 2026-06-03. Builds on ADR-0001 (files-first) and ADR-0002 (no RAG).

- Supersedes an earlier draft that proposed checkbox tasks (see "Alternatives").
- **Revised 2026-06-03:** the work unit is renamed **Task → Slice** and resized from
  a fixed 1–3h to **coherence-sized** (see "The work unit").

Revisitable.

## Context

The methodology was built on an agile/scrum skeleton — team-shaped by origin — but
the user is a solo developer (human + Claude). ADR-0001 moved the source of truth to
committed files. This ADR addresses the remaining weight: the _process shape_ (tiers,
columns, gates, ceremony, skill surface).

**Tiers.** The deciding insight: **"optional" tiers are themselves complexity.**
Keeping Epic/Story as optional adds a decision point, forces two code paths in every
hierarchy-walking skill, and keeps extra vocabulary you must understand in order to
skip. So Epic and Story are removed outright.

**Work-unit representation.** Dropping the GitHub _issue_ backing for the unit does
not require dropping the _card_ — those were initially conflated. The card-per-unit
board is valued and is fully compatible with files-first: a unit can be a discrete
**file** with a `status:` field — a structured record, not text scraped from prose.

**Work-unit size and name.** The original 1–3h sizing is vestigial team machinery:
clock-sizing exists for _estimation_ (sprint velocity, capacity), which Tandem does
not do. So units are sized by **coherence, not duration**. And "task" connotes a tiny
to-do, which fights that — so the unit is renamed **Slice** (a coherent end-to-end
piece of working change).

## Decision

**Two concrete tiers — Spec → Slice — with slices as file-backed cards, three
columns, and two file-checked gates. Grouping above the Spec is metadata, not a
tier.**

### Hierarchy: Spec → Slice (Epic/Story removed)

- The **Spec** is the documented work unit — acceptance criteria, design, file plan.
  It is the _parent/document_, not a board card.
- The **Slice** is a coherent piece of work under a Spec, a discrete **file**, and the
  thing that **flows the board**.
- **Epic and Story are removed entirely.** Grouping above the Spec is a `theme:`
  frontmatter tag plus an optional one-paragraph `roadmap.md`. Both tiers are concrete
  and non-optional, so they don't reintroduce the optionality complexity Epic/Story
  did.

### The work unit: a Slice (card = Slice)

- Each slice is a file, e.g. `.thinkube/slices/SL-{n}.md`, with structured
  frontmatter: `status:` (Ready/Doing/Done), `parent:` (the Spec id), and optional
  `depends_on:` / `parallel:`. The body holds the slice description.
- **Sized by coherence, not the clock.** A slice is _one coherent change that you
  verify-and-commit as a single "done" — one green._ It may be an hour or a couple of
  days. There is no time target.
- **Bounds** (replacing the old clock ceiling/floor):
  - If you can't state a single "done" for it → it's more than one slice; split it.
  - If it has its own distinct acceptance criteria / design → it's not a slice, it's a
    **Spec**.
- **Task state lives in frontmatter, parsed as data** — not scraped from body prose.
- The `/slice` skill writes these files directly. **No issue minting** — no GitHub
  API, Projects v2, or token scope.

### Columns: three

- `Ready → Doing → Done`. Slices flow these columns. A Spec still being authored (no
  AC yet) is pre-board; its slices don't exist until it's sliced.

### Gates: two (file checks)

- **Ready entry:** a slice's parent Spec has a non-empty `## Acceptance Criteria`.
- **Done:** verifier green for the slice's change, and the AC it satisfies is checked
  on the Spec (reviewer + verifier both run inside this single gate; no Review/Verify
  handoff columns). The slice _is_ the verification boundary — "one green."
- The `≥1 comment` gate is dropped.

### Skill surface: six

Keep: `spec-prepare`, `slice` (was `tasks-decompose`), `pair-start`, `pair-next`,
`board`, `retro`. Plus `methodology-context`, `repo-conventions`, and the
`explorer`/`reviewer`/`verifier` agents.

Removed/folded: **`epic-new`**, **`story-new`** (no tiers to create),
**`tasks-materialize`** (no issue minting — `/slice` writes slice files),
**`pair-start-quick`** (folded into an adaptive `pair-start`).

## Consequences

**Positive**

- The card-per-unit board the user values is **preserved** — slices are discrete,
  movable cards.
- **Coherence-sizing ends artificial fragmentation** — you no longer split work to hit
  a time box; you split only when it stops being one coherent "done."
- "Slice" sheds the "tiny to-do" connotation of "task" that drove the over-splitting.
- State is a **structured frontmatter field** — data access, not prose parsing.
- Epic/Story and all hierarchy-walking logic are gone; skill surface drops from 12 to 6. No GitHub API in the slice path.

**Negative / costs**

- Without a clock bound, slices could sprawl — bounded instead by the coherence rule
  ("one stated done"; "own AC → it's a Spec").
- One file per slice means more files than a single spec-with-checkboxes — accepted;
  Done slices can be archived if the tree gets noisy.
- `spec-prepare` derives acceptance criteria directly from the user, not from a parent
  Story (a content rewrite, not just a deletion).
- No group-level AC above the Spec — mitigated by `theme:` + `roadmap.md`.

## Alternatives considered

- **Tasks as checkboxes inside the Spec (card = Spec).** Rejected: conflated "stop
  minting issues" with "stop having discrete cards," discarded the card-per-unit board
  UX, and pushed state into parsed body prose.
- **A bigger _fixed_ size (e.g. half-day/day units).** Rejected: any clock target is
  arbitrary; coherence ("one verifiable done") is the right axis, and it floats.
- **Keep the name "Task" (resized).** Rejected: "task" keeps tugging toward tiny
  to-dos, which is the exact over-splitting we're removing.
- **Epic/Story optional-lazy, or one grouping tier (Story).** Rejected: optionality is
  complexity; a `theme:` tag covers grouping.
