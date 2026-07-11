# Thinkube Tandem — Mission & Vision

> The durable "why and where." For **how the methodology works**, see the
> Tandem docs component under `docs/modules/ROOT/` (published as _Tandem
> Methodology_; `npm run docs:build` renders it locally). This file is the
> product's mission and principles; if it ever conflicts with an older doc,
> this wins.

## Mission

A VS Code extension that makes **human + Claude pair-programming first-class**
over the **Tandem methodology**: a TEP → Spec → Slice hierarchy whose
artifacts live as markdown in a **thinking-space sidecar repo** beside the
code. The committed git repo is the source of truth; the extension is the
**cockpit** — the board, the thinking-space views, the MCP server, and the
methodology plugin all exist to make that pairing smooth.

## Vision

The kanban is a **flexible, two-way project board over repo files**, not a
status viewer. Everything you'd do to plan and run work happens in one place:

- **Author** the why, the what, and the cut — TEPs, Specs, and Slices — as
  markdown files the pair writes together and git preserves.
- **Move** a card between Ready, Doing, and Done, with the gates enforced at
  each transition: acceptance criteria present, docs obligation met,
  verification green.
- **Orchestrate** a Spec end-to-end: work units run in disposable worktrees,
  the closing gate grades every acceptance criterion, and the human accepts
  the delivery — or attends to what diverged.
- **Docs ship with the code they describe** (docs-with-code); the docs gate
  holds a slice open until its documentation lands.

The board, the thinking space, the MCP tools, and the methodology plugin are
facets of one thing: making the artifacts of pair programming (proposals,
specs, slices, decisions, retros) first-class, navigable, editable, and
reviewable.

## Product principles (hard-won; violate these and the product regresses)

1. **The board is a living, editable plan over committed files — never a
   read-only mirror.** If the UI can show it, the UI should be able to
   change it.
2. **Every primary action has a home in the UI.** The command palette is a
   secondary path, never the only way to reach a primary action
   (debug/smoke commands excepted).
3. **No silent failures, no blank dead-ends.** Empty states explain what to
   do next; errors surface to the user instead of being swallowed into an
   output channel.
4. **Reuse over reinvent.** When the plan says "fork/reuse X," do it — don't
   quietly ship a worse from-scratch version.
5. **Docs track reality.** Delete superseded docs; correct the plan when
   execution diverges. A stale doc is worse than no doc.
6. **Unplanned work has a front door.** Discoveries and unplanned work land
   on the board — as slices, proposals, or retro notes — never lost.
7. **One coherent surface.** A single "Thinkube" activity-bar container;
   setup is the first thing a new project sees.

## What this is not

Not autonomous-agent dispatch without a human gate (the human accepts every
delivery), not a Claude Code replacement, not a custom backend (git repos and
markdown files only), not a straitjacket — the ceremony lever scales the
process to the size of the work.
