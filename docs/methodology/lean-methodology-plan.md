# Lean methodology — simplification plan

Planning doc (no code yet). Companion to ADR-0001 (files-first source of truth)
and ADR-0002 (no RAG). This one is about the **process shape** — tiers, columns,
gates, ceremony — independent of where the data lives.

## Guiding principle

Separate the bundle's machinery into two piles and treat them differently:

- **Coordination overhead** — cost scales with team size; for a team of one
  (human + Claude) it is pure tax. _Strip it from the default path; make it
  opt-in for teams._
- **Quality machinery** — value is independent of team size. _Keep all of it._

The methodology was built on an agile/scrum skeleton, which is team-shaped by
origin. The stated user is a solo developer. Leaning = removing the team skeleton
without touching the quality spine.

## Current weight (inventory)

| Dimension          | Today                                                                 | Solo cost                                            |
| ------------------ | --------------------------------------------------------------------- | --------------------------------------------------- |
| Tiers              | 4 mandatory: Epic → Story → Spec → Task, filled top-down              | High — deep vocabulary held at once; top-down gating |
| Columns            | 6: Spec / Ready / In Progress / Review / Verify / Done                | Medium — Review/Verify are a person-to-person handoff |
| Gates              | 3: Spec→Ready (AC), In-Progress→Review (≥1 comment), Review→Verify (AC)| Comment gate = async-handoff artifact, no reader solo |
| Materialise        | `SP-n-tasks.md` → one GitHub issue per 1–3h task                       | High — issue-per-task is for assignment/visibility    |
| Source of truth    | GitHub Issues + Projects v2 (per ADR-0001, moving to files)           | (addressed by ADR-0001)                              |
| Skills surface     | 12 skills incl. `epic-new`, `story-new`, `tasks-materialize`           | Several only exist to feed the team scaffolding       |
| Language           | Leaky internal refs: "chunk-11 gate", "chunk-9 materialiser", "SP-86" | Confusing in an installed bundle; no external meaning |

## Target lean shape

Marked **[settled]** (already decided in ADRs / conversation) or **[ratify]**
(open — see "Decisions to ratify").

### Tiers: 4 mandatory → 2 default, 2 optional **[ratify]**

- Default entry is the **Spec**; tasks hang off it. `Spec → Task`.
- Epic/Story become **optional, lazy, retroactive grouping** — created only when a
  multi-spec theme actually emerges, not as up-front scaffolding. They are *not*
  deleted (they carry cross-time re-orientation value even solo).
- Flow inverts from **top-down (fill the hierarchy first)** to **bottom-up
  (start at the spec, crystallize structure upward on demand)**.

### Columns: 6 → 3 **[ratify]**

- `Ready → Doing → Done`.
- **Review + Verify collapse into one gate into Done** — both *checks* still run
  (reviewer surfaces AC/logic gaps; verifier runs tests/lint/typecheck), but
  there is no handoff *column* between them, because there is no one to hand to.

### Gates: 3 → 2 **[settled, ADR-0001]**

- Spec→Ready: non-empty `## Acceptance Criteria` (file check).
- Doing→Done: all AC checked **and** verifier green (file check + verifier).
- **Drop the `≥1 comment` gate** entirely.

### Ceremony **[settled / ratify]**

- **Drop materialise-to-issues** — tasks stay as checkbox rows in the spec's tasks
  file (task-as-card vs task-as-checkbox is **[ratify]**, see decisions).
- **`/pair-start-quick` behavior becomes the default `/pair-start`**; the full
  Epic→Story ceremony moves behind an explicit flag/skill. **[ratify]**

### Language **[settled]**

- Scrub `chunk-11`, `chunk-9 materialiser`, `SP-86` and similar internal
  milestone references from all user-facing skill text → behaviour-named gates
  ("the Spec→Ready gate", "spec-staleness").
- Reframe the CLAUDE.md methodology block to files-first single source of truth
  (drop "GitHub Issues source of truth" / "Projects v2 state machine").

