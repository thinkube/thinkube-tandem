# Engine wiring

## How the list is derived

"Product" is every file under this repository outside `src/engine/` —
`src/extension.ts`, `src/core/`, `src/run/`, `src/surfaces/`, `src/gates/`,
`src/dispatch/`, `src/hostui/`, `webview/`, and so on. A module under
`src/engine/` is **wired** if some product file imports it, directly or by
importing another `src/engine/` module that (transitively, through however
many hops) imports it. Reachability follows `import`/`export * from`
statements only — re-exports count as edges, type-only imports count the
same as value imports, and a module importing another counts as an edge
whether or not the import is later used at runtime.

The module list checked is `src/engine/engine-hash.json`'s key set: every
`.ts` file under `src/engine/` that the repository's own build tracks by
content hash. One entry in that file, `src/engine/oracleStore.ts`, no
longer exists on disk and is not carried below — a hash-tracked name for a
file that was deleted is not a module to verdict, and nothing imports a
path that isn't there.

Tracing every product file's imports and following each hit through the
engine's internal import graph gives the reached set. Every module in the
hash file NOT in that reached set is **unwired** — listed below, one row
each, with the verdict:

- **wire** — the module belongs in this product's live call chain; the fix
  is to add the missing call, not to touch the module.
- **retire** — nothing in this repository calls it, has ever called it from
  here, or is going to: delete it.
- **fold** — its job duplicates or belongs inside an already-wired sibling
  in *this* repository; merge it there instead of leaving it standing
  alone.

## The unwired modules, with verdicts

| Module | Verdict | Reasoning |
| --- | --- | --- |
| `src/engine/WorktreeService.ts` | retire | `src/run/setup.ts` is this repository's live worktree-provisioning path (provision, detect, exclude-from-git) — wiring a second implementation would violate the "one tree per repository" rule this codebase already follows, and folding it into `setup.ts` has nothing left to add since `setup.ts` reimplements the same job independently. |
| `src/engine/worktreeProvision.ts` | retire | reachable only through `src/engine/WorktreeService.ts`, which is itself retired as superseded by `src/run/setup.ts` — there is no live caller to wire it into and no wired sibling to fold it beside. |
| `src/engine/provisionDetect.ts` | retire | reachable only through `src/engine/WorktreeService.ts` → `src/engine/worktreeProvision.ts`, the same retired worktree-setup path `src/run/setup.ts` already replaced — wiring or folding it would resurrect logic this repository has moved past. |
| `src/engine/dispatchGuard.ts` | retire | its header names its caller as "the orchestrate/accept command bodies", a surface that does not exist in this repository — there is nothing here to wire it into, and no wired module here shares its per-Spec-dispatch-lock job to fold it beside. |
| `src/engine/concurrencyLock.ts` | retire | reachable only through `src/engine/dispatchGuard.ts`, itself retired for lacking any caller in this repository — a lock primitive with no lock user here is dead weight, not a folding target. |
| `src/engine/openingGate.ts` | retire | its header names the caller as the `create_slice`→Ready gate inside `kanbanMcpServer.ts`, a file that does not exist in this repository (it belongs to the separate kanban MCP server product) — wiring means calling from here, which is impossible for a caller that lives elsewhere, and no wired module here does this gate's job to fold it into. |
| `src/engine/acSignature.ts` | retire | reachable only through `src/engine/openingGate.ts`, and its own header names `write_spec` (the kanban MCP server) as its caller — the same absent-product reasoning as `openingGate.ts` applies: no local call site to wire, no local sibling to fold beside. |
| `src/engine/methodology/specChange.ts` | retire | reachable only through `src/engine/openingGate.ts`, built for the kanban server's stale-task nudge, a feature this repository's product does not have — wiring would mean inventing a caller from nothing, and there is no already-wired staleness check here to fold it into. |
| `src/engine/auditorRunner.ts` | retire | its header names its caller as `write_spec`, the kanban MCP server's tool — this repository has no such tool to wire it to, and its SDK-audit-runner job has no wired counterpart here to fold into. |
| `src/engine/testImpactFootprint.ts` | retire | its header names its caller as the `kanbanMcpServer.ts` gate, absent from this repository — the module is a pure, well-isolated check with nothing here to wire it into, and this repository's own footprint gate (elsewhere in `src/run/`) already does this job, so folding would duplicate rather than consolidate. |
| `src/engine/retiredSymbolFootprint.ts` | retire | its header names its caller as `kanbanMcpServer.ts`, absent from this repository — same reasoning as `testImpactFootprint.ts`: no local caller to wire, and this repository's footprint gate already covers symbol-retirement safety, so folding would duplicate it. |
| `src/engine/provisioningLeak.ts` | retire | written for the kanban MCP server's worktree-leak check (its header cites "the repo's declared provisioning recipe" from that product's spec) — this repository's own worktree provisioning lives in `src/run/setup.ts` and already excludes provisioned output from git, leaving nothing here to wire this module into or fold it beside. |
| `src/engine/shipFresh.ts` | retire | its header describes checking that a build of `kanbanMcpServer.ts`'s `dist/mcp/kanban.js` reached an installed plugin copy — a deploy path this repository does not have, so there is no call site to wire it into and no wired deploy-freshness check here to fold it beside. |
| `src/engine/specApprovalHash.ts` | retire | its header names the mint-side caller as `ReviewPanel` hashing a spec approval for the kanban server's `create_slice` gate — neither exists in this repository, so wiring has no target and there is no locally-wired approval-hash consolidation point to fold it into. |
| `src/engine/verificationRunnable.ts` | retire | its header names the importers as the `create_slice`→Ready gate in `kanbanMcpServer.ts` and that gate's own `specGateDispatch.test.ts`, neither of which exists in this repository — wiring means calling from here, which is impossible for callers that live in the separate kanban MCP server product. Its job is a precheck over `tsconfig.test.json`'s `include`, and this repository registers its test sources with a single `["src"]` include that no per-file registration check applies to, so there is no wired sibling doing this job to fold it beside. |

