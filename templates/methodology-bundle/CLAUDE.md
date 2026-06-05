<!-- thinkube-methodology:start v0.0.1 -->

## Tandem methodology

We pair-program human + Claude using **Tandem** — a methodology for a one-human + one-AI pair on a git repo. Two axioms: (1) the team is a **pair**, not a group of humans; (2) the **committed repo is both the source of truth and the board**.

Hierarchy: **spec → slice**. (Epic/Story are not tiers — grouping is a `theme:` tag.)

- Source of truth: committed `.thinkube/` markdown files. Host-agnostic (Gitea / GitHub / offline); no external issue tracker in the core loop. Reinstall recovery is `git clone`.
- A **Spec** is the documented unit (`.thinkube/specs/SP-{n}/spec.md`): acceptance criteria, constraints, design, file plan.
- A **Slice** is the card that flows the board (`.thinkube/specs/SP-{n}/SL-{m}.md`): one coherent end-to-end change verified-and-committed as a single "done." Sized by coherence, not the clock. Handle: `SP-{n}_SL-{m}` (e.g. `SP-3_SL-42`); slices are numbered per-Spec.
- Per-project: each repo owns its own `.thinkube/` board; a repo is enabled **iff** it has a committed `.thinkube/`. The workspace navigator moves between the enabled boards.
- Phase model: a slice's `status:` frontmatter. Columns **Ready → Doing → Done**.

Skills (this bundle):

- `/spec-prepare` — author a Spec's body (acceptance criteria come from you).
- `/slice` — decompose a Spec into coherent slices (writes `SL-{n}.md` files directly; no issue minting).
- `/pair-start`, `/pair-next`, `/board`, `/retro` — pair-programming orchestration over the workflow.

Subagents (this bundle):

- `explorer` — read-only codebase research; preserves main context.
- `reviewer` — adversarial diff review against acceptance criteria.
- `verifier` — runs the repo's verification (tests / lint / typecheck per `repo-conventions`); returns pass/fail evidence. Gates a slice's move to Done.

Quality gates (file checks, enforced by the kanban panel):

- → Ready: the slice's parent Spec has a non-empty `## Acceptance Criteria`.
- → Done: verifier green for the slice, and the AC it satisfies is checked on the Spec. (Reviewer + verifier both run in this one gate — no Review/Verify handoff.)

Rules:

- Verify every slice: the repo's verification must be green before Done. No green = not done.
- One slice in flight per Spec; on board drift, disambiguate before verifying.
- PR ceremony matches the change: docs, ADRs, board moves, and trivial fixes may go straight to `main`; open a PR for substantive code (build/runtime changes, or anything worth a deliberate review before it's canonical). Re-tighten — required PR + CI + branch protection — once the project gains collaborators or goes public.
- A spike / investigation is not a slice (no single "done") — it belongs in the Spec's Design/Constraints.
- Mode awareness: `thinkube.kanban.mode` controls AI write authority. In `navigator` mode the AI reads + proposes but can't write the board; in `driver` / `both` it can.
- **Write authority:** Inside an invoked skill, board bookkeeping — moving cards, checking the AC a slice satisfies, stamping provenance/verification — is the **AI's job**: it does it and **reports the result with evidence**. The human steers substance and **intervenes by exception**; the AI never asks the human to move a card or re-invoke a command merely to advance mechanics, and stops only at a marked **bless point**, a **gate refusal**, or a **failed precondition**. (In `navigator` mode this inverts per mode awareness — the AI proposes, the human writes.)

<!-- thinkube-methodology:end -->
