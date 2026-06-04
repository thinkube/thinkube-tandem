---
description: Tandem methodology vocabulary, hierarchy, and workflow. Loaded on demand by other bundle skills; not user-invocable.
disable-model-invocation: true
allowed-tools: []
thinkube-bundle: 0.0.1
---

# Tandem methodology context

A reference document loaded by other bundle skills (`/spec-prepare`, `/slice`, `/pair-start`, `/pair-next`, `/board`, `/retro`) when they need to ground themselves in the shared vocabulary. Don't invoke directly.

**Tandem** is a development methodology designed from scratch for a single human + one AI pair on a git repo. Two axioms shape everything below:

1. The team is **one human (navigator) + one AI (driver)** — not a group of humans.
2. The **committed git repo is the single source of truth _and_ the board**.

Consequences: the entire artifact set — specs, slices, decisions, retros — lives as committed `.thinkube/` markdown files, host-agnostic (Gitea, GitHub, or offline; reinstall recovery is `git clone`). There is **no external issue tracker in the core loop**, and "done" is defined by an **automated verifier**, not human sign-off.

## Hierarchy: Spec → Slice

Two concrete tiers. Grouping above a Spec is a `theme:` frontmatter tag (plus an optional one-paragraph `.thinkube/roadmap.md`) — not a tier.

| Tier  | Lives at                           | Card?                 | Purpose                                                                              |
| ----- | ---------------------------------- | --------------------- | ------------------------------------------------------------------------------------ |
| Spec  | `.thinkube/specs/SP-{n}/spec.md`   | No — the document     | The documented unit of work: acceptance criteria, constraints, design, file plan.    |
| Slice | `.thinkube/specs/SP-{n}/SL-{m}.md` | Yes — flows the board | One coherent end-to-end change you verify-and-commit as a single "done" (one green). |

- A **Slice** is **vertical** — a coherent end-to-end behaviour that, once green, is demonstrable on its own — **not a layer or file** ("add the Redis store" is a fragment of a slice, not a slice). A slice is **not** a renamed atomic task; slicing by layer/file recreates the tiny-task soup the unit exists to prevent.
- A **Slice** is sized by **coherence, not the clock**. Bounds: if you can't state a single "done" for it → it's more than one slice, split it; if it has its own distinct acceptance criteria / design → it's not a slice, it's a **Spec**.
- A spike / investigation / "confirm X" with no verifiable output is **not a slice** (it has no single "done") — it belongs in the parent Spec's `## Design` / `## Constraints`.

## Card handle

The canonical handle for a slice is **`SP-{n}_SL-{m}`** — e.g. `SP-3_SL-42` — hyphen _within_ each id, underscore _joins_ them. Used identically in the filename, the board chip, your instructions ("work on `SP-3_SL-42`"), and my references back.

- Slices are numbered **per-Spec**: `SL-1`, `SL-2`… restart within each Spec, so a new Spec starts at `SL-1` and numbers stay small.
- Handles are **per-repo** — each repo's board has its own `SP-`/`SL-` sequences. `SP-3_SL-42` is unique within a board; across repos, qualify by repo ("`SP-3_SL-42` in the extension").

## Slice file shape

```
---
uid: <stable-internal-id>          # never changes; the board's own link key
parent: SP-3                       # the parent Spec
status: ready | doing | done | archived
theme: <optional grouping tag>
due: <optional yyyy-mm-dd>
priority: <optional P0|P1|P2|P3>
verified_req_hash: <stamped by /pair-next on verify>
depends_on: [SP-3_SL-7]            # optional
parallel: true                     # optional
---

{slice description — what the one coherent change is}
```

- `status:` **is** the board column — parsed as data, not scraped from prose.
- **Identity is the `uid`** (stable forever; the board links on it); the **handle `SP-{n}_SL-{m}`** is the human reference. Reparenting a slice renumbers its handle but not its `uid`.
- **Numbers are never reused.** A finished or abandoned slice is **archived** (`status: archived`, file kept) — never deleted — so the per-Spec `max+1` allocator can't collide.

## Spec body shape (canonical)

The four section headers are load-bearing — the quality gates and the staleness hash look for them by name:

