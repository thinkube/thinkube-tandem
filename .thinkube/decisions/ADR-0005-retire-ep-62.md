---
kind: decision
id: ADR-0005
title: Retire EP-62 (GitHub-spine kanban hardening); carry forward the storage-agnostic survivors
status: accepted
created: 2026-06-03
repo: thinkube/thinkube-ai-integration
---

# ADR-0005 — Retire EP-62; carry forward the storage-agnostic survivors

## Status

Accepted — 2026-06-03. Consequence of ADR-0001 (files-first), ADR-0003
(Spec→Slice), and ADR-0004 (Tandem). Closes out the epic the earlier ADRs
obsoleted.

## Context

**EP-62 — "AI-Human pair-programming setup"** (tracked in `thinkube/thinkube`,
sidecars under that repo's `.thinkube/`) was the epic that drove this whole
investigation. Its outcome statement: _"an agent can manage the entire board —
including Inbox triage — through the MCP alone, mode-gated and safe, with
self-documenting tools."_ Every story under it hardens the **GitHub-Issues
spine**: org-level Issue Types, sub-issue links, Projects v2 fields, a
GitHub-API-driven MCP write surface, Inbox triage via Issue Types.

ADR-0001 demotes exactly that spine to an optional, GitHub-only inbox adapter;
ADR-0003 deletes the Epic/Story tiers and the issue-minting `materialize` step
the MCP was being taught to drive. **EP-62's premise is the thing the chain
tears out.** Two of its specs already shipped against that premise (SP-72,
SP-86, both merged); one is mid-flight (SP-97).

Re-reading all 11 stories + 3 specs + the 2026-06-02 retro against the new
direction, the items split into: a few **storage-agnostic survivors** worth
rescuing _before_ the epic is wiped (they will not resurface on their own); a
band of **host-agnostic UX/behaviour** that testing the new system will
re-surface naturally; one story that is simply **answered by ADR-0001**; one
**open question**; and the bulk, which is now **deletion work**.

## Decision

**Retire EP-62 as an epic.** Do not migrate it into the files-first board.
Consciously carry forward the survivors below; let testing re-surface the
deferrable UX; record the rest as dropped so the reasoning isn't re-litigated.

### Carry forward now (won't resurface on its own)

1. **`classifySpecChange` + its tests** (`src/methodology/specChange.ts`,
   `specChange.test.ts` — SP-86's core). A pure function over
   `{ parentUpdatedAt, taskUpdatedAt, currentReqHash, stampedReqHash }` — fully
   storage-agnostic, and the repo's only tests. Survives the refactor by
   swapping one binding: the verification stamp moves from a **Projects v2
   field → slice frontmatter**. The spec-drift idea itself (re-verify slices
   whose parent Spec's _requirement_ sections changed, before picking the next)
   becomes a `pair-next` behaviour over slices.
2. **Retro conventions (2026-06-02).** Fold into `repo-conventions` /
   `verifier` / `pair-next`:
   - The verification surface for the extension repo is **`tsc --noEmit`
     (host + webview) + `vite build`** — there is no unit-test/eslint layer, so
     "green" means typecheck + build, not a passing suite.
   - **Deploy/validate work verifies by state-check, not the test verifier.**
   - **One slice in flight per Spec** (Doing WIP = 1); on drift, disambiguate
     before verifying.
3. **ST-83 — spikes are not work units.** A feasibility spike has no
   verifiable "done," so it is not a Slice; it belongs in the Spec's
   Design/Constraints. This _is_ the ADR-0003 coherence-bound ("one stated
   done") — enforce it in `/slice`.
4. **Secret-scan on every write** (`ThinkubeStore.scanForSecrets`) — already
   built; matters _more_ when every artifact is a committed file. Keep.

### Defer to testing (host-agnostic; will re-announce itself in use)

- **ST-67** multi-root project switching — survives intact; _simpler_ as "which
  `.thinkube/` is active." (Relevant immediately: the dev setup runs three
  roots.)
- **ST-69** launch Claude Code from a card — survives; _easier_ when the card
  body is already a local file.
- **ST-68** panel UX (one-step title+body, live refresh, refresh button, a
  markdown Spec editor, add-card scoped to its parent). The Spec editor is
  _more_ relevant when Specs are files.

### Resolve / log, don't build

- **ST-66** ("source-of-truth / local-first sync; reality unclear; `.thinkube`
  is an 'overflow store'") — **resolved by ADR-0001.** Its investigation fed
  that decision. Close as resolved-by-ADR.
- **ST-65 open thread** — *navigator mode is cooperative; a shell bypasses the
  MCP.* Still unsolved and _more_ exposed under files-first (writes are now just
  file edits + commits). Logged as an open question, not scheduled.

### Drop (the spine being removed → now deletion work)

EP-62 framing · **ST-63 / SP-97** (board-mgmt MCP: `removeSubIssue`,
`removeProjectItem`, `setIssueType` — all GitHub plumbing) · **ST-64**
(teach-the-MCP-its-rules — most of those rules are now deleted) · **ST-71 /
SP-72** (Issue Types + P0–P3 Priority schema — _shipped & merged, now dead code
to delete_) · **ST-70** velocity/metrics (anti-aligned with coherence-sizing) ·
retro learning #1 (the `admin:org` token gotcha — dies with GitHub auth).

### Operational: the SP-97 branch

SP-97 is mid-flight — ~6 board-management MCP tools on
`feature/sp-97-board-mgmt`, **not pushed**, with a `.vsix` installed into the
dev environment. That work is throwaway under ADR-0001. Abandon the branch and
revert/reinstall the dev `.vsix` so no GitHub-coupled tools linger in the
running install.

## Consequences

- The chain has a clean terminus: EP-62 is explicitly closed, not silently
  stranded, and the survivors are named so they aren't lost when its sidecars
  are removed.
- SP-72's shipped code (`createIssueType`, `createProjectV2Field`,
  `enforceSchema`, the issue-types-only classifier) is reclassified from
  "done" to **scheduled deletion** under ADR-0001 — the only merged work the
  refactor actively reverses.
- `specChange.ts` carries the only tests in the repo across the refactor;
  re-pointing its baseline stamp to frontmatter is a small, contained change.
- The rescued retro conventions become the concrete content of
  `repo-conventions` / `verifier`, so the "green = tsc + vite build" and
  "deploy/validate = state-check" facts don't have to be re-learned at the next
  wall.
- EP-62's sidecars (`EP-62.md`, `ST-63…71/83/85`, `SP-72/86/97*`, the retro)
  live in `thinkube/thinkube`'s `.thinkube/`, not this repo — retiring them is a
  cross-repo cleanup, sequenced with that repo's files-first cutover.

## Alternatives considered

- **Migrate EP-62 into the files-first board as-is.** Rejected: it would import
  the exact GitHub-spine assumptions the chain removes, as live cards.
- **Wipe EP-62 wholesale and recover anything needed during testing.** The
  default instinct, and correct for the Tier-2 UX — but it loses the tested
  `specChange.ts` artifact and the retro learnings, which won't resurface until
  the same wall is hit again. This ADR keeps the wipe but rescues those two
  first.
- **Keep SP-97 going to "finish what's started."** Rejected: it hardens the
  spine being torn out — finishing it spends effort to build deletion targets.
