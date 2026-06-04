---
kind: decision
id: ADR-0001
title: .thinkube/ committed files are the kanban source of truth
status: accepted
created: 2026-06-03
repo: thinkube/thinkube-ai-integration
---

# ADR-0001 — `.thinkube/` committed files are the kanban source of truth

## Status

Accepted — 2026-06-03.

## Context

The Thinkube methodology bundle implements a pair-programming kanban over a
four-tier hierarchy (Epic → Story → Spec → Task). As shipped, that kanban is
backed by **GitHub's API**: typed issues, sub-issue links for the hierarchy,
a Projects v2 Status field for the columns, and issue comments for one of the
quality gates. The `.thinkube/*.md` sidecars exist alongside the issues but are
a _second_ store, and mirroring the long-form body from sidecar → issue is
**optional** (`/spec-prepare` step 6).

Investigating the storage layer surfaced three problems for our actual usage —
solo development of Thinkube, on self-hosted Gitea, with frequent full system
reinstalls:

1. **Neither store is complete on its own.** `ThinkubeStore`
   (`src/store/ThinkubeStore.ts`) is a local-filesystem layer and its own
   header calls the file layer "the source of truth." GitHub holds the
   _skeleton_ (titles, hierarchy, board status, comments); the local files hold
   the _flesh_ (Spec Design/Constraints/File-Plan, the `SP-n-tasks.md`
   decompositions, ADRs, retros). ADRs and retros are **file-only** — they have
   no GitHub copy at all. Because the mirror is optional and `.thinkube/` was
   neither tracked nor gitignored, a reinstall mid-spec silently loses the
   un-mirrored long-form content. GitHub is _not_ a complete backup.

2. **The GitHub-API spine is the heaviest, most fragile coupling.** Projects v2,
   typed issues, sub-issues, the `gh` CLI, and the `project` token scope (which
   silently breaks card moves when missing) are all load-bearing in the core
   loop — every card move hits the API. None of it exists, or exists
   differently, on Gitea.

3. **It is heavier than a solo workflow warrants.** The dual store, the
   `materialize` step (minting one issue per 1–3h task), and the
   coordination-shaped columns/gates are team machinery whose cost does not pay
   back for a team of one (human + Claude).

A key realisation reframed the choice: the GitHub _issue tracker_ was quietly
doing double duty as both the **board** and an **inbox** (a front door for
items filed from outside the repo — a phone, the web UI, a collaborator). A
files-only model keeps the board but loses the inbox. However, that inbox need
only exists for **public GitHub projects**; for self-hosted Gitea / solo work
there are no external filers, so no inbox is required.

## Decision

**Make committed `.thinkube/` files the single source of truth for the kanban,
host-agnostic. Demote the issue tracker from "the system" to an optional,
GitHub-only inbox adapter at the edge.**

### Core (always on, host-agnostic)

- `.thinkube/` is **committed and pushed**. The git remote (Gitea, GitHub,
  GitLab, or none) is both the source of truth and the backup. Reinstall
  recovery is `git clone`.
- Hierarchy lives in frontmatter `parent:`; the board column lives in
  frontmatter `status:`; identity is a **local monotonic counter** (reusing the
  ADR auto-increment pattern already in the store).
- The kanban panel renders _over_ the files via a new `ThinkubeFilesAdapter`
  behind the existing `StorageAdapter` interface — whose docstring already
  anticipates "future adapters (file-based, …) slot in here without touching the
  React or the Panel."
- Quality gates become **file checks** (Spec→Ready: non-empty
  `## Acceptance Criteria`; Review→Verify: all AC checked). No Projects v2, no
  sub-issues, no `materialize`-to-issues, no `project` token scope, no dual
  store.

### Optional GitHub inbox adapter (only when host = GitHub)

- A single `inbox` label is the external front door. A `/triage` skill drains
  open `label:inbox` issues into `.thinkube/` artifacts and closes them with a
  link to the resulting artifact.
- Read-mostly (`list + read + close`), at the edge, and **degradable**: if the
  tracker is unreachable, the core keeps working — only inbox draining pauses.
- **Off by default**; never wired for Gitea/solo. _"Off" is lifecycle-gated, not
  dispensable:_ the inbox is **dormant during development** (no external filers) and
  becomes the **critical** external front door once the project **moves to GitHub for
  maintenance** — that move _is_ the dev→maintenance transition. (Gitea is internal
  CI/CD only, never an issue front door, so the inbox is inherently GitHub.)
  Optionally paired with a local append-only `.thinkube/inbox.md` for in-flow quick
  capture.

### Settled defaults (revisitable)

1. Board column is **frontmatter `status:`**, not directory-as-column (keeps a
   stable path; a move is a one-line edit, not a `git mv` that churns history).
2. Card moves use a **scoped commit convention**, e.g. `chore(board): SP-42 → Review`.
3. IDs come from a **local monotonic counter**.
4. The **`≥1 comment` Review gate is dropped** (it was an async-handoff artifact;
   there is no one to hand off to solo).
5. The **inbox adapter is off by default and GitHub-only**.

## Consequences

**Positive**

- Single, complete source of truth that is also the backup; reinstall-safe.
- Host-agnostic — runs on Gitea out of the box, and offline.
- Dramatically lighter default path: the four-tier ceremony, dual store, API
  spine, materialize step, and token fragility all leave the core.
- The kanban panel is unaffected (storage-agnostic by design).

**Negative / costs**

- A new `ThinkubeFilesAdapter` and store changes (status field, local counter,
  board query) must be built; `GitHubProjectsAdapter` is demoted to optional.
- Committing on every card move adds churn to `git log` (mitigated by the scoped
  commit convention; squash/branch if desired).
- Losing the native issue UI for triage on GitHub projects — recovered by the
  optional inbox adapter.
- Untriaged items sitting in a self-hosted Gitea inbox share the reinstall-wipe
  risk; mitigation is "drain the inbox before reinstall" or point it at a durable
  tracker. (Moot for the default config, where there is no inbox.)

## Alternatives considered

- **Keep GitHub canonical, gitignore `.thinkube/` as a rehydratable cache.**
  Requires mandatory mirroring + a `get_thinkube_file` GitHub fallback, and
  keeps the API spine load-bearing. Rejected: doesn't work on Gitea and doesn't
  lighten the core.
- **Version-control only a curated subset.** More moving parts and a per-artifact
  policy to maintain. Rejected in favour of committing `.thinkube/` wholesale and
  letting the board panel (not the file tree) be how you navigate.