```
# {spec title}

{one-paragraph summary}

## Acceptance Criteria

- [ ] criterion 1
- [ ] criterion 2

## Constraints

- perf / compat / security / deadline constraints

## Design

{1–3 paragraphs: approach + key data structures + integration seams}

## File Structure Plan

- `path/to/file.ts` — why
```

Acceptance criteria are elicited from the **user** during `/spec-prepare` — there is no parent Story to inherit them from.

## Three-column workflow

| Column | Meaning                                                                         |
| ------ | ------------------------------------------------------------------------------- |
| Ready  | The parent Spec is complete (gate passes); the slice is available to pull.      |
| Doing  | The pair is actively working this slice. Keep **one slice in flight per Spec**. |
| Done   | Verifier green for the slice, and the AC it satisfies is checked on the Spec.   |

A Spec still being authored (no AC yet) is pre-board; its slices don't exist until it's sliced.

## Quality gates (two; file checks)

| Transition      | Gate                                                                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| → Ready (entry) | The slice's parent Spec has a non-empty `## Acceptance Criteria`.                                                                                                                   |
| → Done          | Verifier green for the slice's change, and the AC it satisfies is checked on the Spec. **Reviewer + verifier both run inside this single gate** — no Review/Verify handoff columns. |

The slice **is** the verification boundary — "one green." (The old "≥1 comment" gate is gone: there is no second human to hand off to.)

## Spec staleness (re-verify semantics)

A `done` slice goes **stale** when its parent Spec changes **substantively**:

- **`requirements` (substantive — marks slices stale):** edits to the Spec's `## Acceptance Criteria` text, `## Design`, or `## Constraints`.
- **`metadata` (non-substantive — never stale):** `status:`/column moves, theme/priority/due edits, **and AC checkbox toggles** (`- [ ]` ↔ `- [x]`) — which record completion, not a requirement change.

Staleness is a normalized hash of the Spec's requirement sections with checkbox state stripped. `/pair-next` stamps each verified slice with the spec requirement-hash it validated against (`verified_req_hash:` in the slice's frontmatter); a slice is stale when the current hash differs. A slice with no baseline is never flagged.

`/pair-next` resolves substantively-stale slices **before** starting the next one: after advancing the finished slice, it sweeps the active Spec, re-runs the `verifier` against the current Spec, and re-opens any stale slice. `/pair-start` surfaces stale slices when it loads a Spec's context.

## Per-project board

Each repository owns its own committed `.thinkube/` board — the **repo _is_ the project** (in our lexicon). A repo is methodology-enabled **iff it has a committed `.thinkube/` directory**: there is no settings registry, and the extension never auto-enables. The **workspace navigator** discovers the repos across the open workspace folders and lets you move between the enabled boards.

## Pair modes

- `navigator`: AI reads + proposes only; the human writes the board/files.
- `driver`: AI is leading; both can write.
- `both` (default): either party can write at will.

## Write authority

Inside an invoked skill, board bookkeeping — moving cards, checking the AC a slice satisfies, stamping provenance/verification — is the **AI's job**: it does it and **reports the result with evidence**. The human steers substance and **intervenes by exception**; the AI never asks the human to move a card or re-invoke a command merely to advance mechanics, and stops only at a marked **bless point**, a **gate refusal**, or a **failed precondition**. (In `navigator` mode this inverts per mode awareness — the AI proposes, the human writes.)

## Slice creation (`/slice`)

`/slice` decomposes a Spec into coherent slices, writing individual `.thinkube/specs/SP-{n}/SL-{m}.md` files **directly** — no issue minting, no checkbox-list intermediate, no GitHub API. It allocates the next per-Spec `SL-{m}` and refuses rows that have no single verifiable "done" (those go in the Spec, not on the board).

## Subagents

- **explorer** — read-only research: "what's in this codebase / how does it work today." Returns `file:line`; refuses any write.
- **reviewer** — adversarial diff review against the Spec's acceptance criteria.
- **verifier** — runs the repo's verification (per `repo-conventions` — tests, or `tsc --noEmit` + build where there's no suite). Gates a slice's move to **Done**.
