# Lean methodology — execution plan

Planning doc (no code yet). The process-shape decisions are locked in **ADR-0003**
(Spec→Task, file-backed task cards, three columns, two gates); this is the
execution checklist to realise them in the bundle. Storage/engine work lives in
`files-first-kanban-plan.md` (ADR-0001).

## Locked shape (ADR-0003)

- **Two concrete tiers: Spec → Task.** Epic/Story removed. Grouping above the Spec
  = `theme:` frontmatter tag + optional `roadmap.md`.
- **Tasks are file-backed cards (card = Task).** Each task is a file with a
  structured `status:` field; `tasks-decompose` writes these files directly — no
  issue minting. Task state is parsed as data, not scraped from prose.
- **3 columns:** `Ready → Doing → Done` — tasks flow these. Specs being authored
  are pre-board.
- **2 gates:** Ready entry = parent Spec has non-empty `## Acceptance Criteria`;
  Done = verifier green + the satisfied AC checked. Comment gate dropped.
- **6 skills:** `spec-prepare`, `tasks-decompose`, `pair-start`, `pair-next`,
  `board`, `retro` (+ `methodology-context`, `repo-conventions`, agents).

## Guiding principle

Strip coordination overhead (team-shaped; pure tax solo); keep the quality spine
(value independent of team size). Drop the GitHub _issue_ backing, not the _card_.

## Change inventory (`templates/methodology-bundle/`)

| File                                 | Action                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills/epic-new/`                   | **Remove.** No Epic tier.                                                                                                                               |
| `skills/story-new/`                  | **Remove.** No Story tier.                                                                                                                              |
| `skills/tasks-materialize/`          | **Remove.** Issue-minting gone; `tasks-decompose` writes task files instead.                                                                            |
| `skills/pair-start-quick/`           | **Remove** — folded into an adaptive `pair-start`.                                                                                                      |
| `skills/methodology-context/`        | Rewrite: Spec→Task model, `theme:` grouping, 3-column table, 2-gate table; drop chunk-N language.                                                       |
| `skills/spec-prepare/`               | Derive AC **directly from the user** (no parent Story); keep four canonical sections; drop issue-mirror step.                                           |
| `skills/tasks-decompose/`            | Write **task files** (`status:` Ready, `parent:`, optional `depends_on`/`parallel`), not checkbox rows or issues; drop chunk-9/materialiser references. |
| `skills/pair-start/`                 | Drop Epic/Story ancestry; load the Spec + its task cards; adaptive (no separate quick skill).                                                           |
| `skills/pair-next/`                  | 3-column flow over task cards; reviewer+verifier in one Done gate; remove comment-as-gate; read board from files.                                       |
| `skills/board/`                      | Three columns of task cards; group by Spec / `theme:`; files-sourced.                                                                                   |
| `skills/retro/`                      | Keep (already lean).                                                                                                                                    |
| `skills/repo-conventions/`           | Keep (verifier's command source).                                                                                                                       |
| `agents/reviewer`,`verifier`         | Adjust to run within the single Done gate; `explorer` unchanged.                                                                                        |
| `CLAUDE.md`                          | Rewrite block: files-first source of truth, Spec→Task, file-backed cards, 3 columns, 2 gates, `theme:` grouping.                                        |
| `settings.json`                      | Keep safe deny-list; trim `gh project`/`sub-issue` allows (no longer used).                                                                             |
| `mcp.json`,`manifest.json`,`VERSION` | Drop removed skills from manifest; bump VERSION.                                                                                                        |

## Frontmatter / layout changes

- **Task** (new file kind), e.g. `.thinkube/tasks/T-{n}.md`: `status:`
  (Ready/Doing/Done), `parent:` (Spec id), optional `depends_on:` / `parallel:`;
  body = task description.
- **Spec** (`.thinkube/specs/SP-{n}.md`): gains `theme:` (string/tag). Keeps the
  four canonical sections. Drop GitHub `parent_issue`.
- `roadmap.md` (optional) for the written arc.

## Sequencing

1. **This pass = bundle prompts/shape only.** Reversible; no `src/` changes.
2. **Engine follows** (`files-first-kanban-plan.md` Phases 1–3): store gains a
   `task` kind + `status:`/`theme:`, `ThinkubeFilesAdapter` reads task files as
   cards, files-native MCP, 3-column/2-gate logic.
   - Coupling risk: until the engine catches up, the lean prompts describe 3
     columns / 2 gates over task files while the MCP/panel may still enforce the old
     6/3 over issues. Either accept temporary drift or do the prompt rewrite together
     with the gate/column engine change.

## What explicitly stays (untouched)

- The **verifier gate** — "no green = not done."
- **AC-driven specs** — the four canonical sections.
- **Card-per-task** — preserved, now file-backed.
- The **`explorer` / `reviewer` / `verifier` agents**.
- **`/retro`** and **`repo-conventions`**.
- The **safe permission deny-list** (`rm -rf`, force-push, publish, …).

## Open implementation details (minor)

- Task file location: flat `.thinkube/tasks/T-{n}.md` (matches the existing per-kind
  dir pattern) vs nested `.thinkube/specs/SP-{n}/tasks/`. Lean default: flat with
  `parent:`.
- Archiving Done tasks to keep the tree lean (e.g. `.thinkube/tasks/archive/`).
- `theme:` as free string vs. a controlled list — start free, formalise only if
  needed.
