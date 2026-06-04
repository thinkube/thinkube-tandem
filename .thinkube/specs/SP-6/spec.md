# Write-authority contract: the AI runs the board, the human steers substance

Across sessions the AI's board behaviour is inconsistent — in one afternoon
it silently hand-moved a card, then moved one properly via the tool, then
refused to move at all and asked the user to re-invoke the loop. The agreed
contract ("the user doesn't move cards") lives only in one conversation and
one project memory; the skills — the only artifact every session loads —
still say "tell the user" / "run /pair-next" at the seams. This spec writes
the contract into the methodology master and aligns the pair skills, plus
the one mechanical half the server can enforce. (Evidence of the gap, same
day: spec numbers are also hand-allocated — "SP-5" was proposed while SP-5
already existed on disk.)

## Acceptance Criteria

- [ ] The methodology master (bundle `CLAUDE.md` block + `methodology-context`)
      states the write-authority rule: inside an invoked skill, board
      bookkeeping (moves, AC checkboxes, stamps) is the **AI's job**, done
      and **reported with evidence**; the human intervenes **by exception**;
      the AI never asks the human to move a card or re-invoke a command
      merely to advance mechanics; it stops only at marked bless points,
      gate refusals, or failed preconditions.
- [ ] A `/pair-next` run on a green slice **moves it to Done and reports** —
      the transcript contains no "now you move/run X" mechanics addressed
      to the user.
- [ ] `/pair-next` with nothing in flight takes an **unambiguous** pick
      (briefed, deps satisfied) directly; it asks only on genuine ambiguity
      (multiple candidates, failed deps, board drift).
- [ ] `/pair-start` keeps exactly **one bless point** (the pick), phrased
      confirm-or-object — not "run /pair-next to take it."
- [ ] `move_slice → Done` **refuses** when the satisfied AC is not checked
      on the parent Spec — the gate's mechanical half becomes real code,
      with an error that names the unchecked criterion.
- [ ] Ships dual-vehicle: bundle bump (skill/master text) + new vsix
      (server gate); both confirmed before the contract is considered live.

## Constraints

- Existing bless points are untouched: the slice-cut blessing in `/slice`,
  spec-AC confirmation in `/spec-prepare`, and the pick confirmation in
  `/pair-start` remain the human's marked decision moments.
- The AC-checked gate is a **sequencing/integrity check, not independence**
  — the AI checks the boxes under this very contract. Its value is that
  Done becomes unreachable while the Spec document lags the board; no
  mechanical gate can provide independent review on a solo platform, and
  the docs must not claim otherwise.
- Skill/master fixes land only in `templates/methodology-bundle/` (SP-3
  rule); dual delivery as in SP-4 (bundle update + vsix install).
- Lean (ADR-0003): no new modes or settings; `navigator` semantics are
  unchanged (server still hard-refuses all writes).

## Design

The contract text lands twice — a "Write authority" rule block in the
bundle `CLAUDE.md` next to the existing mode-awareness rule, and the same
block in `methodology-context/SKILL.md` — so both always-loaded surfaces
agree. `pair-next` is realigned: the no-in-flight branch takes the briefed,
dependency-satisfied pick directly and asks only on genuine ambiguity; the
green path moves to Done _then_ reports evidence; all "run /pair-next" /
"tell the user to move" phrasing goes. `pair-start` step 9 becomes a
confirm-or-object bless point.

The mechanical gate needs the slice→AC mapping to be structured, not prose:
slice frontmatter gains an optional `satisfies: [<ac-ordinal>, …]` (the
1-based positions of the AC lines the slice delivers). `/slice` already
computes this mapping in its coverage step — it now records it via
`create_slice` (new optional param) instead of dropping it into prose.
`move_slice → Done` then verifies each listed ordinal is a checked `- [x]`
in the parent Spec's `## Acceptance Criteria`; any unchecked → refuse,
naming the ordinal and its text. Slices without `satisfies` (all existing
ones) pass ungated with `gateSkipped: "no satisfies field"` in the result —
legacy-tolerant, honest about it.

Verification: stdio harness — move→Done refused while the named AC is
unchecked, allowed after checking it, legacy slice passes with the skip
marker; plus a fresh-session `/pair-next` transcript showing take→green→
move→report with no user-addressed mechanics.

## File Structure Plan

- `templates/methodology-bundle/CLAUDE.md` — write-authority rule block.
- `templates/methodology-bundle/skills/methodology-context/SKILL.md` — same
  rule, same wording.
- `templates/methodology-bundle/skills/pair-next/SKILL.md` — no-in-flight
  branch, move-then-report, satisfies-aware AC step.
- `templates/methodology-bundle/skills/pair-start/SKILL.md` — step 9
  confirm-or-object phrasing.
- `templates/methodology-bundle/skills/slice/SKILL.md` — pass `satisfies`
  to `create_slice` from the coverage mapping.
- `src/store/frontmatter.ts` — `satisfies?: number[]`.
- `src/mcp/kanbanMcpServer.ts` — `create_slice` accepts `satisfies`;
  `move_slice → Done` enforces it against the parent Spec.
- `templates/methodology-bundle/VERSION` + `manifest.json` — bump.
