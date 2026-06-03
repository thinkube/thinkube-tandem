---
kind: decision
id: ADR-0007
title: Tandem migration plan — audited work-list, phase sequence, and locked Phase-0 decisions
status: accepted
created: 2026-06-03
repo: thinkube/thinkube-ai-integration
---

# ADR-0007 — Tandem migration plan: audited work-list, sequence, and locked decisions

## Status

Accepted — 2026-06-03. Operationalizes ADR-0001…0006. This is the *how* (the
execution plan), grounded in a read-only multi-agent audit of the actual code;
revisitable as phases land.

## Context

ADR-0001…0006 decided the **what** — files-first source of truth, no vector RAG,
Spec→Slice, the "Tandem" positioning, retiring EP-62, and per-project kanban. A
read-only audit (6 parallel `explorer` agents, one per coupling dimension, + a
synthesis pass; ~458k tokens) then mapped the **how** against the real extension
code with `file:line` evidence, replacing earlier hand estimates.

**Headline:** it is a **~70/30 spine-removal** — roughly **2,700+ lines delete**
(most of `GitHubService`'s 1,941; all 796 of `GitHubProjectsAdapter`; the Roadmap
feature; 4 MCP tool families; 4 skills), while the genuinely-new code is small.
Risk concentrates in **one decision** (the card-identity model) plus relocating
**one** verification-baseline stamp. The audit corrected several assumptions —
recorded under *Estimate corrections* below.

The full audit output (per-dimension findings + synthesis) was produced into an
ephemeral temp file; this ADR preserves its load-bearing content so it survives.

## Decision

### A. Locked Phase-0 decisions

- **Card handle = `SP-3_SL-42`** — hyphen *within* each id, underscore *joins* the
  two. The spec id renders identically standalone (`SP-3`) and in-handle; the `_`
  makes the two-part structure visible. (Rejected alternatives in *Alternatives*.)
- **Slices numbered per-Spec** — `SL-1`, `SL-2`… restart within each Spec, so a
  fresh Spec starts at `SL-1` and numbers stay small at scale. Allocation is local
  to the Spec.
- **Identity stability** — each slice also carries a **stable internal `uid`** in
  frontmatter that the board uses for its own links. The human handle
  `SP-x_SL-y` is what you type/see; **reparenting renumbers the handle** (cheap for
  solo; only stale text mentions go cold), but the `uid` keeps board links intact.
- **Number allocation = archive-don't-delete** — a finished/dead slice keeps its
  file (`status: archived`), so a number is never freed and `max+1` can't collide.
  This realizes ADR-0001 §3's "local monotonic counter" without a separate counter
  file (the files stay the single source of truth). The reusable `nextNumber(kind)`
  primitive is the one genuinely-new piece (none exists today).
- **Files nested** — a Spec owns a folder: the Spec doc at
  `.thinkube/specs/SP-3/spec.md` and its slices at `.thinkube/specs/SP-3/SL-42.md`.
  The folder *is* the join; reparenting is a clean `git mv`. Adjusts ADR-0003's flat
  `slices/SL-{n}.md`.
- **Due date + Priority retained** — as slice frontmatter (`due:`, `priority:`),
  rewriting the set-due path to write frontmatter.
- **"≥1 comment" gate deleted** — per ADR-0001; collapses to ADR-0003's two
  file-checked gates.
- **Internal ID plumbing = synthesize numeric** — the stored number *is* the slice
  number, keeping the existing numeric postMessage protocol; the webview chips
  relabel to the `SP-x_SL-y` handle (and the old dual `#42 / SP-42` chip collapses
  to one). A developer-side choice with no user-visible effect.

### B. Migration sequence (8 phases)

**Executed as additive expand-contract, green at every phase.** The verifier gate
(`tsc --noEmit` + webview build + tests) must stay green at each phase, so the legacy
GitHub-backed model is *kept* until the phase that deletes its consumers: new
machinery is added first (expand), the old removed only once nothing references it
(contract). Concretely — **Spec is retained** as the document tier and **Slice is
added alongside** (not "renamed"); `epic`/`story`/`issue` survive in the types until
Phases 5–7 remove the Roadmap, wizards, and GitHub spine that use them.

