<!-- thinkube-methodology:start v0.0.3 -->

## Tandem methodology

We pair-program human + Claude using **Tandem** — a methodology for a one-human + one-AI pair on a git repo. Two axioms: (1) the team is a **pair**, not a group of humans; (2) the **committed repo is both the source of truth and the board**.

Hierarchy: **spec → slice**. (Epic/Story are not tiers — grouping is a `theme:` tag.)

- Source of truth: committed markdown in the central Tandem sidecar board repo (`thinkube-tandem`, TEP-0008), namespaced per Thinking Space. Host-agnostic (Gitea / GitHub / offline); no external issue tracker in the core loop. Reinstall recovery is `git clone`.
- A **Spec** is the documented unit (`specs/SP-{n}/spec.md`): acceptance criteria, constraints, design, file plan.
- A **Slice** is the card that flows the board (`specs/SP-{n}/SL-{m}.md`): one coherent end-to-end change verified-and-committed as a single "done." Sized by coherence, not the clock. Handle: `SP-{n}_SL-{m}` (e.g. `SP-3_SL-42`); slices are numbered per-Spec.
- Per-Thinking-Space: each Space's board lives in the sidecar repo under its `<container>/<rel>/` namespace (via `thinkube.boards.root`); a Space is enabled **iff** its namespace dir exists there. The workspace navigator moves between the enabled boards. (Co-located `.thinkube/` is deprecated — TEP-0008.)
- Phase model: a slice's `status:` frontmatter. Columns **Ready → Doing → Done**.

**Spec & TEP workflow:** authoring or advancing spec/TEP/slice/pair work goes through the methodology skills — they are the board-aware path (`write_tep` / `write_spec` / `create_slice`) that keeps files in the sidecar and in canonical shape. So a conversational ask like "write a TEP", "create a spec for TEP-X", "break this into slices", or "start pairing" should invoke the matching skill below rather than hand-rolling the file with raw `Read`/`Write`. (Plain reading/explaining — "read this spec", "show me the board" — does not.)

Skills (this bundle):

- `/spec-prepare` — author a Spec's body (acceptance criteria come from you).
- `/slice` — decompose a Spec into coherent slices (writes `SL-{n}.md` files directly; no issue minting).
- `/pair-start`, `/pair-next`, `/board`, `/retro` — pair-programming orchestration over the workflow.

Subagents (this bundle):

- `explorer` — read-only codebase research; preserves main context.
- `reviewer` — adversarial diff review against acceptance criteria.
- `verifier` — runs the repo's verification (tests / lint / typecheck per `repo-conventions`); returns pass/fail evidence. Gates a slice's move to Done.

Quality gates (file checks, enforced by the kanban panel):

- ACs are **AI-verified and verifiable before the gate they arm** — no human-executed ("the human checks in a fresh session") or deploy/merge-circular ACs; the human's only gate is acceptance. (TEP-tgnvkw)
- → Ready: the slice's parent Spec has a non-empty `## Acceptance Criteria`.
- → Done: verifier green for the slice, and the AC it satisfies is checked on the Spec. (Reviewer + verifier both run in this one gate — no Review/Verify handoff.)
- → Done (docs, TEP-tgh6iy): a slice carries a `docs:` obligation — `required` (the default for **user-facing** work: a feature, CLI, API, config surface, install/upgrade step, or template behavior a reader can observe) or `n/a` + a one-line `docs_reason`. A `docs: required` slice must have its docs updated before Done; `/pair-next` attests this with `move_slice … docs_done: true`. `/slice` stamps `docs:` per slice and the server rejects an `n/a` with no reason, so skipping docs is always visible and deliberate. The gate rolls out via `thinkube.kanban.docsGateMode`: **`advisory`** (default) lets the move through with a warning; **`blocking`** refuses an unsatisfied obligation. Docs live **with the code** (docs-with-code): the `.adoc` module ships in the same repo and commit as the change, aggregated into the site by the docs playbook.

Rules:

- Verify every slice: the repo's verification must be green before Done. No green = not done.
- One slice in flight per Spec; on board drift, disambiguate before verifying.
- PR ceremony matches the change: docs, TEPs, board moves, and trivial fixes may go straight to `main`; open a PR for substantive code (build/runtime changes, or anything worth a deliberate review before it's canonical). Re-tighten — required PR + CI + branch protection — once the project gains collaborators or goes public.
- A spike / investigation is not a slice (no single "done") — it belongs in the Spec's Design/Constraints.
- Mode awareness: `thinkube.kanban.mode` controls AI write authority. In `navigator` mode the AI reads + proposes but can't write the board; in `driver` / `both` it can.
- **Write authority:** Inside an invoked skill, board bookkeeping — moving cards, checking the AC a slice satisfies, stamping provenance/verification — is the **AI's job**: it does it and **reports the result with evidence**. The human steers substance and **intervenes by exception**; the AI never asks the human to move a card or re-invoke a command merely to advance mechanics, and stops only at a marked **bless point**, a **gate refusal**, or a **failed precondition**. (In `navigator` mode this inverts per mode awareness — the AI proposes, the human writes.)
- **Saving the board is part of authoring — not a separate ask.** After authoring or moving board state (a spec, slice, TEP, retro, or column move), commit **and push** the board WIP, then report the commit — the committed repo _is_ the board and its host is the only backup, so unsaved board state is data-loss risk, not "clean scoping." This is board bookkeeping under Write authority: in `driver` / `both` mode the AI just does it and reports; it never asks the human whether to commit or push the board. (In `navigator` mode it proposes, as with any write.) **Stage the whole board working tree** — `git add -A`, never cherry-pick paths: the human's other uncommitted board edits (e.g. archiving Specs/TEPs) are board state too, and selective staging silently drops them.

## Decision-point protocol (human-paced authoring)

At authoring decision points (`/tep`, `/spec-prepare`, `/slice`) the AI works **understand-before-create**: conversation → options → research → **read-back** → the human's explicit **"go."** Surface options as prose; **never** fire a decision-forcing prompt to force convergence. **Approve ≠ execute** — converging the content crystallizes the artifact (writes the TEP/Spec/slices); it never starts the build, which is a separate, later advance the human pulls. Before any advance the AI offers a **read-back** (reflects its understanding for correction) and advances only on the explicit go — and that go **carries continuation** (no redundant second command). This governs the _substance_ decisions only; mechanical bookkeeping (column moves, AC checks, stamps) stays AI-auto.

**The lever (calibrate ceremony to magnitude).** At the start of a piece of work the AI **proposes a level** — `trivial | standard | deep` — sized to the work's magnitude, and the human can **override** it. The level scales _how much_ of the protocol and gate rigor runs: `trivial` → minimal (just do it), `standard` → the normal pass, `deep` → the full understand-before-create pass with research. The level **can never weaken protected invariants** — worktrees, green-before-Done, and the read-back hold at every level (worktrees are mandated in the execution spec). _(v1 is a single dial; splitting it into uncertainty-vs-stakes is a later refinement — see TEP-tgs1tf.)_

<!-- thinkube-methodology:end -->
