# Engine wiring

`src/engine/engine-hash.json` tracks every module the engine imports. A
module can be on that roster and still be unreachable from the product:
nothing outside `src/engine` imports it, directly or transitively, so it
never runs. This document names each such module and records a decision
— wire it in, retire it, or fold it into something that already runs —
so the unwired machinery is a decision on record instead of dead weight.

A module counts as wired if some file outside `src/engine` reaches it
through a static `import`/`export … from`, chased transitively, or
through a dynamic `await import(...)` a static scan would miss (see the
`core/stubScan.ts` note below). Re-export by another engine module's
`export *` does not count — the question is whether a product caller
ever names the export, not whether the barrel carries it.

## The module roster

| Module | Verdict | Reasoning |
|---|---|---|
| `WorktreeService.ts` | retire | No file outside `src/engine` imports it; it belonged to an earlier worktree-management path the run/gates architecture (`src/run/`) replaced. |
| `worktreeProvision.ts` | retire | Imported only by `WorktreeService.ts`, itself unwired — a verdict on the parent is a verdict on this helper. |
| `provisionDetect.ts` | retire | Imported only by `WorktreeService.ts`, itself unwired — a verdict on the parent is a verdict on this helper. |
| `provisioningLeak.ts` | retire | No file outside `src/engine` imports it; the no-leak check it implements has no caller wiring it into a live gate. |
| `openingGate.ts` | retire | No file outside `src/engine` imports it; it certified `ac_verifications` for the server-side `write_spec` flow, which the current run/gates architecture does not call. |
| `acSignature.ts` | retire | Imported only by `openingGate.ts`, itself unwired — a verdict on the parent is a verdict on this helper. |
| `methodology/specChange.ts` | retire | Imported only by `openingGate.ts`, itself unwired — a verdict on the parent is a verdict on this helper. |
| `specApprovalHash.ts` | retire | No file outside `src/engine` imports it; it named the mint-side hash for a `ReviewPanel`/`create_slice` pairing that is not part of the current product surface. |
| `auditorRunner.ts` | retire | No file outside `src/engine` imports it; it runs the server-side verifiability audit for `write_spec`, a flow no product caller invokes. |
| `dispatchGuard.ts` | retire | No file outside `src/engine` imports it; dispatch is guarded today by `src/run/dispatch.ts`'s own logic, not this module. |
| `concurrencyLock.ts` | retire | Imported only by `dispatchGuard.ts`, itself unwired — a verdict on the parent is a verdict on this helper. |
| `verificationRunnable.ts` | retire | No file outside `src/engine` imports it; the runnable-command precheck it implements has no caller wiring it into a live gate. |
| `testImpactFootprint.ts` | fold | No file outside `src/engine` imports it, and its `isTestPath` duplicates the test-home rule `src/run/testHomes.ts` already owns on the live run path. |
| `retiredSymbolFootprint.ts` | retire | No file outside `src/engine` imports it; the reverse-dependency check for symbol retirement it implements has no caller wiring it into a live gate. |
| `shipFresh.ts` | retire | No file outside `src/engine` imports it; it checked freshness of a hand-copied `dist/mcp/kanban.js` build artifact from a deploy path the current product does not use. |
| `core/watchdog.ts` | retire | No file outside `src/engine` uses `finalizationVerdict`, `FinalizationState`, or `FINALIZATION_WEDGED_DIAGNOSIS` (only `orchestratorCore.ts`'s `export *` barrel re-exports them), because the live run's stall detection is the separate `src/run/watchdog.ts`. |
| `core/commit.ts` | retire | Nothing outside `src/engine` names `commitPlan` or `resumeDecision`. |

## Not on this list: `core/stubScan.ts`

`core/stubScan.ts` is wired and does not belong on the list above:
`src/run/plan.ts` reaches it through `await import("../engine/core/stubScan")`
— a dynamic import a static import scan misses. Grepping only for
`import … from` would have missed this live caller and mislabeled the
module as unwired; the roster above was checked for this pattern before
any module was marked retire or fold.
