---
kind: decision
id: ADR-0008
title: Board state in a sidecar repo, with conflict-free timestamp Spec IDs
status: accepted
created: 2026-06-05
repo: thinkube/thinkube-ai-integration
---

# ADR-0008 — Board state in a sidecar repo, with conflict-free timestamp Spec IDs

## Status

Accepted — 2026-06-05. Amends ADR-0006 (per-project co-located board) by moving
board state out of each code repo into one central sidecar repo; revises the
Spec-ID default of ADR-0001 (local monotonic counter → conflict-free timestamp);
preserves ADR-0001's substance (committed markdown is the source of truth,
git-clone recovery, no external tracker). Delivers the cross-repo board that
ADR-0006 left deferred behind the ADR-0002 seam. Deletes SP-5's canonical-only
Spec-number minting (SL-3) and refocuses SP-5's worktrees onto code isolation.

## Context

ADR-0001 made committed `.thinkube/` files the kanban source of truth; ADR-0006
put **one board per repo, co-located with its code**. SP-5 then added per-Spec
git **worktrees** so parallel Specs don't share a working tree. Living through
that combination surfaced the real problem.

**Co-locating the board with the code versions the board per-branch.** A Spec's
status moves are edits to `SL-*.md` frontmatter committed on `spec/SP-n`; they
only reach `main`'s board on merge. Three consequences:

- You cannot see all in-flight Specs in one place — each lives on its own branch.
- Finishing forces a strict _close-before-retire_ order (move last slice → Done,
  check the AC, **then** PR + merge, **then** retire). Get it wrong and `main` is
  left with an open card and the worktree — the place to fix it — already gone.
  This was observed concretely: an SP-6 card sat stranded after merge and took a
  full reconciliation pass to close.
- So worktrees were conflating two _separable_ concerns: **code isolation**
  (their real, Anthropic-recommended job) and **board isolation** (board-on-branch
  — the entire source of the pain).

Two forward requirements co-location cannot serve:

- **Cross-repo board.** The target is thinkube development across ~30 repos with
  parallel Specs (e.g. a bug-fix Spec alongside a docs Spec). The user wants one
  board spanning repos, not state scattered per repo and per branch.
