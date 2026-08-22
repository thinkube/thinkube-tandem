# Engine wiring

Every `src/engine/` module no product (non-test) file reaches, directly or
transitively, from `src/extension.ts`, with a verdict — `wire`, `retire`, or
`fold` — and one sentence saying why. `src/gates/engineWiring.ts` computes
the unreached set from the live tree; `src/gates/engineWiring.test.ts`
proves this list stays equal to that computed set, naming both directions
of any mismatch.

- `src/engine/openingGate.ts` — **fold**: the structural AC-verifiability
  gate belongs to the v1 Spec-mint pipeline (`write_spec` / `/spec-prepare`);
  the current TEP/cut flow signs on `signCut`'s grounding proof, not on a
  certified `ac_verifications` map — it folds in the day a Spec-shaped mint
  returns to the product, or is deleted with its cluster otherwise.
- `src/engine/acSignature.ts` — **fold**: the HMAC provenance signature over
  `openingGate`'s certified map has no verifier left in the wired gate chain
  now that signing runs through `signCut`'s own grounding hash — it retires
  together with `openingGate.ts`, its only consumer.
- `src/engine/auditorRunner.ts` — **fold**: the server-side verifiability
  auditor stub-injection seam serves `write_spec`'s own audit pass, which no
  wired command calls — it folds together with `openingGate.ts`'s mint path
  the day that pipeline returns, or is deleted with it.
- `src/engine/specApprovalHash.ts` — **fold**: the mint-side approval hasher
  exists to match `ReviewPanel`'s hash of a raw Spec file against
  `create_slice`'s hash of the parsed body — a `ReviewPanel`/`create_slice`
  pair this product does not wire; it folds together with the Spec-mint
  cluster, or is deleted with it.
- `src/engine/concurrencyLock.ts` — **fold**: the per-handle write mutex
  guards the kanban MCP server's `move_slice`/`accept_spec` tools against
  concurrent read-modify-write races — tools this product's dispatch path
  does not call; it folds in the day a mutating MCP tool is wired against a
  thinking space, its declared caller.
- `src/engine/dispatchGuard.ts` — **fold**: the per-Spec double-dispatch
  guard wraps `concurrencyLock.ts` for an orchestrate/accept command body
  this product does not run — it folds together with `concurrencyLock.ts`
  the day that command path is wired.
- `src/engine/provisioningLeak.ts` — **wire**: the `git check-ignore`
  provisioning-artifact leak check exists to catch exactly the class of
  incident its header names (a symlinked `node_modules` swept back into git
  by `git add -A`) — it arms the day worktree provisioning is exercised in
  a command path this product dispatches, so the same leak cannot recur
  silently.
- `src/engine/shipFresh.ts` — **wire**: the built-vs-installed artifact hash
  comparison catches a deployed MCP server that silently didn't pick up a
  successful build — it arms the day the deploy step it checks (copying
  `dist/mcp/kanban.js` into the installed plugin) is itself wired into a
  command this product runs.
- `src/engine/methodology/specChange.ts` — **fold**: the Spec
  requirement-hash staleness classifier feeds the kanban's "spec changed —
  re-verify" nudge, a v1 Spec/task staleness signal this product replaced
  with cut-level grounding staleness (`src/core/stale.ts`) — it folds into
  that mechanism the day the two are reconciled, or is deleted with the
  Spec-mint cluster.
- `src/engine/verificationRunnable.ts` — **fold**: the runnable-verification
  precheck contract is shared by the `create_slice`→Ready gate and its
  dispatch test in the v1 kanban MCP server, a gate this product does not
  run — it folds into the opening-gate cluster the day that gate is wired,
  or is deleted with it.
- `src/engine/testImpactFootprint.ts` — **wire**: the test-impact footprint
  gate stops an existing test that imports a changed source file from
  escaping a slice's declared footprint — it arms the day the run's
  footprint check (`src/run/`) is extended to call it as the author-time
  reverse-dependency check its header describes, folding an affected test
  into scope or refusing an unfootprinted one.
- `src/engine/WorktreeService.ts` — **wire**: the git-worktree creation and
  retirement service is how a run gets the isolated checkout it dispatches a
  worker into — it arms the day this product's dispatch path creates its own
  worktree instead of running against a directory the caller already provides.
- `src/engine/worktreeProvision.ts` — **wire**: the language-agnostic runner
  for a repo's declared `## Worktree setup` recipe is what makes a fresh
  worktree able to build and verify at all — it arms together with
  `WorktreeService.ts`, its only caller, which invokes it on every create.
- `src/engine/provisionDetect.ts` — **wire**: the lockfile-first manifest
  scan supplies the setup steps for a repo that declares no recipe, the floor
  that stops a fresh worktree from running its gate with no dependencies
  installed — it arms together with `worktreeProvision.ts`, its only caller.
- `src/engine/retiredSymbolFootprint.ts` — **wire**: as DECISIONS.md
  records, the retired-symbol importer gate stays unwired until grounding
  grows a `retires` declaration for symbol-deleting changes — it arms the
  day that field exists on a cut's grounding, and the module is imported
  and tested at that point.
