# Engine wiring ledger

`src/engine/**` is the imported v1 engine (see DECISIONS.md: "knip governs
v2-authored code only"). This ledger names every engine module that no
product path calls today, and records a verdict on each: `wire` it in,
`retire` it, or `fold` its job into the v2 module that already does it.

The list below is DERIVED, not remembered: `src/derive/engineWiring.ts`'s
`unwiredEngineModules(files, entries)` walks the same import graph a
reader would trace by eye, and this file is its output, transcribed as a
table `parseWiringLedger` can read back. Re-run the derivation whenever
the engine's imports change; this file should never drift from it.

## What counts as a product caller

A module has a product caller when some file reachable from one of
`knip.json`'s `workspaces["."].entry` points (today: `src/cli/headless.ts`,
`src/cli/journey.ts`) imports a name **directly from that module's own
path** — a real `import { X } from "./thatModule"`, not merely `export *
from "./thatModule"` landing in some other file's namespace. A barrel
re-export (for example `src/engine/orchestratorCore.ts`'s `export * from
"./core/watchdog"`) still lets the derivation walk PAST the barrel into
the files it re-exports — so anything reached only beyond such a barrel is
still visited — but the re-export itself is never counted as a call on
the module it names. A module earns a caller only when a file the entries
actually reach names it directly. Two other narrowing rules apply: a
dynamic `await import(...)` is not traced (the derivation only follows
static specifiers, the same stated limit `testImpactFootprint.ts` carries),
and a test-shaped path (`*.test.ts` and friends) is never itself a
candidate module — a check has no wiring verdict to carry.

One consequence worth stating plainly: `src/extension.ts` is the VS Code
host entry point (wired in via `package.json`'s `main`, which knip's own
VS Code plugin resolves separately from the explicit `entry` list), but it
is **not** one of the `entry` paths this derivation reads. So the whole
surface reached only through `extension.ts` — `src/hostui/**`, the panel
surface, and the engine's own `src/engine/host/**` tree — has no product
caller by this derivation's exact rule, even though the running extension
does call it. That is the derivation's stated boundary, not an accident;
widening `entries` to include `src/extension.ts` is a call for whoever
owns `knip.json`'s entry list, not a silent fix folded into this ledger.

## The ledger

| Module | Verdict | Reason |
| --- | --- | --- |
| src/engine/acSignature.ts | retire | Only `src/engine/openingGate.ts` imports it, and that file itself has no caller reachable from the entries — the pair forms a cycle isolated from every product path. |
| src/engine/auditorRunner.ts | retire | No file anywhere imports it; the acceptance-evidence auditing it implements was never wired to a caller. |
| src/engine/concurrencyLock.ts | retire | Its only importer, `src/engine/dispatchGuard.ts`, is itself uncalled from any entry — the type has no reachable consumer. |
| src/engine/core/base.ts | wire | Reached only through `orchestratorCore.ts`'s barrel re-export; its DAG/scheduler/session-log helpers are real, tested v1 building blocks worth wiring to a direct caller rather than dropping. |
| src/engine/core/commit.ts | fold | `src/run/commits.ts` already implements the run's per-slice commit book; this v1 module's job is done by that v2 file. |
| src/engine/core/guidance.ts | wire | Called only via `src/engine/core/stubScan.ts`'s direct import, and `stubScan.ts` itself is reached only through the barrel re-export plus a dynamic `import()` this derivation cannot trace — the judge-guidance append/extract pair is live logic worth a direct product caller. |
| src/engine/core/stubScan.ts | wire | Reached only through the barrel re-export for static analysis; `src/run/plan.ts` in fact calls it via a dynamic `await import(...)`, which is real wiring this derivation's static specifier scan cannot see — worth converting to a direct import so the call is visible. |
| src/engine/core/watchdog.ts | fold | `src/run/watchdog.ts` already implements the run's stall watchdog; this v1 module's job is done by that v2 file. |
| src/engine/defectStats.ts | retire | Its only importer, `src/hostui/placeCommands.ts`, is reached only through `src/extension.ts`, which sits outside the entries this derivation reads (see "What counts as a product caller" above). |
| src/engine/dispatchGuard.ts | retire | No file anywhere imports it. |
| src/engine/host/ClaudeConfigService.ts | retire | Reached only through `src/extension.ts`, outside the entries this derivation reads. |
| src/engine/host/ConfigTreeProvider.ts | retire | Reached only through `src/extension.ts`, outside the entries this derivation reads. |
| src/engine/host/LauncherService.ts | retire | Reached only through `src/extension.ts`, outside the entries this derivation reads. |
| src/engine/host/PluginCreationWizard.ts | retire | No file anywhere imports it. |
| src/engine/host/PluginService.ts | retire | No file anywhere imports it. |
| src/engine/host/PluginTemplates.ts | retire | No file anywhere imports it. |
| src/engine/host/SessionLinkService.ts | retire | Reached only through `src/extension.ts`, outside the entries this derivation reads. |
| src/engine/host/active.ts | retire | Reached only through `src/extension.ts`, outside the entries this derivation reads. |
| src/engine/host/configCommands.ts | retire | Reached only through `src/extension.ts`, outside the entries this derivation reads. |
| src/engine/host/configScope.ts | retire | No file anywhere imports it. |
| src/engine/host/configTarget.ts | retire | No file anywhere imports it. |
| src/engine/host/models/Agent.ts | retire | Reached only through `ClaudeConfigService.ts`, which is itself reached only through `src/extension.ts`, outside the entries this derivation reads. |
| src/engine/host/models/ClaudeConfig.ts | retire | Reached only through `ClaudeConfigService.ts`, which is itself reached only through `src/extension.ts`, outside the entries this derivation reads. |
| src/engine/host/models/Command.ts | retire | Reached only through `ClaudeConfigService.ts`, which is itself reached only through `src/extension.ts`, outside the entries this derivation reads. |
| src/engine/host/models/Hook.ts | retire | Reached only through `ClaudeConfigService.ts`, which is itself reached only through `src/extension.ts`, outside the entries this derivation reads. |
| src/engine/host/models/McpServer.ts | retire | Reached only through `ClaudeConfigService.ts`, which is itself reached only through `src/extension.ts`, outside the entries this derivation reads. |
| src/engine/host/models/Skill.ts | retire | Reached only through `ClaudeConfigService.ts`, which is itself reached only through `src/extension.ts`, outside the entries this derivation reads. |
| src/engine/host/sessionLinks.ts | retire | No file anywhere imports it. |
| src/engine/host/stablePath.ts | retire | No file anywhere imports it. |
| src/engine/methodology/specChange.ts | retire | Its only importer, `src/engine/openingGate.ts`, is itself uncalled from any entry. |
| src/engine/openingGate.ts | retire | No file outside its own cycle with `acSignature.ts` and `auditorRunner.ts` imports it, and none of the three is reachable from an entry. |
| src/engine/provisionDetect.ts | retire | Its only importer, `src/engine/worktreeProvision.ts`, is itself uncalled from any entry. |
| src/engine/provisioningLeak.ts | retire | No file anywhere imports it. |
| src/engine/retiredSymbolFootprint.ts | wire | No file imports it, but it is a pure, tested reverse-dependency check (mirrored by this repository's own `testImpactFootprint.ts`) that DECISIONS.md's "retired-symbol importer gate stays unwired" entry already names as waiting on a `retires` declaration — worth wiring the day that field exists, not retiring. |
| src/engine/shipFresh.ts | retire | No file anywhere imports it; the kanban MCP server bundle it checks freshness of does not exist in this repository. |
| src/engine/specApprovalHash.ts | retire | No file anywhere imports it. |
| src/engine/StoreSyncService.ts | retire | Reached only through `src/extension.ts`, outside the entries this derivation reads. |
| src/engine/testImpactFootprint.ts | wire | No file imports it, but it is the pure, tested test-impact-footprint gate this repository's own conventions describe as the "author-time test-impact footprint gate" — worth wiring to its intended kanban-server call site rather than retiring live logic. |
| src/engine/verificationRunnable.ts | retire | No file anywhere imports it. |
| src/engine/worktreeProvision.ts | retire | Its only importer, `src/engine/WorktreeService.ts`, is itself uncalled from any entry. |
| src/engine/WorktreeService.ts | retire | No file anywhere imports it. |
