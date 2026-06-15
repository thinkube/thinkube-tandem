---
description: Author a Tandem Enhancement Proposal (the why behind the work) into teps/TEP-{id}.md. MUST BE USED when the user says "create a TEP", "write a TEP", "new enhancement proposal", or asks to capture the rationale/motivation for a piece of work. Do not hand-author TEP files yourself.
allowed-tools:
  [
    "Read",
    "Grep",
    "Glob",
    "AskUserQuestion",
    "mcp__thinkube-kanban__get_thinkube_file",
    "mcp__thinkube-kanban__write_tep",
    "Task",
  ]
argument-hint: "<tep-id>"
thinkube-bundle: 0.0.1
---

# /tep

Author a **Tandem Enhancement Proposal** — the orthogonal _why_ axis (TEP-0009): the rationale above the work, recorded before specs and referenced by them. A TEP lives as a committed file at `teps/TEP-{id}.md` **in the board** (the sidecar namespace). Read it with `get_thinkube_file` and write it with `write_tep`; **both are board-aware**, so the file always lands in the sidecar — never write a TEP with a raw `Write`/`Edit`.

A TEP is **not** a board-flowing card (TEP-0003 keeps the hierarchy Spec→Slice). It is read from the board and linked to the specs that implement it (`implements:` ↔ `implemented_by:`).

## Mission

Produce a fully-shaped `teps/TEP-{id}.md` in the canonical format, with:

- **Goal** — the outcome in 1–2 sentences.
- **User Expectation** — one or more user stories. This is the same lens as a spec's acceptance criteria: a TEP's user-story seeds the ACs of the specs that implement it.
- **Context** — the forces: what's broken, missing, or in tension.
- **Decision** — the crisp choice.
- **Detailed Description**, **Consequences** (positive / negative), **Alternatives Considered**, **Implemented By**.

## Inputs

- `$ARGUMENTS`: the TEP id `{id}` — an opaque string (base36-epoch for new TEPs). If absent, `write_tep` mints one.

## Context discipline

- **The template is authoritative.** `TEP-TEMPLATE.md` is the single source of the shape — `write_tep` scaffolds from it. **Never read other TEPs to learn the format**; reading neighbours copies their drift.
- **No plan mode.** Do **not** enter plan mode — it blocks in-file authoring. Structured `AskUserQuestion` pickers work in normal mode and compose with write-skeleton-then-fill. A skill self-entering plan mode would override its own guardrails.
- **No uninstructed reads.** Fetch the one TEP you're filling — nothing else up front. `CLAUDE.md` before any codebase search; delegate genuine "what's in this codebase" to the `explorer` subagent.

## Procedure

1. **Read methodology context** if not in session.
2. **Open with the interview.** The conversation leads — ask the user what they want to enhance as the first turn. There's nothing to set up first.
3. **Scaffold the file and keep it current as you talk.** Call `write_tep { tep: {id} }` with no body to lay down the `TEP-TEMPLATE.md` skeleton + canonical frontmatter. Mention the path once — `teps/TEP-{id}.md` — and, if the user wants a rendered view alongside the chat, point them at the Command Palette (_Markdown: Open Preview to the Side_); it's optional, and never quote a keybinding (they don't fire reliably in browser / code-server). As each section is agreed in chat, land it in the FILE — `write_tep` replaces the whole body, so each update is **read-modify-write**: `get_thinkube_file teps/TEP-{id}.md` to fetch the current body, apply your change, then `write_tep { tep: {id}, body }` the full body back. Always re-fetch immediately before each `write_tep`; never clobber text you didn't write. Set the title via `write_tep { tep, title }`. Chat and the file are both fine to review in — the file is just the durable record.
   - **Goal + User Expectation come first** — they're the headline and seed the implementing specs' ACs.
   - Use **`AskUserQuestion`** for genuine forks (naming, scope, an either/or design choice) — not for things with an obvious default.
4. **Explore only when grounding the Decision/Detailed Description** — and only what `CLAUDE.md` + docs don't answer; delegate to `explorer`.
5. **Set status as it lands.** A TEP starts `proposed`; once the user accepts the proposal, `write_tep { tep, status: "accepted" }`.
6. **Commit, then report.** Commit **and push** the TEP file to the board and report the commit — don't ask first (board bookkeeping, per CLAUDE.md). Then print the path, the id, and the suggested next step (`/spec-prepare` to cut a spec that implements it — add `implements: TEP-{id}` to that spec).

## Constraints

- The canonical section headers are **load-bearing** — don't rename them; `write_tep` scaffolds them from the template.
- **Author only through `write_tep`** (board-aware) — a raw `Write`/`Edit` resolves against the session cwd (the code repo), not the board.
- **One format, every TEP** — the ritual is the consistency (TEP-0009), not a promise.
- Keep the two-way link in sync: a TEP records `implemented_by: [SP-…]` as specs are cut; each implementing spec carries `implements: TEP-{id}`.

## Output

```
✅ TEP-{id}: <title>
   tep:    teps/TEP-{id}.md
   status: proposed
   next:   /spec-prepare to cut an implementing spec (set implements: TEP-{id})
```

## Safety / fallback

- **No acceptance the user will commit to.** A TEP can sit `proposed` — don't force `accepted`.
- **`write_tep` / `get_thinkube_file` absent in this session.** STOP and say so — do **not** fall back to a raw `Write`/`Edit`, which would write the TEP outside the board. Fix: start a fresh session in the repo so `.mcp.json` loads the kanban server.
