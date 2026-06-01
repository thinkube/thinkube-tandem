# Thinkube AI Integration — Mission & Vision

> The durable "why and where." For **how the methodology works**, see
> [`METHODOLOGY.md`](METHODOLOGY.md). For **the technical plan**, see
> [`INTEGRATION_PLAN.md`](INTEGRATION_PLAN.md). This file is the one to read first;
> if it ever conflicts with an older doc, this wins (older planning docs are deleted
> rather than left to mislead).

## Mission

A VS Code extension that makes **human + Claude pair-programming first-class** over a
**GitHub-Issues-backed Epic → Story → Spec → Task methodology**. GitHub is the source
of truth; the extension is the **cockpit** — roadmap, board, card editing, the MCP
server, and the methodology bundle all exist to make that pairing smooth. It is _not_
an autonomous-agent dispatcher (see `INTEGRATION_PLAN.md` §0.6, §2.2).

## Vision

The kanban is a **flexible, two-way project-management board**, not a status viewer.
Everything you'd do to plan and run work happens **in the board, synced to GitHub**:

- **Move** a card between columns → updates the Projects v2 Status (the workflow:
  Spec · Ready · In Progress · Review · Verify · Done — fixed, not reorderable).
- **Edit** a card → writes the GitHub issue (title/body), alongside its `.thinkube/`
  sidecar.
- **Create** a card → opens a real GitHub issue and adds it to the board.
- **Prioritize** by reordering within a column → persists as the board's order; the
  top of _Ready_ is "what's next."
- **Triage** unplanned issues — work other people open lands in an **Inbox** lane and
  is dragged onto the plan, never lost.
- **Dates & dependencies** on cards — created/updated timestamps, an editable **due
  date** (board Date field, overdue flagged), and `⛔ blocked by #N` badges.
- **Change-review** — when an Epic/Story/Spec changes while children exist, affected
  tasks are **flagged for review** (`⚠ spec changed`), never silently rewritten;
  `/tasks-decompose` re-run does a keep/add/obsolete diff. Surface, don't auto-mutate.
- **Inbox / triage** — open issues not yet on the board appear in an Inbox lane;
  drag one onto a column to triage it into the plan.

The board, roadmap, MCP tools, and the methodology bundle are facets of one thing:
making the artifacts of pair programming (epics, stories, specs, tasks, decisions,
retros) first-class, navigable, editable, and reviewable.

## Product principles (hard-won; violate these and the product regresses)

1. **The board is a living, editable plan synced to GitHub — never a read-only
   mirror.** If the UI can show it, the UI should be able to change it.
2. **Every primary action has a home in the UI.** The command palette is a secondary
   path, never the only way to reach a primary action (debug/smoke commands excepted).
3. **No silent failures, no blank dead-ends.** Empty states explain what to do next;
   errors surface to the user instead of being swallowed into an output channel.
4. **Reuse over reinvent.** When the plan says "fork/reuse X," do it — don't quietly
   ship a worse from-scratch version.
5. **Docs track reality.** Delete superseded docs; correct the plan when execution
   diverges. A stale doc is worse than no doc.
6. **Unplanned work has a front door.** Issues anyone opens get triaged onto the
   board, not lost.
7. **One coherent surface.** A single "Thinkube" activity-bar container; setup is the
   first thing a new project sees.

## Current direction & roadmap

The active build turns the kanban into the PM board described above, in phases (full
detail in the session plan):

- **Phase 1** — polished, editable board: markdown cards, timestamps, edit → GitHub
  sync (card + detail panel), fixed columns.
- **Phase 2** — `+ Add` to create tasks on the board; **Inbox** lane that surfaces
  repo issues not yet on the board, drag-to-triage onto the plan.
- **Phase 3** — persisted priority (reorder within a column via Projects v2 item
  position).
- **Phase 4** — due dates (Projects v2 Date field) and dependency badges
  (blocked-by/blocks).

## Test sandbox

`cmxela/thinkube-methodology-test` (private), GitHub Projects v2 board **#2**
("Thinkube Methodology Test", the six methodology Status options). Used to verify the
methodology and the board end-to-end. Epic #1 + Story #2 exist; board #2 holds the
materialized Tasks.

## What this is not

Not autonomous-agent dispatch, not a Claude Code replacement, not a custom backend
(GitHub + repo files only), not a straitjacket. See `INTEGRATION_PLAN.md` §0.6.
