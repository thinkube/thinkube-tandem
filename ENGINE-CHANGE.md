# Engine change

`src/engine/verifyOracle.ts` › `probeEvidence`: a failing probe's evidence
now keeps what the runner printed BEFORE the first `not ok` — the module
that could not be resolved, the syntax error, the uncaught throw at import.
Without those lines a probe that never ran reads as "exit 1" and nothing
else, and the coder, the supervisor and the record are all blind to the
one line that names the cause.

# Engine change

`src/engine/verifyOracle.ts` › `formatVerifyReply`: a code-side build
failure whose output is empty now says so — "(the build produced no
output — it may have timed out; run the `build` tool)" — instead of a
bare heading. A worker must never receive a verdict without evidence.

# Engine change

`src/engine/defectLog.ts` › `appendDefect`: every row now carries the
extension version that produced it (read once from the extension's own
manifest) and the run it belongs to. Without them a ledger spanning many
deploys cannot answer "did that fix move the numbers?" — the question the
ledger exists for.

# Engine change

`verifyOracle.ts` (STALL_AFTER 3 → 2) and `core/redispatch.ts`
(MAX_REWORK_ATTEMPTS 3 → 2): budgets pay for progress, not attempts
(THE-LADDER §5). A round that returns an unchanged verdict has bought
nothing; with a ladder behind every actor, repetition hands up instead of
grinding. Two units in the last run spent five identical rounds each.

# Engine change

`workerModel.ts`: a "closer" role resolves to the strongest model unless a
setting says otherwise. The closer is the floor of the ladder — it fires
only when every cheaper actor is spent, so it is rare by construction, and
the one place where the strongest model is always warranted.

# Engine change

`src/engine/core/preflight.ts` › `buildWorkerPrompt`: when the spec body
and the TEP body are the same text, the PARENT SPEC block is no longer
rendered alongside an identical THE INTENT block — only THE INTENT is
emitted, and it counts as embedded context on its own. The doubled body
was wrong: a run path with no separate spec artifact was handing the
worker the same text twice under two headings, paying twice for context
that says one thing once. `satisfies` ordinals are now stripped from the
TEP body for code-role workers exactly as they already were for the spec
body, closing the gap that let a grader ordinal leak through the TEP path.