## Change inventory (file by file — `templates/methodology-bundle/`)

| File                              | Action                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `CLAUDE.md`                       | Rewrite block: files-first, 2-default tiers, 3 columns, 2 gates, scrub internal refs     |
| `skills/methodology-context/`     | Update hierarchy table, six-column table → three, gates table, drop chunk-N language      |
| `skills/spec-prepare/`            | Spec as default entry; drop optional issue-mirror step; keep four canonical AC sections   |
| `skills/tasks-decompose/`         | Keep; tasks remain checkbox rows; drop chunk-9 materialiser references                    |
| `skills/tasks-materialize/`       | **Retire or repurpose** (no issue minting) — see decisions                                |
| `skills/pair-start/`              | Fold quick-path in as default; gate full ceremony **[ratify]**                            |
| `skills/pair-start-quick/`        | Merge into `pair-start` or keep as alias **[ratify]**                                     |
| `skills/pair-next/`               | Remove comment-as-gate-satisfier; merged Review+Verify; read board from files             |
| `skills/epic-new/`, `story-new/`  | Reframe as optional grouping; possibly fold into one `/group` skill **[ratify]**          |
| `skills/board/`                   | Three columns; files-sourced                                                              |
| `skills/retro/`                   | Keep (already lean)                                                                       |
| `skills/repo-conventions/`        | Keep; it's the verifier's command source                                                  |
| `agents/explorer`,`reviewer`,`verifier` | Keep; adjust reviewer/verifier to run within the single merged gate                 |
| `settings.json`                   | Keep safe deny-list; trim `gh project`/`sub-issue` allows once GitHub is optional         |
| `mcp.json`, `manifest.json`, `VERSION` | Update manifest if files added/removed; bump VERSION                                  |

## Sequencing

1. **This pass = prompts/shape only** (the "Bundle/prompts only" scope). Rewrites
   the methodology's described shape; reversible; no `src/` engine changes.
2. **Engine follows** via Phases 1–3 of `files-first-kanban-plan.md` (store,
   adapter, files-native MCP, gate/column logic) so the running engine matches.
   - Note the coupling risk: until the engine catches up, the lean prompts
     describe a 3-column / 2-gate model while the MCP/panel may still enforce 6/3.
     Either accept temporary drift, or pair the prompt rewrite with the gate/column
     engine change (the "Bundle + gate/column engine" scope).

## Decisions to ratify (before any coding)

1. **Tiers** — 2 default with Epic/Story optional-lazy (recommended), or keep 4 as
   lazy-but-present?
2. **Columns** — collapse to 3 (Ready/Doing/Done, recommended), or keep Review as a
   distinct column and only drop its comment gate?
3. **Task granularity** — tasks as **checkboxes** inside the spec (leanest,
   recommended) vs tasks as **individual board cards** (more board motion). This is
   the open question from the design chat; it also decides whether the board card =
   Spec or = Task.
4. **`pair-start` / `pair-start-quick`** — merge into one adaptive skill
   (recommended) or keep both?
5. **`epic-new` / `story-new`** — keep as optional skills, or fold into a single
   retroactive `/group` skill?
6. **`tasks-materialize`** — retire entirely, or repurpose to "expand checkboxes
   into task files" (only if decision 3 picks task-as-file)?

## What explicitly stays (not touched by the lean pass)

- The **verifier gate** — "no green = not done." The single best idea; untouched.
- **AC-driven specs** — the four canonical sections remain load-bearing.
- The **`explorer` / `reviewer` / `verifier` agents** — context + quality tools,
  not coordination.
- **`/retro`** journaling and **`repo-conventions`**.
- The **safe permission deny-list** (`rm -rf`, force-push, publish, etc.).

> Once decisions 1–6 are ratified, the settled ones can be promoted into an
> **ADR-0003 (lean process shape)** to match the ADR-0001/0002 record, and this
> doc becomes the execution checklist.