- **Phase 0 — decisions.** Closed by §A above.
- **Phase 1 — rewrite the canonical docs FIRST.** `methodology-context/SKILL.md` +
  the bundle `CLAUDE.md` block hard-code everything the ADRs delete (4-tier table,
  6 columns, chunk-11 gates, `SP-{n}-tasks` materializer). They *gate* every other
  skill rewrite and the human's mental model. Cheap, unblocking.
- **Phase 2 — extend the kind taxonomy at the root** *(done — additive)*.
  `frontmatter.ts` `Kind` union **adds `slice`** plus the Tandem fields (`uid`,
  `parent`, `status` ready/doing/done/archived, `theme`, `due`, `priority`,
  `verified_req_hash`, `depends_on`); `issue`/`parent_issue` kept and `@deprecated`.
  `ThinkubeStore` gains nested-layout helpers (`pathForSpecDoc`, `pathForSlice`,
  `sliceHandle`, `listSpecDirs`, `listSlices`) and the monotonic allocators
  `nextSpecNumber()` / `nextSliceNumber()` (per-Spec; archive-don't-delete). Spec is
  retained; `epic`/`story` and the `issue:`-keyed index are removed later with their
  consumers (Phases 5–7), not here.
- **Phase 3 — relocate the survivors onto files.** Keep `specChange.ts` +
  `specChange.test.ts` **verbatim** (depends only on `crypto`). Re-point the
  verification-baseline stamp from the Projects-v2 `SpecBaseline` field onto slice
  frontmatter — a **4-site** change (reads at adapter:565,606 + mcp:655,683; the one
  write at `kanbanMcpServer.ts:819-845`). Rebuild `qualityGates.ts` `gateForTransition`
  for 3 columns / 2 gates (the gate functions are already file-shaped).
- **Phase 4 — build `ThinkubeFilesAdapter`** behind a **trimmed** `StorageAdapter`
  interface: keep `load/save/scope/onExternalChange`; delete
  `createTask/setParent/listParentSpecs/promoteToChain`; add `createSlice` + a
  file-keyed update + a navigator hook; trim the `WebviewMessage` union
  (`set-parent`/`group`/`create-task`) in lockstep. ~70% assembles over
  `ThinkubeStore`; the only new logic is the `status:`-frontmatter ↔ Board-column
  projection. Wire `onExternalChange` to the store watcher.
- **Phase 5 — delete the GitHub spine.** `GitHubProjectsAdapter` (whole 796-line
  file); the Projects-v2 surface, sub-issue resolution, issue-types/classifier, and
  `enforceSchema`/`migrateLabelKindsToTypes` in `GitHubService` (all 26 `runGraphQL`
  sites); the 4 tier-specific MCP tool families + `TasksMaterializer`; the Roadmap
  feature (tree + commands + 3 wizards); `promoteToChain` at all 3 sites. Collapse
  `GitHubService` transport to REST-only (drop `@octokit/graphql`, `ISSUE_FIELDS`,
  the `find*Field` helpers). **Demote** the surviving list+read+close subset +
  `AuthService` into a GitHub **inbox** module — **dormant during development, activated and
  critical once the project moves to GitHub for maintenance** (Gitea hosts only
  internal CI/CD and is never an issue front door, so the inbox is inherently
  GitHub). Build it **switch-on-ready**, not as a vestige: `listIssuesByLabel`
  filtered to `label:inbox`, REST `getIssue`, `closeIssue`, and `addComment` for the
  triage close-link; drop `createIssue`/`updateIssue`. Survivor ≈ 150–200 of 1,941
  lines.
- **Phase 6 — per-repo, not central.** Delete the 3 single-binding settings keys
  (`thinkube.kanban.repo/projectNumber/folder`) + `configureProject` + the
  Configure-Project handoffs; rewrite `getMethodologyRoot`/`resolveConfiguredRepo`,
  the MCP env reads, `KanbanMcpProvider` injection, `extension.ts` bootstrap,
  `pickAdapter`, and `bundle.ts` install target to be per-repo. **Build the workspace
  navigator** (ADR-0006 / ST-67 reframed): seed from the existing `switchProject`
  scanner (`config.ts:68-91` already walks the 3 folders + filters `.git`), swap the
  signal to committed-`.thinkube/`-presence; show enabled repos as boards, un-enabled
  with an "Enable here" affordance. **Build the "Enable here" scaffold** — extend
  `BundleInstaller` to scaffold + commit the `.thinkube/{specs,…}` skeleton (with
  `.gitkeep`) at an arbitrary repo path. No settings registry.
- **Phase 7 — finish the skill bundle.** Delete `epic-new`, `story-new`,
  `tasks-materialize`, `pair-start-quick` (fold `story-new`'s user-observable-AC
  framing into `spec-prepare` first); rename `tasks-decompose`→`slice` and rewrite to
  emit per-Spec `SP-x/SL-y.md` files; rewrite `spec-prepare` (AC from the user, not a
  parent Story), `pair-start`, `pair-next` (flip slice `status:` + 2 file gates +
  the relocated baseline stamp), `board`; align `repo-conventions`/verifier to
  ADR-0005's `tsc --noEmit` + `vite build` recipe; trim installer `settings.json`
  grants + `mcp.json` env; reconcile the manifest/stamp versions; delete the drifted
  checked-in `core/thinkube/.claude/skills` copy (after folding back any wanted edits
  from its 3 hand-edited files).

### C. Carry-forward survivors (ADR-0005, confirmed by audit)

`specChange.ts` (+ tests) verbatim; `qualityGates.ts` gate functions; the
`switchProject` navigator seed; ThinkubeStore supplying ~70% of the files-adapter;
the secret-scan on `ThinkubeStore.writeFile`.

## Estimate corrections (audit surprises)

- **Bigger than assumed.** `GitHubService` barely survives (~150–200 / 1,941; all 26
  `runGraphQL` sites delete) — a near-total rewrite, not a "demote." And the
  `StorageAdapter` seam is **not** clean: `createTask`/`setParent`/`promoteToChain`
  (which literally returns `{epic,story,spec}`) encode the spine; the interface **and**
  the `WebviewMessage` union must be trimmed in lockstep — a rewrite, not a plug-in.
- **Smaller than assumed.** The baseline-stamp relocation is a 4-site change, not a
  rewrite; `epicNumber` is already vestigial (only the demo fixture sets it); the
  navigator has a strong existing seed; the panel is already singleton-by-scope.
- **Net.** ~30 discrete work items across 8 phases, deletion-dominated and heavily
  parallelizable — about a week of pair work, front-loaded by the (now closed) Phase-0
  decisions.

## Open questions (deferred — captured so they aren't lost)

- One MCP server per enabled repo (N processes) vs one server taking a repo arg.
- Does a `CardDetailPanel`-style detail view survive, or is the open `SL` file the
  only detail surface? (Decides delete vs rewrite of `CardDetailPanel.ts`.)
- Broaden `gitRemote.ts` beyond github.com (Gitea/GitLab) now, or defer?
- `retro`'s `write_retro_note` MCP tool: keep as a local-file helper, or use plain
  Write/Edit (already allowed)?
- `BundleInstaller`'s settings-merge never *removes* entries — a one-time migration /
  deny-list is needed to strip the retired `gh project` / `gh sub-issue` grants from
  existing installs.
- Collapse the two hand-synced `types.ts` (host + webview) into one shared module.

## Consequences

- The audit's value is preserved in the committed record rather than an ephemeral temp
  file; execution can begin at Phase 1 with no further input (Phase 0 is closed).
- SP-72's merged schema code is confirmed as Phase-5 deletion work (per ADR-0005).
- The plan is sequenced so the always-loaded docs change first (they gate the rest),
  the survivors move before the spine is deleted (so nothing is orphaned), and the
  per-repo navigator lands last (it depends on the central-tracker removal).

## Alternatives considered

- **Flat `SL-42` global handle.** Rejected: opaque, ever-growing numbers at scale
  (`SL-3847`) with no grouping.
- **Composite handle with global slice numbering** (`SP-3-SL-3847`). Rejected:
  composite *and* huge — the worst of both; only per-Spec numbering keeps numbers
  small.
- **String internal IDs.** Rejected: a large webview/postMessage rewrite for a clean
  identity with no user-visible benefit; synthesize-numeric gets a working board
  faster.
- **Separators** — all-hyphen `SP-3-SL-42` (no visible spec/slice boundary),
  all-underscore `SP_3_SL_42` (whole-token double-click, but `SP_3` ≠ standalone
  `SP-3`), mixed `SP_3-SL_42` (makes `SP-3`/`SP_3` both mean one spec). Rejected in
  favour of `SP-3_SL-42`, which keeps each id convention-identical while marking the
  join.
