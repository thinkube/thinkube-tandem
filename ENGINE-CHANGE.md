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

`core/preflight.ts` › `buildWorkerPrompt`: on the run path with no separate
spec artifact, the caller rendered the same TEP text twice and handed it to
the prompt builder under two field names (`specBody` and `tepBody`), which
printed it twice under two headings — "PARENT SPEC" and "THE INTENT" — for
every worker, on every unit, doubling that half of the brief for no reason:
one text was never two decisions. `buildWorkerPrompt` now compares the two
bodies once it has applied its own view of each (code units still strip
`satisfies` ordinals from both); when they are the same text it renders
only "THE INTENT — the north star" and treats that block as the embedded
spec, and the intro line stops telling a worker to "read the parent spec"
when nothing but the TEP was ever embedded. When the two bodies genuinely
differ, both blocks still render, each exactly once, unchanged from before.
