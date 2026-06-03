---
kind: decision
id: ADR-0003
title: Lean solo-first process shape — one tier, three columns, two gates
status: accepted
created: 2026-06-03
repo: thinkube/thinkube-ai-integration
---

# ADR-0003 — Lean process shape: one tier, three columns, two gates

## Status

Accepted — 2026-06-03. Builds on ADR-0001 (files-first) and ADR-0002 (no RAG).
Decided under delegation; revisitable.

## Context

The methodology was built on an agile/scrum skeleton — team-shaped by origin —
but the user is a solo developer (human + Claude). ADR-0001 already moved the
source of truth to committed files. This ADR addresses the remaining weight: the
*process shape* (tiers, columns, gates, ceremony, skill surface).

The deciding insight: **"optional" tiers are themselves complexity.** Keeping
Epic/Story as optional adds a decision point ("is this big enough for a Story?"),
forces two code paths in every hierarchy-walking skill, and keeps a four-word
vocabulary you must understand in order to skip. Optionality is two systems in one
coat; a lean system has one way to do things.

## Decision

**Collapse to a single work-item tier with checklist tasks, three columns, and
two file-checked gates. Grouping is metadata, not a tier.**

### Hierarchy: one tier

- The **Spec** is the only work item — a deliverable unit carrying acceptance
  criteria and a task checklist. **Epic and Story are removed entirely** (not made
  optional).
- **Grouping is a `theme:` frontmatter tag** (e.g. `auth`, `billing`) plus an
  optional one-paragraph `roadmap.md`. The board/roadmap groups specs by `theme:`.
- Accepted tradeoff: there is no place for *group-level* acceptance criteria (a
  tag can't hold AC). Solo, AC lives at the spec level; the tag + roadmap cover
  "show me everything about X" and "what's the arc."

### Tasks: checkboxes, card = Spec

- Tasks are checkbox rows inside the spec's tasks file; the **board card is the
  Spec**, with checklist progress shown on the card.
- No per-task issues or files. **`tasks-materialize` is retired.**

### Columns: three

- `Ready → Doing → Done`. A spec still being authored (no AC yet) is a pre-board
  draft, not a column.

### Gates: two (file checks)

- **Ready entry:** spec has a non-empty `## Acceptance Criteria`.
- **Done:** all AC checked **and** verifier green (reviewer + verifier both run
  inside this single gate; no Review/Verify handoff columns).
- The `≥1 comment` gate is dropped.

### Skill surface: six

Keep: `spec-prepare`, `tasks-decompose`, `pair-start`, `pair-next`, `board`,
`retro`. Plus `methodology-context`, `repo-conventions`, and the
`explorer`/`reviewer`/`verifier` agents.

Removed/folded: **`epic-new`**, **`story-new`** (no tiers to create),
**`tasks-materialize`** (no issue minting), **`pair-start-quick`** (folded into an
adaptive `pair-start`).

## Consequences

**Positive**

- One path, one vocabulary word for the unit of work. The deepest cognitive tax —
  holding a four-tier hierarchy and deciding where work belongs — is gone.
- Hierarchy-walking logic (load Story → ancestry → Epic) vanishes from every skill.
- The skill surface drops from 12 to 6; the board has far fewer cards.

**Negative / costs**

- `spec-prepare` must derive acceptance criteria directly from the user, not from a
  parent Story's user-level AC (a content rewrite, not just a deletion).
- No nested planning hierarchy and no group-level AC — mitigated by `theme:` +
  `roadmap.md`; revisit only if a genuine multi-spec-AC need appears.
- Existing GitHub-backed boards with Epics/Stories would need a one-off flattening
  if ever migrated (out of scope).

## Alternatives considered

- **Two tiers (Spec→Task) with Epic/Story optional-lazy.** Rejected: optionality is
  complexity (the decision point + branching + retained vocabulary it was meant to
  avoid).
- **One grouping tier (Story + Spec).** Rejected: a `theme:` tag covers grouping;
  group-level AC is rare enough solo to not justify a whole tier.
