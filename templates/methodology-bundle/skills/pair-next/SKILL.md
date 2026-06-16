---
description: Advance the pair-programming loop — verify the in-flight slice, check its AC, move it to Done, then pick the next Ready slice. MUST BE USED when the user says "next slice", "continue the slice", "keep going", or "pair-next". Do not move board cards or land slices by hand outside this skill.
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
    "mcp__thinkube-kanban__accept_spec",
  ]
argument-hint: "(no args; uses the current session's active Spec)"
thinkube-bundle: 0.0.1
---

# /pair-next

The work-loop pulse. `/pair-next` drives a Spec's slices **to completion** and then runs the **acceptance sequence** — it does not stop between slices. Per TEP-0010 a Spec runs on **one branch, slices executing consecutively and autonomously**, with the **single human gate at acceptance**. So one `/pair-next` invocation: verifies and lands the in-flight slice, then keeps pulling the next Ready slice — verify → check AC → Done — until none remain, and only then stops for the human's one approval before merging the Spec's single PR.

It's **Ready → Doing → Done** per slice (one automated gate at Done: reviewer + verifier both run inside it — no Review/Verify handoff, no comment step), then **one spec-level acceptance gate** (automated re-verify **and** human accept) before the Spec is done.

## Mission

In one invocation, for the active Spec:

1. Run every Ready slice to Done — for each: verify (the `verifier` runs the repo's checks per `repo-conventions`), check the AC it satisfies, `move_slice` to `Done`. **No pause between slices** — no pick-bless, no "move the card" prompt. Stop only on a verifier red, a `move_slice` refusal, or a failed precondition.
2. Keep a stale-spec sweep honest as you go — resolve substantively-stale done slices before starting new work.
3. When no Ready slices remain, enter the **acceptance sequence**: **explain** the assembled implementation across the slices → wait for the human's single **approval** → on approval, `accept_spec` (the spec-level gate) → on pass, **merge the Spec's one PR**. Spec done.

## Procedure

### A. Run the slices to completion (loop — no inter-slice stops)

Repeat the following until there is **no slice in Doing and no eligible Ready slice** under the active Spec. Do **not** stop between iterations to ask the human anything — autonomous execution is the point (TEP-0010). The only stops are the three exceptions named in the constraints.

1. **Identify the in-flight slice.** `mcp__thinkube-kanban__list_board`; find the card in **Doing** under the active Spec. Keep **one slice in flight per Spec** — if there are somehow multiple (board drift), reconcile them this run (verify covers the whole branch; check each one's AC and land each) and note the drift; only ask the human if it's genuinely ambiguous which work a card represents. **If none is in Doing,** go straight to the pick (step 6) for the first iteration.
2. **Verify.** Delegate to the `verifier` subagent (via `Task` tool):
   - The verifier reads `repo-conventions` for the project's verification recipe and runs it.
   - **Run the verifier in the slice's own worktree** (SP-tgpwbm): a Spec runs in its `spec/SP-{n}` worktree (TEP-0008), so the verification recipe must execute against **that worktree's** checkout — isolated from any other Spec's uncommitted changes. Point the verifier at the worktree path; never verify a parallel slice from the canonical/main tree. (The Done gate itself is **unchanged** — see step 3 — this only changes _where_ the verifier runs.)
   - Verifier returns `{ ok: true }` or `{ ok: false, reason, evidence }`.
   - On red: **stop the loop** — a verifier red is a gate refusal, a legitimate stop point. Surface the failures **verbatim** and do not move the card. The human fixes the failing code (substance); say you'll re-verify and resume the loop once it's addressed. Don't instruct the user to re-run a command to advance the mechanics.
3. **Check the satisfied AC on the Spec — before the move.** Determine which AC ordinal(s) this slice delivers: prefer the slice's `satisfies: [<ac-ordinal>, …]` frontmatter (the 1-based AC positions it delivers); for a legacy slice without that field, fall back to the AC its body names. Mark each corresponding `- [ ]` checked (`- [x]`) in `specs/SP-{n}/spec.md` via `Edit`. (A checkbox toggle is a metadata change — it does not mark other slices stale.) Do this **first**: the → Done gate refuses the move while a satisfied AC is unchecked, naming the criterion. (A slice with no `satisfies` field passes that gate ungated, but still check the AC its scope covers.)
   3b. **Satisfy the docs obligation — before the move (TEP-tgh6iy).** If the slice's frontmatter is `docs: required`, its documentation must be updated **in this slice** (docs-with-code — the `.adoc` module lives in the same repo/commit as the change). Make that doc edit if you haven't, then attest it on the move with `docs_done: true`. A `docs: n/a` slice carries its reason and is ungated. In **blocking** mode an unsatisfied obligation refuses the move (the error names it); in **advisory** mode the move returns a `docsWarning` — surface it verbatim and still update the docs.
4. **Move the finished slice to Done.** On green and with the AC checked: `mcp__thinkube-kanban__move_slice { slice: "SP-{n}_SL-{m}", status: "Done", docs_done: true }` (include `docs_done: true` once the slice's docs are updated; omit it only for a `docs: n/a` slice). This sets `status: done` and **stamps `verified_req_hash`** with the Spec's current requirement-hash automatically — you don't write that field by hand. Report the move inline with evidence (the verify result + the AC checked + the doc updated); surface any `docsWarning`; keep going — don't hand the move or the checkbox to the user.
5. **Stale-spec sweep.** Check whether any **done** sibling under the active Spec went stale. From `list_board`, each card carries `specStale` (bool) and `specChange` (`none` | `metadata` | `requirements`):
   - **`specChange: "requirements"`** (substantive — the Spec's `## Acceptance Criteria` text / `## Design` / `## Constraints` changed since this slice was verified): **resolve before new work.** Re-run the `verifier` against the current Spec; if the slice no longer meets the new AC, move it back to `Doing` and re-open the affected `specs/SP-{n}/spec.md` checkbox. Tell the user what changed.
   - **`specChange: "metadata"`** (status move, priority/theme/due edit, or an AC checkbox toggle): not a real change — no re-verification.
6. **Pick the next slice.** Top of Ready under the same Spec with its `depends_on` satisfied. `move_slice { slice, status: "Doing" }`, then `get_slice` for its body and the parent Spec section it implements. **Implement it, commit on `spec/SP-{n}`, and loop back to step 2** — without pausing for confirmation. When no eligible Ready slice remains, leave the loop and go to **B**.

### B. Acceptance sequence (the single human gate)

Reached when every slice under the Spec is Done. This is the **one** place `/pair-next` stops for the human (TEP-0010).

7. **Explain the assembled implementation.** Summarise what the slices, together, built — mapped to the Spec's acceptance criteria, ideally with a real end-to-end demonstration (not a box re-tick). This is the "human can judge the whole" step that per-slice greens can't provide.
8. **Wait for the human's approval — bless point.** Stop here for the single marked decision: the human **accepts** (proceed) or **sends it back** (name what's wrong → it becomes new slices / fixes, and the loop resumes). Do not run acceptance before this approval.
9. **Run the acceptance gate.** On approval: `mcp__thinkube-kanban__accept_spec { spec: "SP-{n}" }`. The server **refuses** unless every slice is Done and every AC is checked (it names the blocker) — the automated half of the gate, mirroring `move_slice`'s AC refusal. On refusal, surface it verbatim and resolve (usually a missed AC checkbox or an un-landed slice), then retry.
10. **Merge the Spec's one PR.** On a green accept, the acceptance card moves to Done and the Spec's single PR merges (`gh pr merge spec/SP-{n}` — the board's **Accept Spec** button does this for you; from the loop, run it after `accept_spec`). One branch, one PR, merged once. The Spec is done.
11. **Brief the user** — the slices landed, the acceptance result, the merge.

## Constraints

- **Don't stop between slices.** Within a Spec, run Ready→Done to completion. No pick-bless, no per-slice "confirm the move." The only stops are: a **verifier red**, a **`move_slice`/`accept_spec` refusal**, or a **failed precondition** — plus the **one acceptance approval** in step 8.
- **Verifier red is non-negotiable.** Never move a slice to Done while checks fail. Surface, let the human fix, re-verify, resume.
- **One slice in flight per Spec** while looping — don't fan out parallel Doing cards.
- **Don't fake a gate.** If `move_slice` or `accept_spec` refuses, surface the reason verbatim and resolve it — don't work around it.
- **Don't stamp `verified_req_hash` by hand.** `move_slice → Done` records it; the sweep compares against it.
- **Acceptance is human + automated.** `accept_spec` is the automated half; it runs **only after** the human approves (step 8). Re-ticking AC boxes is not acceptance — the human judging the assembled result is.

## Output

```
🔬 SP-{n}_SL-3   tsc ✅  webview ✅  tests ✅ 18 passed
☑ AC #2 checked   🟢 SP-{n}_SL-3 → Done (req_hash stamped)

🔬 SP-{n}_SL-4   tsc ✅  webview ✅  tests ✅ 19 passed
☑ AC #3 checked   🟢 SP-{n}_SL-4 → Done (req_hash stamped)

(no Ready slices remain — entering acceptance)

📦 Assembled SP-{n}: <one-paragraph walkthrough of what the slices built,
   mapped to AC #1–#4, with how to see it working end-to-end>

⏸ Acceptance — your call: accept SP-{n}, or send it back with what's wrong.
```

After the human accepts:

```
✅ accept_spec SP-{n} — gate green (all slices Done, all AC checked, accept recorded)
🔀 Merged PR spec/SP-{n} → main. SP-{n} done.
```

## Safety / fallback

- **Verifier subagent missing.** If `.claude/agents/verifier.md` isn't installed, run the `repo-conventions` verification recipe directly via `Bash`. Suggest re-installing the bundle.
- **Verification recipe not detected.** Tell the user. Don't guess — ask for the right command and add it to `repo-conventions`.
- **`move_slice` / `accept_spec` gate refuses.** Surface the reason verbatim. If → Done is rejecting because the satisfied AC isn't checked, check it (step 3) and retry. If `accept_spec` refuses, resolve the named blocker and retry.
- **PR merge fails** (no PR yet for the branch, `gh` missing/unauthenticated, merge rejected): surface the error; the accept stamp is written only after a successful merge, so the Spec is not left "accepted" with its PR open — fix the cause and retry the merge.
- **Navigator mode.** The MCP server refuses board writes from Claude. Verification still runs and the AC edits + moves are proposed; tell the user to make the moves and the accept themselves.
