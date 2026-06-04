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

- Is **one coherent, vertical, end-to-end change** — a thin cut through whatever layers the change touches that, once verified green and committed, leaves the system **observably more capable** (you could demo it).
- Has a **single statable "done"** (one green from the verifier).
- Is titled by the **concrete capability it delivers** ("Email/password login end-to-end"), not by a vague whole-feature outcome ("Auth works") and **not by a layer or file** ("Add the Redis store").
- Lands at `status: ready`, `parent: SP-{n}`, with a stable `uid`, a **short `# title` heading** (the concrete capability, ≤ ~70 chars) and a brief detail body — title and body are separate; never one merged line.
- Traces back to the Spec's `## Acceptance Criteria` — every AC maps to at least one slice.

Slices are sized by **coherence, not the clock**. If you can't state a single "done" for a row, it's more than one slice — split it. If a row has its own distinct acceptance criteria / design, it's not a slice — it's another Spec.

## What a slice is (vertical, not a layer)

A slice is the unit that flows the board and is the verification boundary — _one green_. The decisive test is **vertical, demonstrable capability**, not size or layer:

- **Slice (vertical — write a file):**
  - "Email/password login end-to-end — form → `POST /session` → validate → set cookie → redirect."
  - "A logged-in session survives a server restart."
  - "Logout end-to-end — button → `DELETE /session` → cookie cleared."
- **Not a slice (horizontal fragment — fold into the slice it serves):**
  - "Add the Redis session store." · "Write the session middleware." · "Wire the OAuth callback handler."
  - Each is one _layer_ of a slice; on its own it leaves the system half-built, demos nothing, and only makes sense once a sibling lands.

Slicing **by layer/file** ("the models slice", "the endpoints slice", "the Redis slice") is the anti-pattern — it recreates the tiny-task soup the Slice unit exists to prevent (a slice is **not** a renamed atomic task). When in doubt, ask: _if I commit only this, is the system demonstrably more capable?_ If no, it's a fragment — merge it into the vertical slice it belongs to.

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
3. **Brainstorm slices privately.** Working through the Design + File Structure Plan, draft candidate slices — cut **vertically** (coherent end-to-end behaviours), not by layer/file. For each, check:
   - **Is it demonstrable on its own?** If committing only this slice would leave the system half-built (a layer with nothing using it), it's a horizontal fragment — fold it into the vertical slice it serves.
   - Can you state a **single "done"** for it (one green)? If not, it's more than one slice — split it.
   - Does it have its own distinct AC / design? Then it's a **Spec**, not a slice — surface that to the user.
   - Is it a spike / investigation / "confirm X" with no verifiable output? Then it is **not a slice** — it belongs in the parent Spec's `## Design` / `## Constraints`. Don't write a file for it.
   - Does it depend on another slice? Note it for `depends_on`. Can it run independently of its siblings (no shared file/state edits, no required ordering)? If so, mark `parallel: true` — _parallel-eligible_, not must-run-in-parallel.
4. **Map back to acceptance criteria.** For each AC line, identify which slice(s) satisfy it. If an AC is unmatched, add a slice. If a slice isn't traceable to any AC, drop it (or surface the gap — the AC may be missing).
5. **Propose in chat.** Show the proposed slice list with rationale and the SL numbers you'll allocate. Wait for user feedback.
6. **Create the files via `create_slice` — never freehand.** For each agreed slice, call `mcp__thinkube-kanban__create_slice` with `{ spec: {n}, title, body, depends_on?, parallel?, priority? }`. The **server** allocates the SL number (per-Spec, archive-aware), generates the uid, and serializes the canonical shape — you never pick numbers or format files. The tool refuses over-long titles (> 70 chars) and Specs with empty Acceptance Criteria; surface a refusal verbatim, fix the input, retry.
   - `title`: the concrete capability, short — it becomes the card title.
   - `body`: 2–4 lines of detail — what the coherent end-to-end cut includes and what the observable "done" looks like. Title and body are **separate**; never collapse them into one merged line.

7. **Report.** Print the slice count and the next step: `/pair-start {n}` to begin working them.

## Constraints

- Slices are **vertical, demonstrable changes** with one statable "done" — cut end-to-end, never by layer/file. A slice that isn't independently demonstrable is a fragment; merge it.
- Title by the **concrete capability delivered**, not a vague whole-feature outcome and not a layer name.
- **Allocate `SL-{m}` as `max+1`, counting archived files.** Numbers are never reused — collisions corrupt the board's links.
- **`depends_on` uses full handles** (`SP-{n}_SL-7`), not bare numbers. **`parallel: true`** marks a slice sharing no files/state with its siblings (parallel-eligible, not must-run-in-parallel).
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

- **Kanban MCP tools absent in this session.** STOP and say so — do **not** fall back to freehand `Write` (freehand creation is how format drift happened). Fix: start a fresh session in the repo (`.mcp.json` loads at session start).
- **Spec sections missing.** Refuse cleanly. Direct user to `/spec-prepare {n}`.
- **AC unmatched by any slice.** Don't silently invent one. Surface the gap (ask whether the AC is still valid) or fold it into an existing slice with the user's blessing.
- **A candidate has no single "done."** Reject it as a slice. Park it in the Spec's `## Design` / `## Constraints` instead.
- **A candidate has its own AC / design.** It's a Spec, not a slice. Surface this — the user may want a new Spec.
- **Spec is huge (>12 candidate slices).** Usually a sign the Spec should be split. Surface this before authoring files.
