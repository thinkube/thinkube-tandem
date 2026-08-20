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
