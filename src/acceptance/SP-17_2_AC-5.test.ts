// SP-17/2 — THIS FILE IS INTENTIONALLY EMPTY (deleted as part of SL-2).
//
// WHY (TRANSITION — completed once SP-17/2 ships): the original SP-17/2 AC-5 probe
// type-asserted the OrchestratorDeps.rtkEnabled field by constructing
//   `const _deps: Partial<OrchestratorDeps> = { rtkEnabled: true }`
// to prove the opt-in field was added (SP-17/1 SL-1 AC-5). When SP-17/2's implementation
// removes rtkEnabled from OrchestratorDeps, that assignment becomes a tsc type-error
// (excess property / unknown field), breaking `npx tsc -p tsconfig.test.json`. The file
// must therefore be emptied/deleted so the compile passes cleanly.
//
// The behaviour that old AC-5 graded — "OrchestratorDeps gains rtkEnabled and
// rtkBinaryPresent" — is superseded: rtkEnabled is now REMOVED. The type-check evidence
// for the always-on landing is carried by the OTHER AC files (AC-2, AC-3, AC-4) which all
// construct OrchestratorDeps-shaped objects WITHOUT rtkEnabled, and which compile only if
// the implementation correctly omits that field.
//
// node --test will discover this file, find zero tests, and move on — that is correct.
