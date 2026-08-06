# Decisions taken during the unattended core build

Reversible defaults picked mid-run, recorded for the PR review. Overrule any
of them there — nothing has users.

- **Acceptance requires all proofs green — no override path.** A red or
  pending proof blocks the accept click. If field use shows a legitimate
  "accept anyway" case, it gets added as an explicit, recorded act — not as
  a default.
- **Render budget: 30 lines.** Both gate renders are tested against it.

- **Work-order contracts carry sentences + resolved anchors for now.** Exact
  export signatures are authored by a judgment round that lands with the
  first field cut — the slot exists, the round does not yet.
- **CI proof collectors land with the first Thinkube-hosted delivery.** The
  Proof type accepts kind "ci" today; the fetcher that fills it from the
  platform pipeline is built when there is a real pipeline to read.
- **Unknown git hosts resolve to the Gitea adapter.** The self-hosted
  platform is the default world; github.com is the special case.

- **Re-grounding is a human act:** pressing a unit's stale badge re-derives
  the asks its stale changes serve. Automatic re-grounding on load was
  rejected — a surprise model round on open is a cost the human didn't ask
  for.
- **Runs execute orders serially.** Parallel workers arrive when a real cut
  is big enough to need them; footprint disjointness is already enforced.

- **H5 (prompt-asset "Spec"→"TEP" swap) executes at engine import** — the
  assets arrive in step 2/5; the swap is part of their import commit.
- **Module-size threshold 600 lines** (fail, not warn) for non-engine code.
- **Author slug** = git user.name lowercased/hyphenated; "user" fallback.

- **knip governs v2-authored code only.** The imported engine's public
  surface is canonical v1 API — pinned by the split-fidelity manifest, not
  by usage analysis. Un-exporting it would alter imported code (I1).

- **Probes are authored as `.test.mjs` node:test modules** run directly with
  `node --test` — no build step, so probes run identically in any target
  repo. (The spec's `.test.ts` template assumed a compiling host; this is
  the language-agnostic reading of the same convention.)
- **The night dispatcher walks the DAG serially**; the parallel frontier
  pump returns with the full shell re-host — recorded, not silent.

## Parity batch (2026-08-06, post-audit)
- Sign refuses unprovable/ungrounded changes and undecided questions on the
  cut's asks — the freeze-gate refusals moved from warnings into the gate.
- The docs obligation derives from grounding: a slice declaring a docs/
  touchpoint must land it; blocking at accept by default (advisory setting
  is the recorded escape hatch).
- The retired-symbol importer gate stays unwired until grounding grows a
  `retires` declaration for symbol-deleting changes — it arms the day that
  field exists; the module is imported and tested.
- Supervisor rounds resolve on the judge role (workerModelByRole raises it);
  ESCALATE falls through to the stalled park, DISCLOSE is ledgered.
- Frontier concurrency default follows v1 (4), setting thinkubeTandem.maxConcurrent.
