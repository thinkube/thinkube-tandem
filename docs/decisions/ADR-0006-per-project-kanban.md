---
kind: decision
id: ADR-0006
title: Per-project kanban — each repo owns its board, opt-in, with a workspace navigator
status: accepted
created: 2026-06-03
repo: thinkube/thinkube-ai-integration
---

# ADR-0006 — Per-project kanban: each repo owns its board, opt-in, navigated across the workspace

## Status

Accepted — 2026-06-03. Corollary of ADR-0001 (files-first); uses the ADR-0003/0004
lexicon (Spec→Slice; minimal coinage). Supersedes the single-central-tracker model
and resolves the "project" terminology collision.

## Context

Under the GitHub-backed kanban, the platform's ~30 repositories could not each
carry their own issue tracker without scattering Issues across repos (and
cross-repo issue references are clumsy). So the user **centralized**: one
issues-enabled repo, `thinkube/thinkube`, served as the platform-wide tracker for
every component. That binding is encoded in the workspace settings —

```json
"thinkube.kanban.repo": "thinkube/thinkube",
"thinkube.kanban.projectNumber": 1,
"thinkube.kanban.folder": "/home/thinkube/thinkube-platform/core/thinkube"
```

— one repo, one Projects v2 board (#1), one sidecar folder. A side-effect:
every epic/story/spec/retro piled into `core/thinkube/.thinkube/` regardless of
which component it was about (this is why EP-62 and its descendants live there,
while the methodology's own code and ADRs live in the extension repo).

ADR-0001 removes the very thing centralization was avoiding: there are no Issues
to scatter anymore — only committed `.thinkube/` files that live **next to the
code they describe**. The centralization rationale evaporates.

Two more facts surfaced:

- **A terminology collision.** "Project" meant the GitHub **Projects v2 board**
  (`THINKUBE_PROJECT_NUMBER`, `configureProject`, ST-67's "project switcher") — and,
  in the user's own vocabulary, **a repository**. Files-first deletes the GitHub
  meaning, freeing the word.
- **The real workspace** (`thinkube.code-workspace`) is three **container** folders
  — **Apps** (2 repos), **User Templates** (3), **Platform** (~25) — none of which
  is itself a repo. **30 repos total; only 2 have a board today** (`core/thinkube`,
  `extensions/thinkube-ai-integration`).

## Decision

**Each repository owns its own committed `.thinkube/` kanban. Enabling the
methodology for a project is an explicit, opt-in user action signalled by the
presence of the committed `.thinkube/` dir. A workspace navigator lets the user
move across all enabled boards.**

### Per-project board (retire the central tracker)

- A **Project = a git repository**; it owns exactly **one Kanban**, rendered over
  its committed `.thinkube/` (ADR-0001). Host-agnostic; the board lives with the code.
- Retire the single-central-tracker model and its config —
  `thinkube.kanban.repo` / `.projectNumber` / `.folder`, `configureProject`, and the
  single `THINKUBE_REPO` / `THINKUBE_PROJECT_NUMBER` binding are removed.

### Lexicon (no new coinage)

```
Workspace            the thinkube.code-workspace
└─ Folder            a workspace root; a pure container (may hold many projects)
   └─ Project = Repo  owns ONE Kanban over its committed .thinkube/
      └─ Spec
         └─ Slice
```

All standard words — the fix is **disambiguation**, not invention. "Project"
means _repository_; the GitHub Projects-v2 sense is retired. ADR-0004 stays at
exactly two coined words (Tandem, Slice).

### Opt-in enablement (the user decides)

- A project gets the methodology **only when the user explicitly enables it**. The
  extension **never auto-enables** any of the discovered repos.
- **The enable signal is the committed `.thinkube/` directory itself** — its
  presence _is_ "enabled." There is **no separate registry or settings list** of
  enabled projects (that would be uncommitted, drift-prone derived state — exactly
  what ADR-0001 forbids; the committed dir is the single truth).
- **Enable** = scaffold + commit the `.thinkube/` skeleton (board config + the
  Spec/Slice/decisions/retros structure + the per-repo methodology bundle), via the
  existing `BundleInstaller`. **Disable** = remove/archive the dir.

### Workspace navigator (ST-67, reframed)

- With the workspace open, discover the repos across the open folders. Show the
  **enabled** ones as boards you navigate between; show **un-enabled** repos with an
  _"Enable Thinkube methodology here"_ affordance.
- **Not a merged pane** — separate per-project boards with a navigator across them.
  A cross-repo, read-only **rollup** stays a deliberately deferred option behind
  ADR-0002's seam ("if `.thinkube/` ever becomes cross-repo memory, revisit").
- This is what ST-67 ("project switching, multi-root") was reaching for. Under
  GitHub it was a clumsy "switch the one repo+project binding"; under files-first it
  is the **primary navigation**, because there is no single binding — you walk the
  workspace's boards.
- The navigator's UI label is **"Thinking Spaces"** (decided 2026-06-04, with
  Phase-6 execution): each row is a repo _plus_ its thinking artifacts
  (`.thinkube/` specs, decisions, retros) _plus_ its Claude sessions — more than
  "a board," which is one thing a thinking space _contains_. Brand language
  (Thinkube → thinking), self-explanatory, and not workflow jargon — it doesn't
  spend the two-coined-words budget (ADR-0004). Command IDs stay
  `thinkube.boards.*`.

## Consequences

- **The repo split self-explains and self-corrects.** The methodology's own board
  belongs in the extension repo (where its code + ADRs already are);
  `core/thinkube/.thinkube/` is legacy-of-centralization — EP-62 retired (ADR-0005),
  everything else per-repo from here.
- **Removal targets** for the audit: the three `thinkube.kanban.*` settings keys,
  `configureProject`, the single-binding env reads in `kanbanMcpServer.ts`. ST-67 is
  reclassified from "missing feature" to "the navigator."
- **Reuse:** `BundleInstaller` (already ~500 lines) is the natural home for
  "enable here."
- **Quiet by default:** 28 of 30 repos have no board and stay that way until
  explicitly enabled — no auto-scaffolding, no noise.
- **Lost:** the single GitHub pane over all components. Accepted — work is usually
  within one repo, and a read-only rollup can come later (ADR-0002 seam).

## Alternatives considered

- **Auto-enable every repo that looks like a project.** Rejected: noise, and not
  every repo wants the ceremony — "the user decides" is the whole point.
- **Track enabled projects in workspace/user settings.** Rejected: uncommitted,
  drifts, and fights ADR-0001; the committed `.thinkube/` dir is the truth.
- **One merged cross-repo board as the default view.** Rejected as default: it
  re-introduces a central aggregator. Kept only as an optional later read-only rollup.
- **Keep a single central-tracker repo.** Rejected: it is the model being retired,
  and it only existed to dodge a GitHub-Issues constraint that no longer applies.
