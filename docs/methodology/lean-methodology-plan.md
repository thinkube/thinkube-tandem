# Lean methodology — execution plan

Planning doc (no code yet). The process-shape decisions are now locked in
**ADR-0003** (one tier, three columns, two gates); this is the execution checklist
to realise them in the bundle. Storage/engine work lives in
`files-first-kanban-plan.md` (ADR-0001).

## Locked shape (ADR-0003)

- **One work item: the Spec.** No Epic/Story. Grouping = `theme:` frontmatter tag
  + optional `roadmap.md`.
- **Tasks = checkboxes inside the spec; board card = Spec.** No materialise.
- **3 columns:** `Ready → Doing → Done` (authoring drafts are pre-board).
- **2 gates:** Ready entry = non-empty `## Acceptance Criteria`; Done = all AC
  checked + verifier green. Comment gate dropped.
- **6 skills:** `spec-prepare`, `tasks-decompose`, `pair-start`, `pair-next`,
  `board`, `retro` (+ `methodology-context`, `repo-conventions`, agents).

## Guiding principle

Strip coordination overhead (team-shaped; pure tax solo); keep the quality spine
(value independent of team size). One way to do things, not an optional second.

## Change inventory (`templates/methodology-bundle/`)

| File                          | Action                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `skills/epic-new/`            | **Remove.** No Epic tier.                                                                        |
| `skills/story-new/`           | **Remove.** No Story tier.                                                                       |
| `skills/tasks-materialize/`   | **Remove.** Tasks stay as checkboxes; nothing to mint.                                           |
| `skills/pair-start-quick/`    | **Remove** — folded into an adaptive `pair-start`.                                               |
| `skills/methodology-context/` | Rewrite: one-tier model, `theme:` grouping, 3-column table, 2-gate table; drop chunk-N language. |
| `skills/spec-prepare/`        | Derive AC **directly from the user** (no parent Story); keep four canonical sections; drop issue-mirror step. |
| `skills/tasks-decompose/`     | Keep; tasks remain checkbox rows; drop chunk-9/materialiser references.                          |
| `skills/pair-start/`          | Drop ancestry/Spec-walking; load the Spec + its tasks; adaptive (no separate quick skill).       |
| `skills/pair-next/`           | 3-column flow; reviewer+verifier in one Done gate; remove comment-as-gate; read board from files. |
| `skills/board/`               | Three columns; group by `theme:`; files-sourced.                                                |
| `skills/retro/`               | Keep (already lean).                                                                             |
| `skills/repo-conventions/`    | Keep (verifier's command source).                                                               |
| `agents/reviewer`,`verifier`  | Adjust to run within the single Done gate; `explorer` unchanged.                                |
| `CLAUDE.md`                   | Rewrite block: files-first single source of truth, one tier, 3 columns, 2 gates, `theme:` grouping. |
| `settings.json`               | Keep safe deny-list; trim `gh project`/`sub-issue` allows (no longer used).                      |
| `mcp.json`,`manifest.json`,`VERSION` | Drop removed skills from manifest; bump VERSION.                                          |

## Frontmatter changes

- Spec gains `status:` (Ready/Doing/Done) and `theme:` (string/tag).
- Drop `parent_issue` / `parent:` from the spec shape (no parent tier).
- `roadmap.md` (optional, repo-root or `.thinkube/`) for the written arc.

## Sequencing

1. **This pass = bundle prompts/shape only.** Reversible; no `src/` changes.
2. **Engine follows** (`files-first-kanban-plan.md` Phases 1–3): store `status:` +
   `theme:`, `ThinkubeFilesAdapter`, files-native MCP, 3-column/2-gate logic.
   - Coupling risk: until the engine catches up, the lean prompts describe 3
     columns / 2 gates while the MCP/panel may still enforce the old 6/3. Either
     accept temporary drift or do the prompt rewrite together with the gate/column
     engine change.

## What explicitly stays (untouched)

- The **verifier gate** — "no green = not done."
- **AC-driven specs** — the four canonical sections.
- The **`explorer` / `reviewer` / `verifier` agents**.
- **`/retro`** and **`repo-conventions`**.
- The **safe permission deny-list** (`rm -rf`, force-push, publish, …).

## Open implementation details (minor)

- Where authoring drafts (no AC) live: a pre-board "Draft" holding vs. off-board
  files surfaced by `spec-prepare`. Lean default: off-board until AC exists.
- `theme:` as free string vs. a controlled list — start free, formalise only if
  needed.