- **Conflict-free identity for multiple writers.** Consecutive integer IDs
  (ADR-0001's "local monotonic counter") need a single allocator — which is
  exactly why SP-5 had to protect numbering with canonical-only minting (SL-3).
  The moment two writers mint independently (worktrees today, collaborators
  later) the numbers collide and boards cannot be merged.

**Deployment reality (the integration surface).** thinkube's code-server is not a
marketplace install: `install-extensions.sh.j2` builds the cloned extension
source and **symlinks** it into the extensions dir, so the extension and the
deploy are one system. Repos are cloned over an SSH deploy key
(`~/.ssh/github_ed25519`, `git@github.com:…`) driven by a metadata repo
(`<github_org>/<github_org>-metadata/.../repositories.json`). The workspace
(`thinkube.code-workspace`) is **multi-root** — `Apps` (`/home/thinkube/apps`),
`User Templates` (`/home/thinkube/user-templates`), `Platform`
(`/home/thinkube/thinkube-platform`) — and the extension is configured by a
templated `User/settings.json`. A board repo therefore rides machinery that
already exists; Gitea (the platform's internal Copier/Argo plumbing) is not
involved — the user's code and board repos are on GitHub.

## Decision

**Move board state out of each code repo into a single sidecar "boards" repo on
GitHub holding every project's board namespaced by project; give Specs
conflict-free timestamp IDs; keep worktrees for code isolation only.**

### Sidecar board repo (board ≠ co-located with code)

- **One git repo** in the user's GitHub org holds **all** boards, namespaced per
  project — `<board-repo>/<project-path>/specs/SP-…/`, plus per-project retros and
  decisions. It is committed markdown: ADR-0001's substance is intact (files are
  the source of truth, recovery is `git clone`, no external issue tracker). Only
  the **location** changes — co-located → central.
- Because board state no longer lives on a code branch, **worktrees/branches in a
  code repo never touch the board → the board never forks → the convergence
  problem is dissolved by construction.** Retiring a worktree becomes a pure code
  operation with no board reconciliation.
- This **supersedes ADR-0006's** "each repo owns its co-located `.thinkube/`" and
  **delivers** the cross-repo board that ADR-0006/ADR-0002 left as a deferred,
  read-only "rollup" seam — now the primary board model.

### Conflict-free Spec IDs (timestamp, not a counter)

- A Spec's ID is a **zero-padded base36 encoding of its creation epoch-seconds**
  (e.g. `SP-tw7n0g`): independent writers mint without coordination; the IDs are
  **sortable** (chronological) and **decodable** back to a time; disjoint Spec
  directories merge cleanly across collaborators.
- No central allocator is needed, so **SP-5's canonical-only minting (SL-3) is
  deleted**, and ADR-0001's "local monotonic counter" default is revised for Spec
  IDs.
- **Slices stay consecutive** `SL-1..n` within their Spec — single-owner-per-Spec
  keeps slice numbering safe, and short.
- **Accepted residual risk:** two writers minting in the _same second_ collide.
  This is rare, and benign — a **visible** git merge conflict (two same-named Spec
  dirs) resolved by renaming one, never silent loss. The more probable
  same-_writer_ rapid case is prevented locally for free (a writer never reuses
  its own last second). No disambiguator suffix — chosen for brevity.
- Spec IDs become **opaque** (no human-readable order); the Spec **title** carries
  meaning, the ID is only a stable handle.

### Worktrees = code isolation only

- Keep `WorktreeService`; worktrees remain Anthropic-style parallel **code**
  workspaces and no longer carry or converge board state.
- The SP-5 surface bugs are independent and handled by the implementing Spec:
  the "Start Spec in Worktree" action only on Specs with open work, and a
  context-aware launch (no `/pair-start` for a finished/empty Spec).

### Deployment integration (rides existing machinery)

- Clone the board repo to **`/home/thinkube/<board-repo>`** — a home-level sibling
  of the workspace roots — and add it as a **4th workspace root** ("Boards") in
  `thinkube.code-workspace.j2`, so it sits _beside_ the code roots it serves
  rather than nested under one (it is cross-cutting by position).
- Clone via the existing `github_ed25519` SSH-key loop. **Create-if-absent** on
  first deploy via `gh repo create <github_org>/<board-repo> --private` (the deploy
  already has `github_token`; `gh` ships in the image).
- Point the extension at the board root via the templated `User/settings.json`.
  The navigator and MCP `BoardRegistry` read boards from this central root and map
  each project in the other workspace roots to its namespace.

## Consequences

**Positive**

- The convergence/stuck-card class is eliminated by construction; worktree
  retirement is a clean code-only operation.
- One board across all repos — the cross-repo view ADR-0006/ADR-0002 deferred.
- Collaborator-ready: independent ID minting + per-project disjoint namespaces
  merge without conflict.
- Simplifies the worktree story — deletes SP-5's SL-3 canonical minting.
- Still committed markdown with `git clone` recovery — ADR-0001 intact in
  substance.
- Rides the existing SSH-key clone loop, metadata-driven repo list, and
  settings.json templating — no new auth, no Gitea, no token-privilege design.

**Negative / costs**

- **Loses co-location:** cloning a code repo alone no longer yields its board.
  Accepted — the user holds the whole platform, and the board repo is the single
  planning clone (and the one backup).
- New board-repo lifecycle in the extension (ensure / clone / create / sync) and
  discovery/MCP/`BundleInstaller` changes to read from a central root +
  namespaces instead of co-located `.thinkube/`.
- A migration of today's co-located `.thinkube/` boards into the sidecar.
- Spec IDs are opaque (meaning moves to the title).
- Board edits and code PRs are decoupled — no atomic "the PR carries its own
  board move."

## Alternatives considered

- **Board on canonical `main`, worktrees for code (Option B).** Decouples board
  from code branches and dissolves convergence too, but keeps the board _per
  repo_ — no cross-repo view. Rejected for the multi-repo target; the sidecar is
  the same idea taken one step further to centralization.
- **Keep the board co-located; just harden the retire-gate (salvage SP-5).**
  Tames the sequencing but doesn't dissolve it, and still cannot merge
  collaborators' boards (consecutive IDs need an allocator). Rejected.
- **Board out of git (sidecar DB / MCP store).** Dissolves all coupling but
  violates ADR-0001 (committed files are truth; clone-recovery; host-agnostic
  markdown). Rejected.
- **ULID / truncated hash for IDs.** ULID is conflict-free and sortable but long
  (26 chars); a truncated hash is short but opaque _and_ reintroduces birthday
  collisions. A base36 timestamp is short, sortable, and decodable. Chosen.

## Open questions (deferred to the implementing Spec)

- **Board-repo name** (`<org>-boards`?) and whether it is registered as another
  entry in `<org>-metadata/repositories.json` or as its own dedicated deploy
  config (it is special: auto-created, central, not a dev clone).
- **Project → namespace mapping** — how a code-root path
  (e.g. `thinkube-platform/extensions/thinkube-ai-integration`) resolves to its
  folder inside the board repo.
- **Migration** of existing co-located `.thinkube/` boards into the sidecar.
- **Runtime sync/offline** — local-first commit + background push, and conflict
  handling when a push races another writer.
