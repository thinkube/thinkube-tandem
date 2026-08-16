# Engine change

`src/engine/verifyOracle.ts` › `probeEvidence`: a failing probe's evidence
now keeps what the runner printed BEFORE the first `not ok` — the module
that could not be resolved, the syntax error, the uncaught throw at import.
Without those lines a probe that never ran reads as "exit 1" and nothing
else, and the coder, the supervisor and the record are all blind to the
one line that names the cause.
