---
description: Thinkube methodology vocabulary, hierarchy, and workflow. Loaded on demand by other bundle skills; not user-invocable.
disable-model-invocation: true
allowed-tools: []
thinkube-bundle: 0.0.1
---

# Thinkube methodology context

This is a reference document loaded by other bundle skills (`/epic-new`, `/spec-prepare`, `/pair-start`, etc.) when they need to ground themselves in the shared vocabulary. Don't invoke directly.

## Hierarchy

Four tiers, each backed by a GitHub issue type plus a `.thinkube/` markdown sidecar:

| Tier  | Issue type | Sidecar                           | Purpose                                                          |
| ----- | ---------- | --------------------------------- | ---------------------------------------------------------------- |
| Epic  | `Epic`     | `.thinkube/epics/EP-{n}.md`       | A multi-week initiative. Outcome-shaped, not feature-shaped.     |
| Story | `Story`    | `.thinkube/stories/ST-{n}.md`     | A single deliverable slice. User-observable acceptance criteria. |
| Spec  | `Spec`     | `.thinkube/specs/SP-{n}.md`       | The technical "how" for one Story slice. Standard four sections. |
| Task  | `Task`     | (no sidecar; lives as issue body) | 1–3 hours of focused work. Goes through the six-column workflow. |

Specs additionally have a `.thinkube/specs/SP-{n}-tasks.md` sibling holding the decomposition (checkbox list → materialised Tasks).

## Spec body shape (canonical)

The four section headers are load-bearing — chunk-11 quality gates and MCP tools look for them by name:

```
# {spec title}

{one-paragraph summary}

## Acceptance Criteria

- [ ] technical criterion 1
- [ ] technical criterion 2

## Constraints

- perf / compat / security / deadline constraints

## Design

{1–3 paragraphs: approach + key data structures + integration seams}

## File Structure Plan

- `path/to/file.ts` — why
- `path/to/other.tsx` — why
```

## Six-column workflow

| Column      | Meaning                                                                          |
| ----------- | -------------------------------------------------------------------------------- |
| Spec        | Spec issue exists but body isn't ready. Run `/spec-prepare` to fill it.          |
| Ready       | Spec is complete (gates pass); Tasks materialised, available to pull.            |
| In Progress | A pair is actively working on this Task.                                         |
| Review      | Code written, awaiting reviewer subagent / human review. Comment required.       |
| Verify      | Reviewed, awaiting verifier subagent (tests + lint + typecheck). All AC checked. |
| Done        | Shipped or merged.                                                               |

## Quality gates (chunk-11, blocking on drag)

| Transition           | Gate                                                          |
| -------------------- | ------------------------------------------------------------- |
| Spec → Ready         | Spec body has a non-empty `## Acceptance Criteria` checklist. |
| In Progress → Review | At least one comment on the issue (work summary).             |
| Review → Verify      | All acceptance criteria in the parent Spec checked.           |

## Spec staleness (re-verify semantics)

A Task past In Progress goes **stale** when its parent Spec changes _substantively_. The MCP exposes `specStale` (bool) and `specChange` (`none | metadata | requirements`) per Task; the kanban shows a `⚠ spec changed — re-verify` badge.

The substantive-vs-metadata distinction governs staleness:

- **`requirements` (substantive — marks Tasks stale):** edits to the Spec's `## Acceptance Criteria` text, `## Design`, or `## Constraints`.
- **`metadata` (non-substantive — never marks Tasks stale):** issue-type assignment, label add/remove, sub-issue link, status/column move, comments — **and AC checkbox toggles** (`- [ ]` ↔ `- [x]`), which record completion, not a requirement change.

Staleness is a normalized hash of the Spec's requirement sections with checkbox state stripped. `/pair-next` stamps each Task with the spec-hash it verified against; a Task is stale when the current requirement-hash differs. A Task with no baseline is never flagged.

`/pair-next` resolves substantively-stale Tasks **before** starting the next Task: after advancing the finished Task, it sweeps the active Story, re-runs the `verifier` against the current Spec, and moves any stale Task back / re-opens its ACs. `/pair-start` surfaces substantively-stale Tasks when loading a Story.

## Pair modes

- `navigator`: AI reads + proposes only. Human is the driver; MCP write tools refuse.
- `driver`: AI is leading. Both human and AI can write the board.
- `both` (default): either party can write at will.

## Tasks-list format (the `SP-{n}-tasks.md` file)

GitHub-flavoured checkboxes. One task per line.

- `- [ ] <title>` — pending
- `- [x] <title>` — already materialised or completed
- `- [ ] (P) <title>` — parallel-eligible with siblings
- `- [ ] <title> → depends-on: 3` — references row 3 by 1-based index

The chunk-9 materialiser flips `[ ]` to `[x]` after creating each Task issue, making re-runs idempotent.

## Subagents

Three named agents the bundle ships, used by `/pair-*` skills to keep the main context lean:

- **explorer** — read-only research. Use when the question is "what's currently in this codebase / how does it work today". Returns file:line references; refuses any write.
- **reviewer** — adversarial diff review. Use during Review column to surface concerns against the Spec's acceptance criteria.
- **verifier** — runs tests, lint, typecheck. Gates Review→Verify and is the final check before claiming a Task is done.
