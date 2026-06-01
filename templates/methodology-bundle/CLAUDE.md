<!-- thinkube-methodology:start v0.0.1 -->

## Thinkube methodology

We pair-program human + Claude on a GitHub-Issues-backed kanban.
Hierarchy: epic → story → spec → task.

- Source of truth: GitHub Issues (typed Epic/Story/Spec/Task; sub-issue links).
- Sidecar: `.thinkube/{epics,stories,specs,decisions,retros}/*.md`, frontmatter-linked to issues.
- Specs live as one issue + one `.thinkube/specs/SP-{n}.md`, decomposed into `.thinkube/specs/SP-{n}-tasks.md` (checkbox list, optional `(P)` for parallel-eligible).
- Phase model: the Projects v2 Status field. Columns Spec / Ready / In Progress / Review / Verify / Done are the methodology's state machine.

Skills (this bundle):

- `/epic-new`, `/story-new` — top of the hierarchy.
- `/spec-prepare`, `/tasks-decompose`, `/tasks-materialize` — spec authoring → tasks list → GitHub Task issues + Ready column.
- `/pair-start`, `/pair-next`, `/board`, `/retro` — pair-programming orchestration over the workflow.
- `/pair-start-quick` — ceremony defuser for small bugfix-shape work.

Subagents (this bundle):

- `explorer` — read-only codebase research; preserves main context.
- `reviewer` — adversarial diff review against acceptance criteria.
- `verifier` — runs tests + lint + typecheck; returns pass/fail evidence. Gates Review → Verify.

Quality gates (enforced by the kanban panel):

- Spec → Ready: spec body has a non-empty `## Acceptance Criteria` checklist.
- In Progress → Review: at least one comment on the issue.
- Review → Verify: all acceptance criteria checked.

Rules:

- Verify every task: tests + lint + typecheck before marking done. No green = not done.
- Never push to `main`; always open a PR.
- Mode awareness: `thinkube.kanban.mode` controls AI write authority. In `navigator` mode the AI reads + proposes but can't write the board; in `driver` / `both` it can.

<!-- thinkube-methodology:end -->
