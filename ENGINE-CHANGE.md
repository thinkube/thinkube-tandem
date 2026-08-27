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

`core/preflight.ts`: the words a worker reads about the files it may
change. The brief said "your footprint", "YOUR LANE" and "files outside it
belong to others" — possession, for what is only a list of files this unit
is cleared to change while the run lasts. One word carried two facts, and a
run cost: `makeWiden` called the unit whose list held a path the *owner*,
and the caller moved the *obligation* there, so a promise about a session's
name was handed to a slice responsible for something else and nobody kept
it. The brief now says what is cleared, that the guard restores an
uncleared change, and — new, and load-bearing — that a unit needing a
change elsewhere ASKS, is cleared, and makes the change itself. Its promise
is never handed to another slice. The vocabulary is fixed in docs/WORDS.md.

# Engine change

`core/preflight.ts` › `buildWorkerPrompt`: the separate spec-body slot
(`context.specBody`) and its "PARENT SPEC" heading are gone. The spec body
and the parent TEP body were the same rendered text passed under two keys,
so a worker's brief printed that text twice under two headings. The
function now takes only `context.tepBody`, rendered once under "THE
INTENT — the north star", and the caller in `src/run/dispatch.ts` passes
`renderTepBody`'s result under that one key.
