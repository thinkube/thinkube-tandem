---
description: Decompose a Spec into coherent end-to-end Slices at specs/SP-{n}/SL-{m}.md. MUST BE USED when the user says "slice", "decompose the spec", "break this into slices", or "create slices for SP-X". Do not hand-author slice files yourself.
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

Read a fully-shaped Spec and cut it into **coherent slices** — each one an end-to-end change you can verify-and-commit as a single "done." Each slice is written **directly** as its own file at `specs/SP-{n}/SL-{m}.md` with `status: ready`. There is no checkbox-list intermediate, no materialiser, no issue minting — the files _are_ the board.

> **Decision-point protocol** (methodology `CLAUDE.md`): this is _human-paced_ authoring — converse → options → research → **read-back** → the human's explicit **"go."** Surface options as prose, never force convergence, and **approve ≠ execute**.

## Mission

Write one `specs/SP-{n}/SL-{m}.md` file per slice, where each slice:

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

- `$ARGUMENTS`: the Spec id `{n}` — an opaque string (base36-epoch for new Specs, a legacy integer for old ones).

## Context discipline

The parent Spec is your scope — gather only what it doesn't already give you:

- **The slice shape is authoritative and enforced.** The canonical slice shape lives in this skill and is serialized by `create_slice` — **never read other slice files to learn the format.** Reading neighbours "for the format" is wasted context and copies their drift.
- **The Spec's `## Design` and `## File Structure Plan` already name the seams.** Decompose from them (step 3); don't re-derive what `spec.md` and `CLAUDE.md` already state.
- **`CLAUDE.md` before any codebase search.** Consult it and the docs first; search the code only for what they don't answer.
- **Exploration validates, it doesn't re-discover.** Any codebase look exists only to check the Spec's File Structure Plan against reality — do the named files/seams exist as described? — not to re-explore the architecture. Delegate a genuine "what's in this codebase" check to the `explorer` subagent to keep the main context lean.
- **No uninstructed reads.** Don't call tools the task didn't ask for "just in case." Load the Spec; read existing slice files only when re-slicing (step 0).

## Procedure

0. **Detect re-slicing (the Spec changed under existing slices).** If `specs/SP-{n}/` already holds `SL-*.md` files, this is a **change-review**, not a fresh decomposition — the board flags this with a stale badge (`specStale` / `specChange: "requirements"`) on done slices whose parent Spec was edited after they were verified. Do NOT overwrite blindly:
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
   - **Declare the slice's file set.** List the repo-relative files the slice will edit (`files:`), drawn from the Spec's File Structure Plan. When two or more slices are meant to run **concurrently**, give them the same `parallel_group:` name — their `files` sets **must be disjoint** (the server refuses an overlapping group, naming the conflicting files). Cut parallel siblings file-disjoint up front so the merge is trivial; if two candidates must touch the same file, either sequence them (`depends_on`) or leave them ungrouped.
4. **Map back to acceptance criteria — and keep the ordinals.** For each AC line, identify which slice(s) satisfy it, recording its **1-based ordinal** (its position in the Spec's `## Acceptance Criteria`). If an AC is unmatched, add a slice. If a slice isn't traceable to any AC, drop it (or surface the gap — the AC may be missing). Each slice's ordinal list is passed to `create_slice` as `satisfies` (step 6) so the mapping lives in frontmatter, not prose — that's what arms the → Done gate.
   - **Flag any AC that isn't AI-verifiable at the gate it arms.** While mapping, an AC that can only be checked _after_ the gate it arms — a **human-executed** step ("the human verifies in a fresh session") or a **deploy/merge-circular** outcome (needs the merged/deployed result, but merge/deploy is gated on the AC) — is a **defect in the Spec, not a slice to mint**. Don't write a slice whose only "done" is such an AC; route it back to `/spec-prepare` to reframe (probabilistic → proxy + AI probe; deploy-circular → pre-merge/preview AC + a non-gating post-deploy smoke check). A genuine post-deploy confirmation is modeled as a **follow-up slice** that runs after the deploy, never as a Done condition of the deploying slice.
5. **Propose in chat.** Show the proposed slice list with rationale and the SL numbers you'll allocate. Wait for user feedback.
6. **Create the files via `create_slice` — never freehand.** For each agreed slice, call `mcp__thinkube-kanban__create_slice` with `{ spec: {n}, title, body, satisfies?, depends_on?, parallel?, parallel_group?, files?, docs?, docs_reason?, priority? }`. The **server** allocates the SL number (per-Spec, archive-aware), generates the uid, and serializes the canonical shape — you never pick numbers or format files. The tool refuses over-long titles (> 70 chars) and Specs with empty Acceptance Criteria; surface a refusal verbatim, fix the input, retry.
   - `title`: the concrete capability, short — it becomes the card title.
   - `body`: 2–4 lines of detail — what the coherent end-to-end cut includes and what the observable "done" looks like. Title and body are **separate**; never collapse them into one merged line.
   - `satisfies`: the AC ordinals from step 4 (e.g. `[2, 3]`) — the 1-based positions of the criteria this slice delivers. Recording it arms the → Done gate (the slice can't reach Done until those boxes are checked on the Spec); omit it only when the slice genuinely maps to no single AC.
   - `files` / `parallel_group`: the slice's **machine-readable file set** (repo-relative paths it will edit) and, when it runs concurrently with siblings, the **named group** they share. The server refuses a `parallel_group` whose members' `files` overlap — surface that refusal verbatim, then re-cut the slices file-disjoint (or sequence them with `depends_on`).
   - `docs`: the **documentation obligation** (TEP-tgh6iy). Default `required` — any **user-facing** slice (a feature, CLI, API, config surface, install/upgrade step, or template behavior a user can observe) must update its doc module to reach Done. Pass `docs: "n/a"` **with a one-line `docs_reason`** for work that changes nothing observable (internal refactor, test-only, infra) — the server rejects an `n/a` with no reason, so skipping docs is always a visible, deliberate choice. Default to `required` when unsure (fail closed).

7. **Commit, then report.** Commit **and push** the new slice files to the board and report the commit — don't ask first (board bookkeeping, per CLAUDE.md). Then print the slice count and the next step: `/pair-start {n}` to begin working them.

## Constraints

- Slices are **vertical, demonstrable changes** with one statable "done" — cut end-to-end, never by layer/file. A slice that isn't independently demonstrable is a fragment; merge it.
- Title by the **concrete capability delivered**, not a vague whole-feature outcome and not a layer name.
- **Allocate `SL-{m}` as `max+1`, counting archived files.** Numbers are never reused — collisions corrupt the board's links.
- **`depends_on` uses full handles** (`SP-{n}_SL-7`), not bare numbers. **`parallel: true`** marks a slice sharing no files/state with its siblings (parallel-eligible, not must-run-in-parallel). **`parallel_group`** names a set of slices meant to run concurrently — their **`files` sets must be disjoint**, enforced server-side at `create_slice`.
- **No checkbox list, no materialiser, no issue minting.** Write the slice files directly. The board reads `status:` from frontmatter.
- A row with no single verifiable "done" is **rejected** — it goes in the Spec (`## Design` / `## Constraints`), not on the board.
- A slice's "done" must be **AI-verifiable at the gate it arms** — never a human-executed check or a deploy/merge-circular outcome. Such an AC is routed back to `/spec-prepare`; a real post-deploy confirmation is a follow-up slice, not a Done condition.

## Output

```
✅ SP-{n} sliced
   wrote:   SP-{n}_SL-1 … SP-{n}_SL-{m}  (<count> slices, all status: ready)
   at:      specs/SP-{n}/SL-*.md
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
