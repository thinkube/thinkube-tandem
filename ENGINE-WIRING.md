# Engine wiring

Every module under `src/engine/` that no product code path (starting from
`src/extension.ts`) reaches, each with a verdict — `wire`, `retire` or
`fold` — and the concrete reason for it. Kept complete by
`src/gates/engineWiring.test.ts`'s real-tree scenario: a module that
becomes unreached and is not added here, or an entry whose module regains
a caller, fails that test and names the mismatch.

- `src/engine/acSignature.ts` — retire: it signs the `ac_verifications` map
  for the v1 `write_spec` MCP tool, which this product does not carry; no
  Tandem command mints or reads that signature.
- `src/engine/concurrencyLock.ts` — retire: built to serialize the v1
  `move_slice` / `accept_spec` kanban MCP handlers against read-modify-write
  races; Tandem's session and store layers do not route writes through it.
- `src/engine/auditorRunner.ts` — retire: spawns the headless-Claude
  verifiability audit for the v1 `write_spec` handler; there is no
  `write_spec` call site in this product to drive it.
- `src/engine/dispatchGuard.ts` — retire: guards the v1 orchestrate/accept
  MCP command bodies against double-dispatch on `concurrencyLock`, which is
  itself unwired — its only caller class does not exist in this product.
- `src/engine/openingGate.ts` — retire: the structural pre-`Ready` gate for
  the v1 `create_slice` MCP handler; Tandem's own opening/closing gates
  (`src/engine/core/*`) are the ones `src/run/*` actually calls.
- `src/engine/methodology/specChange.ts` — retire: narrows staleness to the
  v1 kanban Spec's requirement sections for `openingGate`'s re-audit check;
  with `openingGate` unwired this hash is read by nothing.
- `src/engine/provisioningLeak.ts` — retire: checks that a worktree's
  provisioning artifacts stay out of `git add -A` for the v1 kanban
  server's provisioning flow; no command in this product calls it.
- `src/engine/retiredSymbolFootprint.ts` — wire: it arms the day grounding
  grows a `retires` declaration for symbol-deleting changes (DECISIONS.md,
  "The retired-symbol importer gate") — its verdict is held here, not
  restated in DECISIONS.md.
- `src/engine/verificationRunnable.ts` — retire: precheck that a declared
  `ac_verifications` command is registered in `tsconfig.test.json`, written
  for the v1 `create_slice`→Ready gate; Tandem's closing gate does not call
  it before dispatch.
- `src/engine/specApprovalHash.ts` — retire: reconciles the v1
  `ReviewPanel` mint's approval hash with the v1 `create_slice` gate's
  hash; Tandem's own approval hashing lives in `src/gates/approval.ts` and
  does not import this helper.
- `src/engine/shipFresh.ts` — retire: compares the built `dist/mcp/kanban.js`
  bundle against the installed v1 kanban MCP server's copy; this product
  ships as a VS Code extension with no such hand-copied server artifact.
- `src/engine/testImpactFootprint.ts` — fold: SP-6/18's test-impact-blast-
  radius scan for the v1 footprint-completeness gate; its reverse-dependency
  machinery is the same shape this module (`src/gates/engineWiring.ts`)
  reuses, so it folds into the wiring/footprint family the day a v2 author-
  time gate needs an existing-test-impact check rather than staying a
  standalone unreached file.
