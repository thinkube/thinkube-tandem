---
description: Decompose a Spec into coherent Slices, writing individual .thinkube/specs/SP-{n}/SL-{m}.md files directly. Each slice is one verifiable end-to-end change.
allowed-tools:
  [
    "Read",
    "Write",
    "Edit",
    "Grep",
    "Glob",
    "mcp__thinkube-kanban__list_board",
    "mcp__thinkube-kanban__get_slice",
    "mcp__thinkube-kanban__get_thinkube_file",
    "Task",
  ]
argument-hint: "<spec-number>"
thinkube-bundle: 0.0.1
---

# /slice

Read a fully-shaped Spec and cut it into **coherent slices** — each one an end-to-end change you can verify-and-commit as a single "done." Each slice is written **directly** as its own file at `.thinkube/specs/SP-{n}/SL-{m}.md` with `status: ready`. There is no checkbox-list intermediate, no materialiser, no issue minting — the files _are_ the board.

## Mission

Write one `.thinkube/specs/SP-{n}/SL-{m}.md` file per slice, where each slice:

- Is **one coherent end-to-end change** with a single statable "done" (one green from the verifier).
- Reads as imperative work ("Wire OAuth callback handler", "Add Redis session store"), not as an outcome ("Auth works").
- Lands at `status: ready`, `parent: SP-{n}`, with a stable `uid` and a one-line title/body describing the change.
- Traces back to the Spec's `## Acceptance Criteria` — every AC maps to at least one slice.

Slices are sized by **coherence, not the clock**. If you can't state a single "done" for a row, it's more than one slice — split it. If a row has its own distinct acceptance criteria / design, it's not a slice — it's another Spec.

## Inputs

- `$ARGUMENTS`: the Spec number `{n}` (integer).

## Procedure

0. **Detect re-slicing (the Spec changed under existing slices).** If `.thinkube/specs/SP-{n}/` already holds `SL-*.md` files, this is a **change-review**, not a fresh decomposition — the board flags this with a stale badge (`specStale` / `specChange: "requirements"`) on done slices whose parent Spec was edited after they were verified. Do NOT overwrite blindly:
   - Read the existing slice files (`get_slice` per handle, or `get_thinkube_file specs/SP-{n}/SL-{m}.md`) and their `status:` (`ready` / `doing` / `done` / `archived`).
   - Re-derive slices from the Spec's **current** Acceptance Criteria, then diff against what exists, classifying each as **keep** (still maps to an AC), **add** (an AC has no covering slice), or **obsolete** (no longer maps to any AC).
   - **The action depends on the slice's status — never react uniformly:**
     | Status | Action on change |
     | --- | --- |
     | ready (not started) | revise / add / archive freely |
     | doing | do **not** edit or archive — flag it; ask the user whether to keep, rescope, or set back to ready |
     | done | leave it; if the change implies more work, propose a **new** slice. If it went substantively stale, let `/pair-next`'s sweep re-verify it — don't silently rewrite it here. |
   - To retire an obsolete slice, set its frontmatter `status: archived` (keep the file — numbers are never reused). Don't delete.
   - Present the keep/add/archive diff **annotated with each slice's status and the recommended action**; get the user's blessing before writing.
1. **Read methodology context** + `repo-conventions` for branch/commit rules that may influence slice ordering.
2. **Load the Spec.** Use `get_thinkube_file specs/SP-{n}/spec.md` for the full body. If the spec is missing the four canonical sections (Acceptance Criteria / Constraints / Design / File Structure Plan), **stop** and direct the user to `/spec-prepare {n}` first.
3. **Brainstorm slices privately.** Working through the Design + File Structure Plan, draft candidate slices. For each, check:
   - Can you state a **single "done"** for it (one green)? If not, it's more than one slice — split it.
   - Does it have its own distinct AC / design? Then it's a **Spec**, not a slice — surface that to the user.
   - Is it a spike / investigation / "confirm X" with no verifiable output? Then it is **not a slice** — it belongs in the parent Spec's `## Design` / `## Constraints`. Don't write a file for it.
   - Does it depend on another slice? Note it for `depends_on`.
4. **Map back to acceptance criteria.** For each AC line, identify which slice(s) satisfy it. If an AC is unmatched, add a slice. If a slice isn't traceable to any AC, drop it (or surface the gap — the AC may be missing).
5. **Propose in chat.** Show the proposed slice list with rationale and the SL numbers you'll allocate. Wait for user feedback.
6. **Allocate numbers + write files.** Slices are numbered **per-Spec**. The next number is `max(existing SL-{m} under SP-{n}) + 1` — and **archived files keep their numbers**, so include them in the max. A brand-new Spec starts at `SL-1`. For each agreed slice, `Write` a file at `.thinkube/specs/SP-{n}/SL-{m}.md`:

```
---
uid: <stable-internal-id>      # e.g. a short slug or generated id; never reused
parent: SP-{n}
status: ready
depends_on: [SP-{n}_SL-7]      # optional, omit if none
priority: P2                   # optional
---

<slice title> — <one-line description of the one coherent change>
```

7. **Report.** Print the slice count and the next step: `/pair-start {n}` to begin working them.

## Constraints

- Slices are **work items with one statable "done"**, not outcomes. Title imperatively.
- **Allocate `SL-{m}` as `max+1`, counting archived files.** Numbers are never reused — collisions corrupt the board's links.
- **`depends_on` uses full handles** (`SP-{n}_SL-7`), not bare numbers.
- **No checkbox list, no materialiser, no issue minting.** Write the slice files directly. The board reads `status:` from frontmatter.
- A row with no single verifiable "done" is **rejected** — it goes in the Spec (`## Design` / `## Constraints`), not on the board.

## Output

```
✅ SP-{n} sliced
   wrote:   SP-{n}_SL-1 … SP-{n}_SL-{m}  (<count> slices, all status: ready)
   at:      .thinkube/specs/SP-{n}/SL-*.md
   ac-coverage: <covered>/<total> ✔
   next:    /pair-start {n}
```

## Safety / fallback

- **Spec sections missing.** Refuse cleanly. Direct user to `/spec-prepare {n}`.
- **AC unmatched by any slice.** Don't silently invent one. Surface the gap (ask whether the AC is still valid) or fold it into an existing slice with the user's blessing.
- **A candidate has no single "done."** Reject it as a slice. Park it in the Spec's `## Design` / `## Constraints` instead.
- **A candidate has its own AC / design.** It's a Spec, not a slice. Surface this — the user may want a new Spec.
- **Spec is huge (>12 candidate slices).** Usually a sign the Spec should be split. Surface this before authoring files.
