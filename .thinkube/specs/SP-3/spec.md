# Context discipline for /spec-prepare and /slice: bounded gathering, interview-first

Running `/spec-prepare` today front-loads redundant context gathering before
the user is asked anything: it re-learns the spec format from other spec
files (the skill already contains the authoritative shape), makes
uninstructed "just in case" calls (`list_board`), and explores the codebase
before the acceptance criteria exist to scope that exploration. `/slice`
has the same unbounded "explore" step and will exhibit the same behaviour.
This spec tightens both skills so a fresh run reaches the user's first
question almost immediately, and all research happens after — and scoped
by — the governing document.

## Acceptance Criteria

- [ ] Running `/spec-prepare {n}` for a new spec reaches its **first question
      to the user** after at most **2 actions** — fetching
      `specs/SP-{n}/spec.md` and writing the skeleton — with **no other
      reads** (no other specs, no slice samples, no board listing) before
      that question.
- [ ] Both skills declare their embedded file shapes **authoritative and
      complete**, and explicitly forbid reading other specs/slices to learn
      the format.
- [ ] Codebase exploration happens only **after** the governing document
      content exists — the agreed acceptance criteria for `/spec-prepare`,
      the parent Spec for `/slice` — is **scoped by it**, and consults
      `CLAUDE.md` before any codebase search (explore only what the docs
      don't already answer).
- [ ] The file-first review flow (skeleton written immediately; review in
      Markdown Preview, never chat walls) is preserved as shipped in 0.0.5.
- [ ] Installed repos receive the change as a normal bundle update
      (version bumped; boards show "update available").

## Constraints

- Skill-text-only change — no extension or MCP-server code.
- Fixes land **only in the master** (`templates/methodology-bundle/`) and
  reach repos via the bundle update; installed `.claude/skills/` copies are
  never hand-edited (hand-edits create silent drift — the "locally modified"
  pencil — and version confusion).
- The load-bearing section headers and the gate/staleness-hash behaviour
  are untouched.
- Stay within ADR-0003's lean shape — no new sections, tiers, or process.

## Design

Reorder `/spec-prepare`'s procedure to: fetch the spec file → write the
skeleton → **interview the user for acceptance criteria** → only then
explore, scoped by the agreed AC. Add a shared **"Context discipline"**
block to both skills stating: the embedded shape is authoritative (never
read other specs/slices for format); no uninstructed reads (no board
listing "just in case"); `CLAUDE.md` answers architecture questions before
any codebase search; delegate genuine codebase questions to the `explorer`
subagent. For `/spec-prepare` the block carries the measurable bar: at most
2 actions before the first user question.

For `/slice`, the parent Spec is the scope: its Design and File Structure
Plan already name the seams, so exploration exists only to validate the
file plan against reality — not to re-derive what `spec.md` and `CLAUDE.md`
already state.

Verification is observational: run each skill fresh on a new spec and count
the actions before the first user question in the transcript — the bar
either holds or it doesn't.

## File Structure Plan

- `templates/methodology-bundle/skills/spec-prepare/SKILL.md` — reorder the
  procedure (skeleton + AC interview before exploration); add the Context
  discipline block with the 2-action bar.
- `templates/methodology-bundle/skills/slice/SKILL.md` — add the Context
  discipline block scoped to the parent Spec.
- `templates/methodology-bundle/VERSION` +
  `templates/methodology-bundle/manifest.json` — bump 0.0.6 → 0.0.7.
