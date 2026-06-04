---
description: Advance the pair-programming loop. Verifies the in-flight (Doing) slice via the verifier subagent, moves it to Done, sweeps stale slices, picks the next Ready slice, loads its context.
allowed-tools:
  [
    "Read",
    "Grep",
    "Glob",
    "Bash",
    "Edit",
    "Task",
    "mcp__thinkube-kanban__list_board",
    "mcp__thinkube-kanban__get_slice",
    "mcp__thinkube-kanban__get_thinkube_file",
    "mcp__thinkube-kanban__move_slice",
  ]
argument-hint: "(no args; uses the current session's active Spec)"
thinkube-bundle: 0.0.1
---

# /pair-next

The work-loop pulse. After finishing a slice, run `/pair-next` to: (1) verify the in-flight slice via the `verifier` subagent, (2) move it to **Done** and check the AC it satisfies on the Spec, (3) sweep stale slices, (4) pick the next Ready slice and load its context. This is the skill the user invokes most often during a session.

It's just **Ready → Doing → Done** with one gate at Done. There is no Review/Verify handoff and no comment step — reviewer and verifier both run inside the single Done gate.

## Mission

In one invocation:

1. Verify the in-flight (Doing) slice — the verifier runs the repo's checks (per `repo-conventions`).
2. On green: check the AC it satisfies on the parent Spec, then `move_slice` it to `Done` (this stamps `verified_req_hash` automatically) and report the move with evidence.
3. Sweep for stale slices — done slices whose parent Spec's _requirements_ changed — and resolve them before starting new work.
4. Pick the next Ready slice under the same Spec, `move_slice` it to `Doing`.
5. Load the new slice's body + the parent Spec section into the conversation.

## Procedure

1. **Identify the in-flight slice.** `mcp__thinkube-kanban__list_board`; find the card in **Doing** under the active Spec. (Keep one slice in flight per Spec — if there are somehow multiple, prefer the most recently moved or ask the user.) **If none is in Doing, this is a fresh pulse:** skip the verify/Done steps (2–5) and go straight to the pick (step 6) — take the briefed, dependency-satisfied top-of-Ready slice **directly**, then advance and load it. Ask the user only on **genuine ambiguity**: multiple equally-ranked candidates, the top pick's `depends_on` unsatisfied, or board drift. Don't bounce to `/pair-start` just to advance the mechanics.
2. **Verify.** Delegate to the `verifier` subagent (via `Task` tool):
   - The verifier reads `repo-conventions` for the project's verification recipe and runs it.
   - Verifier returns `{ ok: true }` or `{ ok: false, reason, evidence }`.
   - On red: **stop** — a verifier red is a gate refusal, a legitimate stop point. Surface the failures to the user **verbatim** and do not move the card. The human fixes the failing code (substance); say you'll re-verify once it's addressed. Don't instruct the user to re-run a command to advance the mechanics — resume the loop yourself.
3. **Check the satisfied AC on the Spec — before the move.** Determine which AC ordinal(s) this slice delivers: prefer the slice's `satisfies: [<ac-ordinal>, …]` frontmatter (the 1-based AC positions it delivers); for a legacy slice without that field, fall back to the AC its body names. Mark each corresponding `- [ ]` checked (`- [x]`) in `.thinkube/specs/SP-{n}/spec.md` via `Edit`. (A checkbox toggle is a metadata change — it does not mark other slices stale.) Do this **first**: the → Done gate refuses the move while a satisfied AC is unchecked, naming the criterion. (A slice with no `satisfies` field passes that gate ungated, but still check the AC its scope covers.)
4. **Move the finished slice to Done, then report.** On green and with the AC checked: `mcp__thinkube-kanban__move_slice { slice: "SP-{n}_SL-{m}", status: "Done" }`. This sets the slice's `status: done` and **stamps `verified_req_hash`** with the Spec's current requirement-hash automatically — you don't write that field by hand. Then report the move with evidence (the verify result + the AC you checked) — never hand the move or the checkbox off to the user.
5. **Stale-spec sweep.** Before picking the next slice, check whether any **done** sibling under the active Spec went stale. From `list_board`, each card carries `specStale` (bool) and `specChange` (`none` | `metadata` | `requirements`):
   - **`specChange: "requirements"`** (substantively stale — the Spec's `## Acceptance Criteria` text / `## Design` / `## Constraints` changed since this slice was verified, i.e. current requirement-hash ≠ the slice's `verified_req_hash`): **resolve it before starting new work.** Re-run the `verifier` against the current Spec; if the slice no longer meets the new AC, move it back to `Doing` and re-open the affected `.thinkube/specs/SP-{n}/spec.md` checkbox. Tell the user what changed.
   - **`specChange: "metadata"`** (a status move, priority/theme/due edit, or an AC checkbox toggle): not a real change — no re-verification.
   - Handle stale slices one at a time; finish the sweep before moving on.
6. **Pick the next slice.** Same priority rule as `/pair-start`: top of Ready under the same Spec, `depends_on` satisfied. If no Ready slices remain, surface that the Spec is done-ish and suggest `/retro` or moving to another Spec.
7. **Advance and load context.** `move_slice { slice, status: "Doing" }` for the picked slice. Then `get_slice` for its body and `get_thinkube_file specs/SP-{n}/spec.md` for the parent Spec section it implements.
8. **Brief the user.**

## Constraints

- **Verifier red is non-negotiable.** Don't move a slice to Done while the checks are failing, ever. Suggest fixes; let the user fix; re-run.
- **One slice in flight per Spec.** Don't fan out into parallel Doing cards in a single `/pair-next` call.
- **Don't fake the gate.** If `move_slice` refuses a move, surface the reason and stop. Don't try to work around it.
- **Don't stamp `verified_req_hash` by hand.** `move_slice → Done` records the Spec requirement-hash the slice was verified against — that baseline is exactly what the step-5 sweep compares against. A slice with no baseline yet (never verified) is never flagged stale.

## Output

```
🔬 Verify: SP-{n}_SL-3
   tsc       ✅ clean
   webview   ✅ built
   tests     ✅ 18 passed

☑ Checked AC #2 on SP-{n}/spec.md
🟢 SP-{n}_SL-3 → Done   (verified_req_hash stamped)

▶ Next pick: SP-{n}_SL-4 — <title>
   satisfies AC #3
🟢 SP-{n}_SL-4 → Doing

Loaded:
   - SP-{n}_SL-4 body (description above)
   - SP-{n} Design section
   - Files in the file-plan touched by this slice: src/auth/handler.ts, src/auth/handler.test.ts

Ready to pair on SP-{n}_SL-4. Tell me what you want to do first.
```

## Safety / fallback

- **Verifier subagent missing.** If `.claude/agents/verifier.md` isn't installed, run the `repo-conventions` verification recipe directly via `Bash` instead. Suggest re-installing the bundle.
- **Verification recipe not detected.** Tell the user. Don't guess — ask for the right command and add it to `repo-conventions`.
- **`move_slice` gate refuses.** Surface the reason verbatim. If → Done is rejecting because the satisfied AC isn't checked on the Spec, check it (step 3) and retry the move.
- **Navigator mode.** The MCP server refuses board writes from Claude. Verification still runs and the AC edit is proposed; tell the user to make the move themselves.
